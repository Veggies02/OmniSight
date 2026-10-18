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
import { verifyRepairedWorktreeVisually } from './visual-verifier';
import {
  validateAndResolveSourcePath,
  verifySourceHashFreshness,
  computeFileHash,
} from '../vlm/source-path-security';

const execFileAsync = promisify(execFile);

/**
 * runCommand only launches these executables. This limits what a bad command string
 * can start; it is not a sandbox (for example `node -e` can still run any JavaScript),
 * so command strings must always come from trusted constants, never from user or AI input.
 */
const ALLOWED_COMMAND_EXECUTABLES = new Set(['npm', 'npx', 'node']);

const NPM_CLI_FILE_NAME = 'npm-cli.js';
const NPX_CLI_FILE_NAME = 'npx-cli.js';

/**
 * True only if the candidate is an absolute path to an existing file with the expected name.
 * Under `npx`, npm_execpath may point at npx-cli.js, which must never be used as npm.
 */
function isExistingCliFile(candidate: string | undefined, expectedName: string): candidate is string {
  if (!candidate) return false;
  if (!path.isAbsolute(candidate)) return false;
  if (path.basename(candidate).toLowerCase() !== expectedName) return false;
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Finds npm-cli.js on Windows. Lookup order:
 *   1. OMNISIGHT_NPM_CLI (explicit override; must be valid or we throw)
 *   2. npm_execpath, only if it is an existing npm-cli.js
 *   3. The npm that ships next to node.exe
 * Throws a descriptive error if none of them exist.
 */
function findWindowsNpmCli(env: NodeJS.ProcessEnv): string {
  const override = env.OMNISIGHT_NPM_CLI?.trim();
  if (override) {
    if (!isExistingCliFile(override, NPM_CLI_FILE_NAME)) {
      throw new Error(
        `OMNISIGHT_NPM_CLI is set but is not an existing absolute path to ${NPM_CLI_FILE_NAME}: ${override}`
      );
    }
    return override;
  }

  const fromNpmExecPath = env.npm_execpath;
  if (isExistingCliFile(fromNpmExecPath, NPM_CLI_FILE_NAME)) {
    return fromNpmExecPath;
  }

  const defaultPath = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    NPM_CLI_FILE_NAME
  );
  if (isExistingCliFile(defaultPath, NPM_CLI_FILE_NAME)) {
    return defaultPath;
  }

  throw new Error(
    `Could not find ${NPM_CLI_FILE_NAME}. Tried npm_execpath (${fromNpmExecPath ?? 'not set'}) ` +
      `and ${defaultPath}. Set OMNISIGHT_NPM_CLI to the full path of ${NPM_CLI_FILE_NAME}.`
  );
}

/**
 * Resolves npm without invoking a shell on Windows.
 * Runs npm's JavaScript CLI directly with Node's own executable.
 */
export function resolveNpmCommand(
  args: string[] = ['run', 'build'],
  env: NodeJS.ProcessEnv = process.env
): { executable: string; args: string[] } {
  if (process.platform !== 'win32') {
    return { executable: 'npm', args };
  }
  return { executable: process.execPath, args: [findWindowsNpmCli(env), ...args] };
}

/**
 * Resolves npx without a shell on Windows. npx.cmd cannot be launched without a shell
 * on current Node versions, so we run npx-cli.js (it sits next to npm-cli.js) with node.exe.
 */
export function resolveNpxCommand(
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env
): { executable: string; args: string[] } {
  if (process.platform !== 'win32') {
    return { executable: 'npx', args };
  }
  const npxCli = path.join(path.dirname(findWindowsNpmCli(env)), NPX_CLI_FILE_NAME);
  if (!isExistingCliFile(npxCli, NPX_CLI_FILE_NAME)) {
    throw new Error(`Could not find ${NPX_CLI_FILE_NAME} at ${npxCli}.`);
  }
  return { executable: process.execPath, args: [npxCli, ...args] };
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
   * Resolution errors (for example a missing npm CLI) are returned as a failed
   * result instead of being thrown.
   */
  public async runCommand(
    commandStr: string,
    cwd: string,
    options: { timeoutMs?: number } = {}
  ): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    const startTime = Date.now();
    const parts = commandStr.trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
      return { exitCode: 1, stdout: '', stderr: 'Empty command', durationMs: 0 };
    }

    let cmd = parts[0];
    let args = parts.slice(1);

    if (!ALLOWED_COMMAND_EXECUTABLES.has(cmd)) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Command not allowed: "${cmd}". Allowed executables: ${Array.from(ALLOWED_COMMAND_EXECUTABLES).join(', ')}`,
        durationMs: 0,
      };
    }

    try {
      // Platform-specific resolution for npm / npx (never uses a shell)
      if (cmd === 'npm') {
        const resolved = resolveNpmCommand(args);
        cmd = resolved.executable;
        args = resolved.args;
      } else if (cmd === 'npx') {
        const resolved = resolveNpxCommand(args);
        cmd = resolved.executable;
        args = resolved.args;
      }

      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd,
        timeout: options.timeoutMs ?? 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        exitCode: 0,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      const timedOut = err?.killed === true;
      return {
        exitCode: typeof err?.code === 'number' ? err.code : 1,
        stdout: err?.stdout || '',
        stderr:
          (timedOut ? 'Command timed out and was killed. ' : '') +
          (err?.stderr || err?.message || String(err)),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Installs dependencies inside an isolated worktree, giving it its own node_modules.
   * --ignore-scripts: dependency install scripts never run (nothing in this project needs them).
   * If the base commit does not track package-lock.json, the repo's lockfile is copied in
   * so that `npm ci` stays reproducible.
   */
  private async installWorktreeDependencies(
    worktreePath: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    const lockInWorktree = path.join(worktreePath, 'package-lock.json');
    const lockInRepo = path.join(this.repoRoot, 'package-lock.json');
    if (!fs.existsSync(lockInWorktree) && fs.existsSync(lockInRepo)) {
      fs.copyFileSync(lockInRepo, lockInWorktree);
    }
    return this.runCommand(
      'npm ci --ignore-scripts --no-audit --no-fund --prefer-offline',
      worktreePath,
      { timeoutMs: 5 * 60 * 1000 }
    );
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

      // Install dependencies INSIDE the worktree. The real node_modules is no longer linked
      // into it, so nothing running in the worktree can touch the real packages.
      const installRes = await this.installWorktreeDependencies(isolatedWorktreePath);
      if (installRes.exitCode !== 0) {
        throw new Error(
          `Dependency install failed in isolated worktree with code ${installRes.exitCode}: ${installRes.stderr.slice(-500)}`
        );
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

      // 6. Real Browser Visual & Defect-Specific Assertion
      currentState = this.transitionState(currentState, 'VISUAL_VALIDATION');
      visualValidation = await this.evaluateVisualRepair(patch, isolatedWorktreePath, jobId);

      if (!visualValidation.passed) {
        throw new Error(`Visual validation failed: ${visualValidation.assertionSummary}`);
      }

      if (visualValidation.unrelatedRegressionsDetected) {
        throw new Error(`Visual validation failed: Unrelated UI regression detected during post-repair checks`);
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
   * Evaluates defect-specific visual assertions on the patched worktree code using real browser rendering.
   */
  public async evaluateVisualRepair(
    patch: RegisteredPatch,
    worktreePath: string,
    jobId: string = `job-${Date.now()}`
  ) {
    return verifyRepairedWorktreeVisually({
      worktreePath,
      patch,
      jobId,
      artifactsDir: this.artifactsDir,
      repoRoot: this.repoRoot,
    });
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