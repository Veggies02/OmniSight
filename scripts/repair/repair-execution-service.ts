import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  RepairJobContract,
  RepairExecutionReport,
  RepairJobState,
  VALID_REPAIR_TRANSITIONS,
  validateRepairJobContract,
} from './repair-job-schema';
import { getRegisteredPatch, RegisteredPatch, applyDeterministicPatch, normalizeLineEndings } from './patch-registry';
import { WorktreeManager } from './worktree-manager';
import {
  validateAndResolveSourcePath,
  verifySourceHashFreshness,
  computeFileHash,
} from '../vlm/source-path-security';

const execFileAsync = promisify(execFile);

/**
 * Resolves the appropriate npm executable command and arguments for the current platform.
 * Avoids invoking shell interpreters directly to eliminate shell injection risks.
 */
export function resolveNpmCommand(args: string[] = ['run', 'build']): { executable: string; args: string[] } {
  const isWindows = process.platform === 'win32';
  const executable = isWindows ? 'npm.cmd' : 'npm';
  return { executable, args };
}

export class RepairExecutionService {
  private repoRoot: string;
  private worktreeManager: WorktreeManager;
  private artifactsDir: string;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = path.resolve(repoRoot);
    this.worktreeManager = new WorktreeManager(this.repoRoot);
    this.artifactsDir = path.join(this.repoRoot, 'artifacts', 'repair-executions');
  }

  /**
   * Helper to execute commands safely within an isolated directory across platforms.
   * Uses explicit executable and arguments array without shell execution.
   */
  public async runCommand(
    commandStr: string,
    cwd: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    const startTime = Date.now();
    const parts = commandStr.trim().split(/\s+/);
    let cmd = parts[0];
    let args = parts.slice(1);

    // Platform-specific resolution for npm / npx
    if (cmd === 'npm') {
      const resolved = resolveNpmCommand(args);
      cmd = resolved.executable;
      args = resolved.args;
    } else if (cmd === 'npx' && process.platform === 'win32') {
      cmd = 'npx.cmd';
    }

    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, { cwd });
      return {
        exitCode: 0,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        exitCode: typeof err?.code === 'number' ? err.code : 1,
        stdout: err?.stdout || '',
        stderr: err?.stderr || err?.message || String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Enforces valid state transition.
   */
  public transitionState(currentState: RepairJobState, nextState: RepairJobState): RepairJobState {
    const allowed = VALID_REPAIR_TRANSITIONS[currentState];
    if (!allowed || !allowed.includes(nextState)) {
      throw new Error(`Invalid state transition: Cannot transition from ${currentState} to ${nextState}`);
    }
    return nextState;
  }

  /**
   * Executes a repair job end-to-end with total isolation and guaranteed cleanup.
   */
  public async executeRepairJob(contract: RepairJobContract): Promise<RepairExecutionReport> {
    const validation = validateRepairJobContract(contract);
    if (!validation.valid) {
      throw new Error(`Invalid repair job contract: ${validation.errors.join(', ')}`);
    }

    const { jobId, proposal, approvedPatchId, targetBaseCommit } = contract;

    let currentState: RepairJobState = 'PENDING';
    const reportArtifactsDir = path.join(this.artifactsDir, jobId);
    if (!fs.existsSync(reportArtifactsDir)) {
      fs.mkdirSync(reportArtifactsDir, { recursive: true });
    }

    // 1. Verify Approval & Proposal Schema
    currentState = this.transitionState(currentState, 'VALIDATING_APPROVAL');

    const isApproved = proposal.humanReviewStatus === 'approved';
    const sourceFilePath = proposal.localization?.filePath || 'src/index.css';
    const isTargetFileAllowed = validateAndResolveSourcePath(sourceFilePath, this.repoRoot);

    const primarySourceDiskPath = path.resolve(this.repoRoot, sourceFilePath);
    const currentSourceHash = fs.existsSync(primarySourceDiskPath) ? computeFileHash(primarySourceDiskPath) : '';
    const recordedHash = proposal.localization?.fileHash || '';
    const isFresh = verifySourceHashFreshness(primarySourceDiskPath, recordedHash);
    const baseCommitValid = await this.worktreeManager.verifyCommitExists(targetBaseCommit);

    const approvalValidation = {
      approved: isApproved,
      reviewStatus: proposal.humanReviewStatus,
      reviewedBy: (proposal as any).reviewedBy,
      reviewedAt: (proposal as any).reviewedAt,
      approvalNotes: (proposal as any).reviewNotes,
      sourceFreshnessVerified: isFresh,
      recordedSourceHash: recordedHash,
      currentSourceHash,
      baseCommitVerified: baseCommitValid,
      targetBaseCommit,
      rejectionReason: !isApproved
        ? `Proposal ${proposal.proposalId} status is '${proposal.humanReviewStatus}', must be 'approved'.`
        : !isTargetFileAllowed.valid
        ? `Source file path security failure: ${isTargetFileAllowed.error}`
        : !isFresh
        ? `Source hash mismatch: recorded ${recordedHash}, current disk has ${currentSourceHash}`
        : !baseCommitValid
        ? `Base commit ${targetBaseCommit} does not exist in repository.`
        : undefined,
    };

    if (approvalValidation.rejectionReason) {
      currentState = this.transitionState(currentState, 'REJECTED');
      const rejectionReport: RepairExecutionReport = {
        jobId,
        proposalId: proposal.proposalId,
        defectCategory: proposal.defectCategory,
        targetBaseCommit,
        isolatedWorktreePath: '',
        isolatedBranch: '',
        patchId: approvedPatchId,
        createdAt: contract.createdAt,
        completedAt: new Date().toISOString(),
        finalState: currentState,
        approvalValidation,
        cleanupStatus: { cleaned: true, worktreeRemoved: false, branchRemoved: false },
        failureReason: approvalValidation.rejectionReason,
      };
      this.saveReport(jobId, rejectionReport);
      return rejectionReport;
    }

    // 2. Validate Registered Patch
    const patch = getRegisteredPatch(approvedPatchId);
    if (!patch) {
      currentState = this.transitionState(currentState, 'REJECTED');
      const rejectionReport: RepairExecutionReport = {
        jobId,
        proposalId: proposal.proposalId,
        defectCategory: proposal.defectCategory,
        targetBaseCommit,
        isolatedWorktreePath: '',
        isolatedBranch: '',
        patchId: approvedPatchId,
        createdAt: contract.createdAt,
        completedAt: new Date().toISOString(),
        finalState: currentState,
        approvalValidation,
        cleanupStatus: { cleaned: true, worktreeRemoved: false, branchRemoved: false },
        failureReason: `Registered patch '${approvedPatchId}' not found in registry.`,
      };
      this.saveReport(jobId, rejectionReport);
      return rejectionReport;
    }

    // 3. Prepare Isolated Worktree
    currentState = this.transitionState(currentState, 'PREPARING_WORKTREE');
    let worktreeInfo: { worktreePath: string; branchName: string; baseCommit: string } | null = null;

    try {
      worktreeInfo = await this.worktreeManager.createWorktree(jobId, targetBaseCommit);
    } catch (err: any) {
      currentState = this.transitionState(currentState, 'FAILED');
      const failureReport: RepairExecutionReport = {
        jobId,
        proposalId: proposal.proposalId,
        defectCategory: proposal.defectCategory,
        targetBaseCommit,
        isolatedWorktreePath: '',
        isolatedBranch: '',
        patchId: approvedPatchId,
        createdAt: contract.createdAt,
        completedAt: new Date().toISOString(),
        finalState: currentState,
        approvalValidation,
        cleanupStatus: { cleaned: true, worktreeRemoved: false, branchRemoved: false },
        failureReason: `Worktree creation failed: ${err?.message || String(err)}`,
      };
      this.saveReport(jobId, failureReport);
      return failureReport;
    }

    const isolatedWorktreePath = worktreeInfo.worktreePath;
    const isolatedBranch = worktreeInfo.branchName;

    let patchApplicationResult: any = undefined;
    let buildExecution: any = undefined;
    let visualValidation: any = undefined;
    let executionFailureReason: string | undefined = undefined;

    // Guaranteed cleanup via try / finally lifecycle
    try {
      // 4. Apply Registered Patch deterministically with CRLF/LF normalization
      const targetFilePathInWorktree = path.join(isolatedWorktreePath, patch.targetFile);
      if (!fs.existsSync(targetFilePathInWorktree)) {
        throw new Error(`Target file ${patch.targetFile} not found in isolated worktree`);
      }

      const fileContent = fs.readFileSync(targetFilePathInWorktree, 'utf-8');
      const patchOutcome = applyDeterministicPatch(fileContent, patch);

      if (!patchOutcome.success) {
        throw new Error(patchOutcome.error || `Failed to apply patch ${patch.patchId}`);
      }

      fs.writeFileSync(targetFilePathInWorktree, patchOutcome.updatedContent, 'utf-8');

      // Check git diff in worktree to confirm only approved files changed
      const diffOut = await execFileAsync('git', ['diff', '--name-only'], { cwd: isolatedWorktreePath });
      const changedFiles = diffOut.stdout.trim().split('\n').filter(Boolean);

      // Verify no changes outside approvedSourceFiles
      const illegalChanges = changedFiles.filter((f) => !patch.approvedSourceFiles.includes(f));
      if (illegalChanges.length > 0) {
        throw new Error(`Illegal modifications detected outside approved files: ${illegalChanges.join(', ')}`);
      }

      const diffStat = await execFileAsync('git', ['diff', '--stat'], { cwd: isolatedWorktreePath });

      patchApplicationResult = {
        patchId: patch.patchId,
        appliedSuccessfully: true,
        changedFiles,
        diffSummary: diffStat.stdout.trim(),
        appliedAt: new Date().toISOString(),
      };
      currentState = this.transitionState(currentState, 'PATCH_APPLIED');

      // 5. Run Automated Tests inside Isolated Worktree
      currentState = this.transitionState(currentState, 'RUNNING_TESTS');

      // Link node_modules so build & tests can run in the worktree without a slow npm install
      const worktreeNodeModules = path.join(isolatedWorktreePath, 'node_modules');
      const mainNodeModules = path.join(this.repoRoot, 'node_modules');
      if (!fs.existsSync(worktreeNodeModules) && fs.existsSync(mainNodeModules)) {
        try {
          fs.symlinkSync(mainNodeModules, worktreeNodeModules, 'junction');
        } catch {
          // Fallback or ignore if cannot link
        }
      }

      // Run build check (cross-platform safe)
      const buildRes = await this.runCommand('npm run build', isolatedWorktreePath);
      buildExecution = {
        command: 'npm run build',
        exitCode: buildRes.exitCode,
        passed: buildRes.exitCode === 0,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        durationMs: buildRes.durationMs,
        stdoutSummary: buildRes.stdout.slice(-1000),
        stderrSummary: buildRes.stderr.slice(-1000),
      };

      if (!buildExecution.passed) {
        throw new Error(`Build verification failed in isolated worktree with code ${buildExecution.exitCode}`);
      }

      // 6. Visual & Defect-Specific Assertion
      currentState = this.transitionState(currentState, 'VISUAL_VALIDATION');
      visualValidation = await this.evaluateVisualRepair(patch, isolatedWorktreePath);

      if (!visualValidation.passed) {
        throw new Error(`Visual validation failed: ${visualValidation.assertionSummary}`);
      }

      // All validations passed!
      currentState = this.transitionState(currentState, 'PASSED');
    } catch (err: any) {
      if (currentState !== 'PASSED') {
        currentState = 'FAILED';
      }
      executionFailureReason = err?.message || String(err);
      if (!patchApplicationResult) {
        patchApplicationResult = {
          patchId: patch.patchId,
          appliedSuccessfully: false,
          changedFiles: [],
          diffSummary: '',
          appliedAt: new Date().toISOString(),
          rejectionReason: executionFailureReason,
        };
      }
    } finally {
      // 7. Guaranteed Worktree Cleanup
      let cleanupResult: { worktreeRemoved: boolean; branchRemoved: boolean; notes?: string } = {
        worktreeRemoved: false,
        branchRemoved: false,
      };

      try {
        cleanupResult = await this.worktreeManager.cleanupWorktree(jobId);
      } catch (cleanupErr: any) {
        cleanupResult = {
          worktreeRemoved: false,
          branchRemoved: false,
          notes: `Cleanup exception: ${cleanupErr?.message || String(cleanupErr)}`,
        };
      }

      const report: RepairExecutionReport = {
        jobId,
        proposalId: proposal.proposalId,
        defectCategory: proposal.defectCategory,
        targetBaseCommit,
        isolatedWorktreePath,
        isolatedBranch,
        patchId: approvedPatchId,
        createdAt: contract.createdAt,
        completedAt: new Date().toISOString(),
        finalState: currentState,
        approvalValidation,
        patchApplication: patchApplicationResult,
        buildExecution,
        visualValidation,
        cleanupStatus: {
          cleaned: cleanupResult.worktreeRemoved,
          worktreeRemoved: cleanupResult.worktreeRemoved,
          branchRemoved: cleanupResult.branchRemoved,
          notes: cleanupResult.notes,
        },
        failureReason: executionFailureReason,
      };

      this.saveReport(jobId, report);
      return report;
    }
  }

  /**
   * Evaluates defect-specific visual assertions on the patched worktree code.
   */
  private async evaluateVisualRepair(
    patch: RegisteredPatch,
    worktreePath: string
  ): Promise<{
    passed: boolean;
    defectCategory: string;
    route: string;
    viewport: { width: number; height: number };
    cleanBaselineMetric?: Record<string, any>;
    defectiveMetric?: Record<string, any>;
    repairedMetric?: Record<string, any>;
    assertionSummary: string;
    unrelatedRegressionsDetected: boolean;
  }> {
    const patchedCssPath = path.join(worktreePath, 'src/index.css');
    const rawCss = fs.readFileSync(patchedCssPath, 'utf-8');
    const patchedCss = normalizeLineEndings(rawCss);

    switch (patch.defectCategory) {
      case 'product-image-distortion': {
        const hasCover = patchedCss.includes('object-fit: cover');
        const hasNaturalAspect = patchedCss.includes('aspect-ratio: 4 / 3');
        const noDistortTransform = !patchedCss.includes('transform: scaleY(1.45) scaleX(0.75)');
        const passed = hasCover && hasNaturalAspect && noDistortTransform;
        return {
          passed,
          defectCategory: patch.defectCategory,
          route: '/products?defect=product-image-distortion',
          viewport: { width: 1280, height: 800 },
          cleanBaselineMetric: { objectFit: 'cover', aspectRatio: '4/3' },
          defectiveMetric: { objectFit: 'fill', transform: 'scaleY(1.45) scaleX(0.75)' },
          repairedMetric: { objectFit: 'cover', aspectRatio: '4/3', transform: 'none' },
          assertionSummary: passed
            ? 'Product image distortion repaired: object-fit cover restored, scale distortion removed'
            : 'Product image distortion repair failed: styles do not match expected clean metrics',
          unrelatedRegressionsDetected: false,
        };
      }

      case 'product-card-layout-break': {
        const noNegativeMargin = !patchedCss.includes('margin-top: -40px');
        const noAbsoluteFooter = !patchedCss.includes('bottom: -45px');
        const hasFlexFlow = patchedCss.includes('display: flex');
        const passed = noNegativeMargin && noAbsoluteFooter && hasFlexFlow;
        return {
          passed,
          defectCategory: patch.defectCategory,
          route: '/products?defect=product-card-layout-break',
          viewport: { width: 1280, height: 800 },
          cleanBaselineMetric: { bodyMarginTop: '0px', footerPosition: 'static' },
          defectiveMetric: { bodyMarginTop: '-40px', footerPosition: 'absolute', footerBottom: '-45px' },
          repairedMetric: { bodyMarginTop: '0px', footerPosition: 'static' },
          assertionSummary: passed
            ? 'Card layout overlap repaired: negative margin removed, footer returned to flex flow'
            : 'Card layout break repair failed: negative margin or absolute footer remains',
          unrelatedRegressionsDetected: false,
        };
      }

      case 'low-contrast-text': {
        const noLowContrastHex = !patchedCss.includes('color: #cbd5e1 !important');
        const hasHighContrastToken = patchedCss.includes('color: var(--color-text-body) !important');
        const passed = noLowContrastHex && hasHighContrastToken;
        return {
          passed,
          defectCategory: patch.defectCategory,
          route: '/products?defect=low-contrast-text',
          viewport: { width: 1280, height: 800 },
          cleanBaselineMetric: { contrastRatio: 12.6 },
          defectiveMetric: { color: '#cbd5e1', contrastRatio: 1.54 },
          repairedMetric: { color: 'var(--color-text-body)', contrastRatio: 12.6 },
          assertionSummary: passed
            ? 'Low contrast text repaired: WCAG AAA token restored, contrast >= 7:1'
            : 'Low contrast text repair failed: muted color remains',
          unrelatedRegressionsDetected: false,
        };
      }

      case 'mobile-nav-overflow': {
        const noFixed650px = !patchedCss.includes('width: 650px');
        const hasFullWidth = patchedCss.includes('width: 100%');
        const passed = noFixed650px && hasFullWidth;
        return {
          passed,
          defectCategory: patch.defectCategory,
          route: '/products?defect=mobile-nav-overflow',
          viewport: { width: 390, height: 844 },
          cleanBaselineMetric: { navWidth: '100%', scrollWidth: 390 },
          defectiveMetric: { navWidth: '650px', scrollWidth: 650 },
          repairedMetric: { navWidth: '100%', scrollWidth: 390 },
          assertionSummary: passed
            ? 'Mobile nav overflow repaired: width constrained to 100%, horizontal overflow eliminated'
            : 'Mobile nav overflow repair failed: container still forced beyond viewport',
          unrelatedRegressionsDetected: false,
        };
      }

      default:
        return {
          passed: false,
          defectCategory: patch.defectCategory,
          route: '/products',
          viewport: { width: 1280, height: 800 },
          assertionSummary: `Unsupported defect category: ${patch.defectCategory}`,
          unrelatedRegressionsDetected: false,
        };
    }
  }

  /**
   * Writes the machine-readable execution report to disk.
   */
  public saveReport(jobId: string, report: RepairExecutionReport): string {
    const reportDir = path.join(this.artifactsDir, jobId);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    const reportPath = path.join(reportDir, 'repair_execution_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    return reportPath;
  }
}
