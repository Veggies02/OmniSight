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
    cwd: string,
    options: { timeoutMs?: number } = {}
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
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd,
        timeout: options.timeoutMs,
      });
      return {
        exitCode: 0,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      const isTimeout = err?.killed || err?.signal === 'SIGTERM' || err?.code === 'ETIMEDOUT';
      return {
        exitCode: typeof err?.code === 'number' ? err.code : isTimeout ? 124 : 1,
        stdout: err?.stdout || '',
        stderr: err?.stderr || (isTimeout ? `Command timed out after ${options.timeoutMs}ms` : err?.message || String(err)),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Validates that a requested test command conforms strictly to safe, pre-approved patterns.
   * Rejects any attempts at shell chaining, arbitrary command execution, or path traversal.
   */
  public validateAndResolveTestCommand(rawCommand: string): { valid: boolean; command: string; error?: string } {
    if (!rawCommand || typeof rawCommand !== 'string' || !rawCommand.trim()) {
      return { valid: false, command: '', error: 'Empty or invalid test command' };
    }

    const trimmed = rawCommand.trim();

    // Reject dangerous shell metacharacters
    if (/[;&|`$><\r\n]/.test(trimmed)) {
      return { valid: false, command: trimmed, error: `Command contains forbidden shell metacharacters: ${trimmed}` };
    }

    // Check against explicit allowed command patterns
    if (trimmed === 'npm run build' || trimmed === 'npm test') {
      return { valid: true, command: trimmed };
    }

    // Pattern: npx playwright test [args...]
    if (trimmed === 'npx playwright test' || trimmed.startsWith('npx playwright test ')) {
      const subparts = trimmed.split(/\s+/).slice(3); // after 'npx playwright test'
      for (const part of subparts) {
        if (part.startsWith('-')) {
          const allowedFlags = ['--reporter=list', '--reporter=line', '--forbid-only'];
          if (!allowedFlags.includes(part) && !part.startsWith('--workers=')) {
            return { valid: false, command: trimmed, error: `Flag not allowed in repair test command: ${part}` };
          }
        } else {
          // File path - must stay within tests/ and not traverse directories
          if (part.includes('..') || !part.startsWith('tests/')) {
            return { valid: false, command: trimmed, error: `Test file must be within tests/ directory: ${part}` };
          }
        }
      }
      return { valid: true, command: trimmed };
    }

    // Pattern: direct test file path, e.g. "tests/defect-injection.spec.ts"
    if (trimmed.startsWith('tests/') && trimmed.endsWith('.spec.ts')) {
      if (trimmed.includes('..')) {
        return { valid: false, command: trimmed, error: `Directory traversal not allowed: ${trimmed}` };
      }
      return { valid: true, command: `npx playwright test ${trimmed}` };
    }

    return {
      valid: false,
      command: trimmed,
      error: `Test command '${trimmed}' is not an authorized test command or registered test spec`,
    };
  }

  /**
   * Executes the declared required validation tests inside the isolated worktree directory.
   */
  public async executeWorktreeTests(
    requiredTests: string[],
    isolatedWorktreePath: string,
    options: { timeoutMs?: number } = { timeoutMs: 60000 }
  ): Promise<{ passed: boolean; testExecution?: any; error?: string }> {
    if (!Array.isArray(requiredTests) || requiredTests.length === 0) {
      return { passed: true };
    }

    let combinedStdout = '';
    let combinedStderr = '';
    let totalTestsCount = 0;
    let passedTestsCount = 0;
    let failedTestsCount = 0;
    let totalDurationMs = 0;
    let lastExitCode = 0;
    let lastCommand = '';

    for (const rawTest of requiredTests) {
      const resolution = this.validateAndResolveTestCommand(rawTest);
      if (!resolution.valid) {
        return {
          passed: false,
          error: `Test command validation error: ${resolution.error}`,
          testExecution: {
            command: rawTest,
            exitCode: 1,
            passed: false,
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            durationMs: 0,
            stdoutSummary: '',
            stderrSummary: resolution.error || 'Invalid test command',
          },
        };
      }

      lastCommand = resolution.command;
      const res = await this.runCommand(resolution.command, isolatedWorktreePath, { timeoutMs: options.timeoutMs });
      totalDurationMs += res.durationMs;
      lastExitCode = res.exitCode;
      combinedStdout += `\n--- [${resolution.command}] ---\n${res.stdout}`;
      combinedStderr += res.stderr ? `\n--- [${resolution.command}] ---\n${res.stderr}` : '';

      // Parse Playwright test count summary if available
      const passMatch = res.stdout.match(/(\d+)\s+passed/);
      const failMatch = res.stdout.match(/(\d+)\s+failed/);
      const passedInCmd = passMatch ? parseInt(passMatch[1], 10) : 0;
      const failedInCmd = failMatch ? parseInt(failMatch[1], 10) : 0;
      passedTestsCount += passedInCmd;
      failedTestsCount += failedInCmd;
      totalTestsCount += passedInCmd + failedInCmd;

      if (res.exitCode !== 0) {
        const timeoutNote = res.exitCode === 124 || res.stderr.includes('timed out') ? ' (timed out)' : '';
        return {
          passed: false,
          error: `Required test '${resolution.command}' failed in isolated worktree with exit code ${res.exitCode}${timeoutNote}: ${res.stderr || res.stdout}`.trim(),
          testExecution: {
            command: resolution.command,
            exitCode: res.exitCode,
            passed: false,
            totalTests: totalTestsCount || 1,
            passedTests: passedTestsCount,
            failedTests: failedTestsCount || 1,
            durationMs: totalDurationMs,
            stdoutSummary: combinedStdout.slice(-1000),
            stderrSummary: combinedStderr.slice(-1000),
          },
        };
      }
    }

    return {
      passed: true,
      testExecution: {
        command: lastCommand,
        exitCode: lastExitCode,
        passed: true,
        totalTests: totalTestsCount,
        passedTests: passedTestsCount,
        failedTests: 0,
        durationMs: totalDurationMs,
        stdoutSummary: combinedStdout.slice(-1000),
        stderrSummary: combinedStderr.slice(-1000),
      },
    };
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
    let testExecution: any = undefined;
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

      // Execute declared required tests inside the isolated worktree
      // Tests can come from patch.requiredTests or proposal.requiredValidationTests
      const testsToRun: string[] = [];
      if (Array.isArray(patch.requiredTests) && patch.requiredTests.length > 0) {
        testsToRun.push(...patch.requiredTests);
      }
      if (Array.isArray(proposal.requiredValidationTests) && proposal.requiredValidationTests.length > 0) {
        testsToRun.push(...proposal.requiredValidationTests);
      }

      // Filter out redundant 'npm run build' since it was already executed above
      const uniqueRequiredTests = Array.from(new Set(testsToRun)).filter(
        (t) => t.trim() !== 'npm run build'
      );

      if (uniqueRequiredTests.length > 0) {
        const testOutcome = await this.executeWorktreeTests(uniqueRequiredTests, isolatedWorktreePath);
        testExecution = testOutcome.testExecution;
        if (!testOutcome.passed) {
          throw new Error(testOutcome.error || `Required tests failed in isolated worktree`);
        }
      } else {
        // Fallback default testExecution to indicate build was verified
        testExecution = {
          command: 'npm run build',
          exitCode: buildExecution.exitCode,
          passed: buildExecution.passed,
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          durationMs: buildExecution.durationMs,
          stdoutSummary: buildExecution.stdoutSummary,
          stderrSummary: buildExecution.stderrSummary,
        };
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
        testExecution,
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
