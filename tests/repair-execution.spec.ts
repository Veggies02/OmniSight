import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { RepairExecutionService, resolveNpmCommand, resolveNpxCommand } from '../scripts/repair/repair-execution-service';
import { RepairJobContract, validateRepairJobContract } from '../scripts/repair/repair-job-schema';
import { WorktreeManager } from '../scripts/repair/worktree-manager';
import {
  getRegisteredPatch,
  REGISTERED_PATCHES,
  applyDeterministicPatch,
  normalizeLineEndings,
} from '../scripts/repair/patch-registry';
import { computeFileHash } from '../scripts/vlm/source-path-security';

test.describe('Step 4.6 — Isolated Patch Application & Validation Pipeline', () => {
  const repoRoot = process.cwd();
  const indexCssPath = path.resolve(repoRoot, 'src/index.css');
  const currentCssHash = computeFileHash(indexCssPath);

  // Repair jobs now run `npm ci` inside each worktree, and several run in parallel.
  test.describe.configure({ timeout: 120_000 });

  test('Registered Patches Registry defines all 4 seeded defect patches with strict allowlists', async () => {
    expect(Object.keys(REGISTERED_PATCHES).length).toBe(4);

    const categories = [
      'product-image-distortion',
      'product-card-layout-break',
      'low-contrast-text',
      'mobile-nav-overflow',
    ];

    for (const cat of categories) {
      const patch = Object.values(REGISTERED_PATCHES).find((p) => p.defectCategory === cat);
      expect(patch).toBeDefined();
      expect(patch!.approvedSourceFiles).toEqual(['src/index.css']);
      expect(patch!.targetFile).toBe('src/index.css');
      expect(patch!.targetMatchString.length).toBeGreaterThan(10);
      expect(patch!.replacementString.length).toBeGreaterThan(10);
      expect(patch!.expectedVisualEffect.length).toBeGreaterThan(10);
    }
  });

  test('Rejects repair job if humanReviewStatus is pending or rejected', async () => {
    const service = new RepairExecutionService(repoRoot);
    const unapprovedProposal: any = {
      schemaVersion: '1.0',
      proposalId: 'prop-test-unapproved',
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      humanReviewStatus: 'pending_review',
      status: 'proposed',
      localization: {
        status: 'localized',
        filePath: 'src/index.css',
        fileHash: currentCssHash,
      },
      createdAt: new Date().toISOString(),
    };

    const contract: RepairJobContract = {
      jobId: `test-reject-${Date.now()}`,
      proposalId: unapprovedProposal.proposalId,
      proposal: unapprovedProposal,
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    const report = await service.executeRepairJob(contract);
    expect(report.finalState).toBe('REJECTED');
    expect(report.approvalValidation.approved).toBe(false);
    expect(report.failureReason).toContain('must be \'approved\'');
    expect(report.patchApplication).toBeUndefined();
  });

  test('Rejects repair job if recorded source hash does not match current disk (stale proposal)', async () => {
    const service = new RepairExecutionService(repoRoot);
    const staleProposal: any = {
      schemaVersion: '1.0',
      proposalId: 'prop-test-stale',
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      humanReviewStatus: 'approved',
      status: 'proposed',
      localization: {
        status: 'localized',
        filePath: 'src/index.css',
        fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // Wrong hash
      },
      createdAt: new Date().toISOString(),
    };

    const contract: RepairJobContract = {
      jobId: `test-stale-${Date.now()}`,
      proposalId: staleProposal.proposalId,
      proposal: staleProposal,
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    const report = await service.executeRepairJob(contract);
    expect(report.finalState).toBe('REJECTED');
    expect(report.approvalValidation.sourceFreshnessVerified).toBe(false);
    expect(report.failureReason).toContain('Source hash mismatch');
  });

  test('Rejects repair job with unknown patch identifier', async () => {
    const service = new RepairExecutionService(repoRoot);
    const validProposal: any = {
      schemaVersion: '1.0',
      proposalId: 'prop-test-bad-patch',
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      humanReviewStatus: 'approved',
      status: 'proposed',
      localization: {
        status: 'localized',
        filePath: 'src/index.css',
        fileHash: currentCssHash,
      },
      createdAt: new Date().toISOString(),
    };

    const contract: RepairJobContract = {
      jobId: `test-unknown-patch-${Date.now()}`,
      proposalId: validProposal.proposalId,
      proposal: validProposal,
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'unknown-patch-999',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    const report = await service.executeRepairJob(contract);
    expect(report.finalState).toBe('REJECTED');
    expect(report.failureReason).toContain("Registered patch 'unknown-patch-999' not found");
  });

  test('Rejects invalid state machine transitions', async () => {
    const service = new RepairExecutionService(repoRoot);
    expect(() => service.transitionState('PENDING', 'PASSED')).toThrow(/Invalid state transition/);
    expect(() => service.transitionState('REJECTED', 'RUNNING_TESTS')).toThrow(/Invalid state transition/);
  });

  test('Executes end-to-end isolated repair in temporary worktree without modifying main working tree', async () => {
    const service = new RepairExecutionService(repoRoot);
    const approvedProposal: any = {
      schemaVersion: '1.0',
      proposalId: 'prop-test-pass-001',
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      humanReviewStatus: 'approved',
      status: 'proposed',
      reviewedBy: 'qa-engineer@omnisight.ai',
      reviewedAt: new Date().toISOString(),
      reviewNotes: 'Verified clean baseline comparison and test assertions.',
      localization: {
        status: 'localized',
        filePath: 'src/index.css',
        fileHash: currentCssHash,
      },
      createdAt: new Date().toISOString(),
    };

    const jobId = `e2e-job-${Date.now()}`;
    const contract: RepairJobContract = {
      jobId,
      proposalId: approvedProposal.proposalId,
      proposal: approvedProposal,
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    const report = await service.executeRepairJob(contract);

    // 1. Validate complete report contract
    expect(report.finalState).toBe('PASSED');
    expect(report.approvalValidation.approved).toBe(true);
    expect(report.approvalValidation.sourceFreshnessVerified).toBe(true);
    expect(report.patchApplication?.appliedSuccessfully).toBe(true);
    expect(report.patchApplication?.changedFiles).toEqual(['src/index.css']);
    expect(report.buildExecution?.passed).toBe(true);
    expect(report.visualValidation?.passed).toBe(true);
    expect(report.cleanupStatus.cleaned).toBe(true);
    expect(report.cleanupStatus.worktreeRemoved).toBe(true);

    // 2. Verify machine-readable report was persisted
    const savedReportPath = path.join(repoRoot, 'artifacts', 'repair-executions', jobId, 'repair_execution_report.json');
    expect(fs.existsSync(savedReportPath)).toBe(true);

    // 3. Strict Safety Invariant: Original working tree file was never modified!
    const postExecutionCssHash = computeFileHash(indexCssPath);
    expect(postExecutionCssHash).toBe(currentCssHash);
  });

  test('Review Dashboard detail page shows Execute Repair Job action and modal for approved proposals', async ({ page }) => {
    // Inject approved proposal into localStorage
    await page.addInitScript(() => {
      const mockApproved = [
        {
          schemaVersion: '1.0',
          proposalId: 'prop_approved_e2e_test',
          scenarioId: 'product-image-distortion',
          defectCategory: 'image_distortion',
          severity: 'medium',
          localization: {
            status: 'localized',
            filePath: 'src/index.css',
            fileHash: '0fd73158ca1b6976e2bd0255687bc4abc19d776fc2ab108de3f0adb61ba110fa',
            componentOrSelector: '.product-image',
            excerpt: {
              filePath: 'src/index.css',
              startLine: 446,
              endLine: 464,
              content: '.product-image { object-fit: fill; }',
              sha256: '0fd73158ca1b6976e2bd0255687bc4abc19d776fc2ab108de3f0adb61ba110fa',
            },
            evidence: [],
            uncertaintyNotes: [],
          },
          suspectedRootCause: 'object-fit: fill distortion',
          evidenceExplanation: ['Aspect ratio distorted'],
          proposedCorrection: {
            type: 'css_rule_modification',
            targetSelectorOrComponent: '.product-image',
            currentCode: 'object-fit: fill;',
            proposedCode: 'object-fit: cover;',
            diffSummary: 'Restore cover fit',
          },
          expectedVisualImprovement: 'Restore 4:3 natural aspect ratio',
          confidence: 'high',
          confidenceScore: 0.95,
          potentialRisks: [],
          requiredValidationTests: ['npm run build'],
          humanReviewStatus: 'approved',
          status: 'proposed',
          createdAt: new Date().toISOString(),
          isMock: true,
          sourceFreshness: 'fresh',
        },
      ];
      window.localStorage.setItem('omnisight:review-proposals', JSON.stringify(mockApproved));
    });

    await page.goto('/review/proposals/prop_approved_e2e_test');

    // Confirm Execute button is displayed for approved proposal
    const executeBtn = page.locator('[data-testid="btn-execute-repair"]');
    await expect(executeBtn).toBeVisible();

    // Click execute button to open confirmation dialog
    await executeBtn.click();
    const dialog = page.locator('[data-testid="repair-execution-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('A separate temporary Git worktree and branch will be created');

    // Confirm execution
    const confirmBtn = page.locator('[data-testid="btn-confirm-repair-exec"]');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click({ force: true });

    // Verify summary is rendered
    const summary = page.locator('[data-testid="repair-job-summary"]');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('PASSED');
    await expect(summary).toContainText('omnisight-repair/');
  });

  test('Line-Ending Normalization: matches and applies patch on CRLF file content and restores CRLF', async () => {
    const patch = getRegisteredPatch('patch-product-image-distortion-001')!;
    expect(patch).toBeDefined();

    // Create a CRLF version of targetMatchString wrapped in sample CSS
    const lfFile = `/* Header */\n${patch.targetMatchString}\n/* Footer */\n`;
    const crlfFile = lfFile.replace(/\n/g, '\r\n');
    expect(crlfFile).toContain('\r\n');

    // Apply patch deterministically
    const result = applyDeterministicPatch(crlfFile, patch);
    expect(result.success).toBe(true);
    expect(result.updatedContent).toContain('object-fit: cover');
    expect(result.updatedContent).toContain('\r\n'); // Preserves CRLF convention
    expect(result.updatedContent).not.toContain('object-fit: fill');
  });

  test('Line-Ending Normalization: matches and applies patch on LF file content and preserves LF', async () => {
    const patch = getRegisteredPatch('patch-low-contrast-text-003')!;
    expect(patch).toBeDefined();

    const lfFile = `/* Header */\n${patch.targetMatchString}\n/* Footer */\n`;
    expect(lfFile).not.toContain('\r\n');

    const result = applyDeterministicPatch(lfFile, patch);
    expect(result.success).toBe(true);
    expect(result.updatedContent).toContain('color: var(--color-text-body) !important');
    expect(result.updatedContent).not.toContain('\r\n'); // Preserves LF convention
  });

  test('Line-Ending Normalization: fails gracefully when target snippet is missing', async () => {
    const patch = getRegisteredPatch('patch-product-image-distortion-001')!;
    const missingTargetContent = `/* Some completely different CSS */\n.some-class { color: red; }\n`;

    const result = applyDeterministicPatch(missingTargetContent, patch);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Precondition check failed');
    expect(result.updatedContent).toBe(missingTargetContent);
  });

  test('Cross-Platform Command Execution: resolves npm safely on win32 and posix', async () => {
    const current = resolveNpmCommand(['run', 'build']);

    if (process.platform === 'win32') {
      expect(current.executable).toBe(process.execPath);
      expect(current.args[0]).toMatch(/npm-cli\.js$/);
      expect(fs.existsSync(current.args[0])).toBe(true);
      expect(current.args.slice(1)).toEqual(['run', 'build']);
    } else {
      expect(current.executable).toBe('npm');
      expect(current.args).toEqual(['run', 'build']);
    }
  });

  test('Cross-Platform Command Execution: OMNISIGHT_NPM_CLI override is validated on win32', async () => {
    test.skip(process.platform !== 'win32', 'Windows-only behavior');

    const real = resolveNpmCommand(['--version']).args[0];
    expect(fs.existsSync(real)).toBe(true);

    const overridden = resolveNpmCommand(['--version'], { OMNISIGHT_NPM_CLI: real });
    expect(overridden.args[0]).toBe(real);

    expect(() =>
      resolveNpmCommand(['--version'], { OMNISIGHT_NPM_CLI: 'C:\\does-not-exist\\npm-cli.js' })
    ).toThrow(/OMNISIGHT_NPM_CLI/);
  });

  test('Cross-Platform Command Execution: ignores npm_execpath unless it is a real npm-cli.js', async () => {
    test.skip(process.platform !== 'win32', 'Windows-only behavior');

    const result = resolveNpmCommand(['run', 'build'], {
      npm_execpath: 'C:\\somewhere\\npx-cli.js',
    });
    expect(result.args[0]).not.toContain('somewhere');
    expect(result.args[0]).toMatch(/npm-cli\.js$/);
    expect(fs.existsSync(result.args[0])).toBe(true);
  });

  test('Cross-Platform Command Execution: npx runs without a shell and without npx.cmd', async () => {
    const resolved = resolveNpxCommand(['--version']);

    if (process.platform === 'win32') {
      expect(resolved.executable).toBe(process.execPath);
      expect(resolved.args[0]).toMatch(/npx-cli\.js$/);
      expect(fs.existsSync(resolved.args[0])).toBe(true);
    } else {
      expect(resolved.executable).toBe('npx');
    }

    const service = new RepairExecutionService(repoRoot);
    const res = await service.runCommand('npx --version', repoRoot);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('Cross-Platform Command Execution: runCommand captures exit codes, stdout, and stderr reliably', async () => {
    const service = new RepairExecutionService(repoRoot);
    // Successful command
    const okRes = await service.runCommand('node -e console.log("hello-cross-platform")', repoRoot);
    expect(okRes.exitCode).toBe(0);
    expect(okRes.stdout.trim()).toBe('hello-cross-platform');

    // Failing command
    const failRes = await service.runCommand('node -e process.exit(42)', repoRoot);
    expect(failRes.exitCode).toBe(42);
  });

  test('Security: runCommand only runs allowlisted executables', async () => {
    const service = new RepairExecutionService(repoRoot);

    const denied = await service.runCommand('git status', repoRoot);
    expect(denied.exitCode).toBe(1);
    expect(denied.stderr).toContain('not allowed');

    const empty = await service.runCommand('   ', repoRoot);
    expect(empty.exitCode).toBe(1);
  });

  test('Security: contract validation rejects unsafe jobId and base commit values', async () => {
    const base: any = {
      jobId: 'safe-job_1',
      proposalId: 'prop-x',
      proposal: {},
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetBaseCommit: 'HEAD',
    };
    expect(validateRepairJobContract(base).valid).toBe(true);

    for (const badId of ['../escape', 'a/b', 'a\\b', 'a b', 'a.b', '']) {
      expect(validateRepairJobContract({ ...base, jobId: badId }).valid).toBe(false);
    }
    for (const badRef of ['--all', '-x', 'HEAD main', 'a\nb']) {
      expect(validateRepairJobContract({ ...base, targetBaseCommit: badRef }).valid).toBe(false);
    }
  });

  test('Security: executeRepairJob refuses a path-traversal jobId before touching the disk', async () => {
    const service = new RepairExecutionService(repoRoot);
    const marker = `escape-canary-${Date.now()}`;
    const contract: any = {
      jobId: `../../${marker}`,
      proposalId: 'prop-x',
      proposal: {},
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
    };

    await expect(service.executeRepairJob(contract)).rejects.toThrow(/Invalid repair job contract/);
    // Nothing may have been created outside artifacts/repair-executions
    expect(fs.existsSync(path.join(repoRoot, marker))).toBe(false);
  });

  test('Security: WorktreeManager rejects option-like commit refs', async () => {
    const manager = new WorktreeManager(repoRoot);

    expect(await manager.verifyCommitExists('HEAD')).toBe(true);
    expect(await manager.verifyCommitExists('--all')).toBe(false);
    expect(await manager.verifyCommitExists('-x')).toBe(false);
    await expect(manager.createWorktree(`opt-ref-${Date.now()}`, '--all')).rejects.toThrow(
      /could not be verified/
    );
  });

  test('Isolation: each worktree installs its own node_modules (no link to the real one)', async () => {
    const service = new RepairExecutionService(repoRoot);
    const proposal: any = {
      schemaVersion: '1.0',
      proposalId: 'prop-test-isolation',
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      humanReviewStatus: 'approved',
      status: 'proposed',
      reviewedBy: 'qa-engineer@omnisight.ai',
      reviewedAt: new Date().toISOString(),
      localization: {
        status: 'localized',
        filePath: 'src/index.css',
        fileHash: currentCssHash,
      },
      createdAt: new Date().toISOString(),
    };

    const contract: RepairJobContract = {
      jobId: `isolation-job-${Date.now()}`,
      proposalId: proposal.proposalId,
      proposal,
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    // Runs after the build, so we can inspect the worktree while it still exists.
    let observed: { exists: boolean; isLink: boolean } | undefined;
    const originalEvaluate = (service as any).evaluateVisualRepair.bind(service);
    (service as any).evaluateVisualRepair = async (_patch: unknown, worktreePath: string) => {
      const nm = path.join(worktreePath, 'node_modules');
      observed = { exists: fs.existsSync(nm), isLink: fs.lstatSync(nm).isSymbolicLink() };
      return {
        passed: false,
        defectCategory: 'product-image-distortion',
        route: '/products',
        viewport: { width: 1280, height: 800 },
        assertionSummary: 'Stopped after isolation check',
        unrelatedRegressionsDetected: false,
      };
    };

    try {
      const report = await service.executeRepairJob(contract);
      expect(report.failureReason).toContain('Stopped after isolation check');
      expect(report.buildExecution?.passed).toBe(true);
      expect(observed).toEqual({ exists: true, isLink: false });
      expect(report.cleanupStatus.worktreeRemoved).toBe(true);

      // The real node_modules must be completely untouched
      expect(
        fs.existsSync(path.join(repoRoot, 'node_modules', '@playwright', 'test', 'package.json'))
      ).toBe(true);
    } finally {
      (service as any).evaluateVisualRepair = originalEvaluate;
    }
  });

  test('Worktree Lifecycle: cleans up worktree on unexpected failure in isolated worktree', async () => {
    const service = new RepairExecutionService(repoRoot);
    const worktreeManager = new WorktreeManager(repoRoot);

    const approvedProposal: any = {
      schemaVersion: '1.0',
      proposalId: 'prop-test-cleanup-on-fail',
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      humanReviewStatus: 'approved',
      status: 'proposed',
      reviewedBy: 'qa-engineer@omnisight.ai',
      reviewedAt: new Date().toISOString(),
      localization: {
        status: 'localized',
        filePath: 'src/index.css',
        fileHash: currentCssHash,
      },
      createdAt: new Date().toISOString(),
    };

    const jobId = `fail-cleanup-job-${Date.now()}`;
    const contract: RepairJobContract = {
      jobId,
      proposalId: approvedProposal.proposalId,
      proposal: approvedProposal,
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    // Spy on evaluateVisualRepair to simulate a validation failure mid-job
    const originalEvaluate = (service as any).evaluateVisualRepair.bind(service);
    (service as any).evaluateVisualRepair = async () => {
      return {
        passed: false,
        defectCategory: 'product-image-distortion',
        route: '/products',
        viewport: { width: 1280, height: 800 },
        assertionSummary: 'Simulated visual assertion failure for cleanup test',
        unrelatedRegressionsDetected: false,
      };
    };

    try {
      const report = await service.executeRepairJob(contract);
      expect(report.finalState).toBe('FAILED');
      expect(report.failureReason).toContain('Simulated visual assertion failure');

      // Crucial: worktree must be cleaned up even though repair failed!
      expect(report.cleanupStatus.cleaned).toBe(true);
      expect(report.cleanupStatus.worktreeRemoved).toBe(true);

      // Verify worktree folder is gone from disk
      const worktreePath = path.join(repoRoot, 'artifacts', 'repair-worktrees', jobId);
      expect(fs.existsSync(worktreePath)).toBe(false);
    } finally {
      (service as any).evaluateVisualRepair = originalEvaluate;
    }
  });

  test('Worktree Manager: cleanupWorktree is idempotent and safe for non-existent worktrees', async () => {
    const worktreeManager = new WorktreeManager(repoRoot);
    const nonExistentJobId = `non-existent-${Date.now()}`;

    // Cleaning an already non-existent worktree should return clean without throwing
    const result = await worktreeManager.cleanupWorktree(nonExistentJobId);
    expect(result.worktreeRemoved).toBe(true);
    expect(result.branchRemoved).toBe(false);
  });

  test('Worktree Manager: cleanup never deletes the real node_modules behind a junction', async () => {
    // Hermetic: uses a throwaway git repo in the OS temp folder, never the real project's node_modules.
    const os = await import('node:os');
    const { execFileSync } = await import('node:child_process');

    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'omnisight-junction-'));
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: sandbox, stdio: 'pipe' });
      git('init');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      fs.writeFileSync(path.join(sandbox, 'README.md'), 'sandbox\n');
      git('add', '.');
      git('-c', 'commit.gpgsign=false', 'commit', '-m', 'init');

      // A fake "real node_modules" containing a sentinel file that must never be lost
      const fakeNodeModules = path.join(sandbox, 'node_modules');
      fs.mkdirSync(path.join(fakeNodeModules, '@playwright', 'test'), { recursive: true });
      const sentinel = path.join(fakeNodeModules, '@playwright', 'test', 'package.json');
      fs.writeFileSync(sentinel, '{}');

      const manager = new WorktreeManager(sandbox);
      const jobId = `junction-guard-${Date.now()}`;
      const info = await manager.createWorktree(jobId);

      // Link it into the worktree the same way RepairExecutionService does
      fs.symlinkSync(fakeNodeModules, path.join(info.worktreePath, 'node_modules'), 'junction');

      const result = await manager.cleanupWorktree(jobId);

      expect(result.worktreeRemoved).toBe(true);
      expect(fs.existsSync(info.worktreePath)).toBe(false);
      // The crucial assertion: the packages behind the junction survived
      expect(fs.existsSync(sentinel)).toBe(true);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  test('Real Browser Visual Verification: captures real post-repair screenshot, DOM evidence, and computed metrics', async () => {
    const service = new RepairExecutionService(repoRoot);
    const approvedProposal: any = {
      schemaVersion: '1.0',
      proposalId: 'prop-real-browser-test',
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      humanReviewStatus: 'approved',
      status: 'proposed',
      reviewedBy: 'qa-engineer@omnisight.ai',
      reviewedAt: new Date().toISOString(),
      localization: {
        status: 'localized',
        filePath: 'src/index.css',
        fileHash: currentCssHash,
      },
      createdAt: new Date().toISOString(),
    };

    const jobId = `e2e-vis-job-${Date.now()}`;
    const contract: RepairJobContract = {
      jobId,
      proposalId: approvedProposal.proposalId,
      proposal: approvedProposal,
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    const report = await service.executeRepairJob(contract);
    expect(report.finalState).toBe('PASSED');
    expect(report.visualValidation).toBeDefined();
    expect(report.visualValidation?.passed).toBe(true);

    // Assert that real visual evidence files exist on disk
    expect(report.visualValidation?.afterScreenshotPath).toBeDefined();
    expect(fs.existsSync(report.visualValidation!.afterScreenshotPath!)).toBe(true);

    const domFile = path.join(repoRoot, 'artifacts', 'repair-executions', jobId, 'dom_post_repair.html');
    expect(fs.existsSync(domFile)).toBe(true);

    // Verify rendered metrics were captured
    expect(report.visualValidation?.repairedMetric?.objectFit).toBe('cover');
    expect(report.visualValidation?.repairedMetric?.renderedAspectRatio).toBeGreaterThan(1.2);
    expect(report.visualValidation?.beforeScreenshotPath).toBeDefined();
    expect(fs.existsSync(report.visualValidation!.beforeScreenshotPath!)).toBe(true);
  });

  test('Real Browser Visual Verification: accurately flags failure when rendered visual metrics fail assertion', async () => {
    const service = new RepairExecutionService(repoRoot);
    const approvedProposal: any = {
      schemaVersion: '1.0',
      proposalId: 'prop-real-fail-test',
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      humanReviewStatus: 'approved',
      status: 'proposed',
      reviewedBy: 'qa-engineer@omnisight.ai',
      reviewedAt: new Date().toISOString(),
      localization: {
        status: 'localized',
        filePath: 'src/index.css',
        fileHash: currentCssHash,
      },
      createdAt: new Date().toISOString(),
    };

    const jobId = `e2e-vis-fail-${Date.now()}`;
    const contract: RepairJobContract = {
      jobId,
      proposalId: approvedProposal.proposalId,
      proposal: approvedProposal,
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    // Override evaluateVisualRepair to test failure reporting path with real report fields
    const originalEvaluate = (service as any).evaluateVisualRepair.bind(service);
    (service as any).evaluateVisualRepair = async () => {
      return {
        passed: false,
        defectCategory: 'product-image-distortion',
        route: '/products?defect=product-image-distortion',
        viewport: { width: 1440, height: 900 },
        assertionSummary: 'Product image distortion verification failed: object-fit is fill, media height is 380px.',
        repairedMetric: { objectFit: 'fill', mediaHeight: '380px' },
        unrelatedRegressionsDetected: false,
      };
    };

    try {
      const report = await service.executeRepairJob(contract);
      expect(report.finalState).toBe('FAILED');
      expect(report.failureReason).toContain('Product image distortion verification failed');
      expect(report.cleanupStatus.cleaned).toBe(true);
      expect(report.cleanupStatus.worktreeRemoved).toBe(true);
    } finally {
      (service as any).evaluateVisualRepair = originalEvaluate;
    }
  });

  test('Required Tests: validates and allows authorized test patterns while rejecting arbitrary commands', async () => {
    const service = new RepairExecutionService(repoRoot);

    // Valid test commands
    expect(service.validateAndResolveTestCommand('npm run build').valid).toBe(true);
    expect(service.validateAndResolveTestCommand('npm test').valid).toBe(true);
    expect(service.validateAndResolveTestCommand('tests/defect-injection.spec.ts').valid).toBe(true);
    expect(service.validateAndResolveTestCommand('npx playwright test tests/responsive.spec.ts').valid).toBe(true);
    expect(service.validateAndResolveTestCommand('npx playwright test --reporter=list tests/shopping-cart.spec.ts').valid).toBe(true);

    // Rejection of arbitrary commands and shell injection
    expect(service.validateAndResolveTestCommand('rm -rf /').valid).toBe(false);
    expect(service.validateAndResolveTestCommand('npm test; rm -rf /').valid).toBe(false);
    expect(service.validateAndResolveTestCommand('npx playwright test && echo hacked').valid).toBe(false);
    expect(service.validateAndResolveTestCommand('npx playwright test | cat').valid).toBe(false);
    expect(service.validateAndResolveTestCommand('curl https://malicious.com').valid).toBe(false);
    expect(service.validateAndResolveTestCommand('tests/../../etc/passwd.spec.ts').valid).toBe(false);
    expect(service.validateAndResolveTestCommand('').valid).toBe(false);
  });

  test('Required Tests: executes required test in isolated worktree and marks repair PASSED', async () => {
    const service = new RepairExecutionService(repoRoot);
    const approvedProposal: any = {
      schemaVersion: '1.0',
      proposalId: 'prop-test-req-tests-pass',
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      humanReviewStatus: 'approved',
      status: 'proposed',
      reviewedBy: 'qa-engineer@omnisight.ai',
      reviewedAt: new Date().toISOString(),
      requiredValidationTests: ['tests/responsive.spec.ts'],
      localization: {
        status: 'localized',
        filePath: 'src/index.css',
        fileHash: currentCssHash,
      },
      createdAt: new Date().toISOString(),
    };

    const jobId = `req-pass-job-${Date.now()}`;
    const contract: RepairJobContract = {
      jobId,
      proposalId: approvedProposal.proposalId,
      proposal: approvedProposal,
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    const report = await service.executeRepairJob(contract);
    expect(report.finalState).toBe('PASSED');
    expect(report.buildExecution?.passed).toBe(true);
    expect(report.testExecution).toBeDefined();
    expect(report.testExecution?.passed).toBe(true);
    expect(report.testExecution?.command).toContain('tests/responsive.spec.ts');
    expect(report.testExecution?.passedTests).toBeGreaterThan(0);
    expect(report.cleanupStatus.cleaned).toBe(true);
    expect(report.cleanupStatus.worktreeRemoved).toBe(true);
  });

  test('Required Tests: failing required test fails the repair job and cleans up worktree', async () => {
    const service = new RepairExecutionService(repoRoot);
    const approvedProposal: any = {
      schemaVersion: '1.0',
      proposalId: 'prop-test-req-tests-fail',
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      humanReviewStatus: 'approved',
      status: 'proposed',
      reviewedBy: 'qa-engineer@omnisight.ai',
      reviewedAt: new Date().toISOString(),
      requiredValidationTests: ['tests/defect-injection.spec.ts'],
      localization: {
        status: 'localized',
        filePath: 'src/index.css',
        fileHash: currentCssHash,
      },
      createdAt: new Date().toISOString(),
    };

    const jobId = `req-fail-job-${Date.now()}`;
    const contract: RepairJobContract = {
      jobId,
      proposalId: approvedProposal.proposalId,
      proposal: approvedProposal,
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    // Spy on executeWorktreeTests to simulate test failure
    const originalExec = service.executeWorktreeTests.bind(service);
    service.executeWorktreeTests = async () => {
      return {
        passed: false,
        error: "Required test 'npx playwright test tests/defect-injection.spec.ts' failed with exit code 1",
        testExecution: {
          command: 'npx playwright test tests/defect-injection.spec.ts',
          exitCode: 1,
          passed: false,
          totalTests: 8,
          passedTests: 7,
          failedTests: 1,
          durationMs: 1200,
          stdoutSummary: '1 failed test',
          stderrSummary: 'Assertion failed: expected 1 to be 2',
        },
      };
    };

    try {
      const report = await service.executeRepairJob(contract);
      expect(report.finalState).toBe('FAILED');
      expect(report.failureReason).toContain('failed with exit code 1');
      expect(report.testExecution?.passed).toBe(false);
      expect(report.testExecution?.failedTests).toBe(1);
      // Worktree must be cleaned up
      expect(report.cleanupStatus.cleaned).toBe(true);
      expect(report.cleanupStatus.worktreeRemoved).toBe(true);
      const worktreePath = path.join(repoRoot, 'artifacts', 'repair-worktrees', jobId);
      expect(fs.existsSync(worktreePath)).toBe(false);
    } finally {
      service.executeWorktreeTests = originalExec;
    }
  });

  test('Required Tests: invalid or unauthorized test command rejects repair job before execution', async () => {
    const service = new RepairExecutionService(repoRoot);
    const maliciousProposal: any = {
      schemaVersion: '1.0',
      proposalId: 'prop-test-malicious',
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      humanReviewStatus: 'approved',
      status: 'proposed',
      reviewedBy: 'qa-engineer@omnisight.ai',
      reviewedAt: new Date().toISOString(),
      requiredValidationTests: ['cat /etc/passwd; echo injection'],
      localization: {
        status: 'localized',
        filePath: 'src/index.css',
        fileHash: currentCssHash,
      },
      createdAt: new Date().toISOString(),
    };

    const jobId = `req-malicious-job-${Date.now()}`;
    const contract: RepairJobContract = {
      jobId,
      proposalId: maliciousProposal.proposalId,
      proposal: maliciousProposal,
      approvedSourcePaths: ['src/index.css'],
      approvedPatchId: 'patch-product-image-distortion-001',
      targetRepositoryPath: repoRoot,
      targetBaseCommit: 'HEAD',
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    const report = await service.executeRepairJob(contract);
    expect(report.finalState).toBe('FAILED');
    expect(report.failureReason).toContain('forbidden shell metacharacters');
    expect(report.cleanupStatus.cleaned).toBe(true);
    expect(report.cleanupStatus.worktreeRemoved).toBe(true);
  });

  test('Required Tests: executes with timeout and safely cleans up upon timeout', async () => {
    const service = new RepairExecutionService(repoRoot);
    // Directly test executeWorktreeTests timeout behavior
    const outcome = await service.executeWorktreeTests(
      ['npm run build'],
      repoRoot,
      { timeoutMs: 1 } // impossibly short timeout to guarantee timeout trigger
    );

    expect(outcome.passed).toBe(false);
    expect(outcome.error).toContain('timed out');
    expect(outcome.testExecution?.exitCode).toBe(124);
  });
});
