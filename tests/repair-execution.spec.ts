import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { RepairExecutionService } from '../scripts/repair/repair-execution-service';
import { RepairJobContract } from '../scripts/repair/repair-job-schema';
import { WorktreeManager } from '../scripts/repair/worktree-manager';
import { getRegisteredPatch, REGISTERED_PATCHES } from '../scripts/repair/patch-registry';
import { computeFileHash } from '../scripts/vlm/source-path-security';

test.describe('Step 4.6 — Isolated Patch Application & Validation Pipeline', () => {
  const repoRoot = process.cwd();
  const indexCssPath = path.resolve(repoRoot, 'src/index.css');
  const currentCssHash = computeFileHash(indexCssPath);

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
    await confirmBtn.click();

    // Verify summary is rendered
    const summary = page.locator('[data-testid="repair-job-summary"]');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('PASSED');
    await expect(summary).toContainText('omnisight-repair/');
  });
});
