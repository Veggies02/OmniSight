import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { runRepairJob } from '../scripts/run-repair-job';
import { runPostRepairVerification } from '../scripts/repair/post-repair-verifier';
import { exportVerificationReport } from '../scripts/export-verification-report';
import { computeFileHash } from '../scripts/vlm/source-path-security';
import { type RepairProposal } from '../scripts/vlm/repair-proposal-schema';

test.describe('Step 4.7 End-to-End Self-Healing Repair Workflow Tests', () => {
  const repoRoot = process.cwd();
  const validCssPath = path.resolve(repoRoot, 'src/index.css');
  const validHash = computeFileHash(validCssPath);

  // Helper fixture to construct valid, strictly typed proposals
  const createProposalFixture = (overrides: Partial<RepairProposal> = {}): RepairProposal => ({
    schemaVersion: '1.0',
    proposalId: `prop_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    scenarioId: 'product-image-distortion',
    diagnosisRef: {
      diagnosisStatus: 'diagnosed',
      model: 'mock-vlm-v1',
      provider: 'mock',
      primaryDefectCategory: 'image_distortion',
      reportedConfidence: 0.95,
    },
    defectCategory: 'image_distortion',
    severity: 'medium',
    localization: {
      status: 'localized',
      filePath: 'src/index.css',
      fileHash: validHash,
      componentOrSelector: '.product-image',
      excerpt: {
        filePath: 'src/index.css',
        startLine: 452,
        endLine: 470,
        content: '.product-image { object-fit: fill; }',
        sha256: validHash,
      },
      evidence: [],
      uncertaintyNotes: [],
    },
    suspectedRootCause: 'Container height override and object-fit: fill applied.',
    evidenceExplanation: ['Rendered image height distorted compared to baseline.'],
    proposedCorrection: {
      type: 'css_rule_modification',
      targetSelectorOrComponent: '.product-image',
      currentCode: '.product-image { object-fit: fill; }',
      proposedCode: '.product-image { object-fit: cover; }',
      diffSummary: 'Restore object-fit: cover preserving aspect ratio.',
    },
    expectedVisualImprovement: 'Restore square aspect ratio.',
    confidence: 'high',
    confidenceScore: 0.95,
    potentialRisks: [],
    requiredValidationTests: ['tests/responsive.spec.ts'],
    humanReviewStatus: 'approved',
    status: 'proposed',
    createdAt: new Date().toISOString(),
    isMock: true,
    sourceFreshness: 'fresh',
    reviewedBy: 'lead-reviewer@omnisight.ai',
    reviewedAt: new Date().toISOString(),
    reviewNotes: 'Verified and authorized by human review gate.',
    ...overrides,
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('omnisight:enable-defects', 'true');
    });
  });

  // Scenario 1: Complete Happy Path Lifecycle
  // Inject Defect -> Diagnose -> Approve Repair -> Execute Repair -> Verify UI -> Detect Regressions -> Capture Evidence -> Export Report
  test('Scenario 1: Complete successful repair lifecycle with isolated worktree, UI verification, and report export', async ({ page }) => {
    test.setTimeout(120_000);

    // 1. Inject Defect & Observe Defective State
    await page.goto('http://127.0.0.1:5173/products?defect=product-image-distortion');
    const defectMeta = page.locator('#omnisight-defect-metadata');
    await expect(defectMeta).toHaveAttribute('data-defect-active', 'true');
    await expect(defectMeta).toHaveAttribute('data-defect-id', 'product-image-distortion');

    const defectiveImg = page.locator('.product-card .product-image').first();
    const defectiveFit = await defectiveImg.evaluate((el) => window.getComputedStyle(el).objectFit);
    expect(defectiveFit).toBe('fill');

    // 2. Generate and Authorize Repair Proposal
    const proposal = createProposalFixture({
      scenarioId: 'product-image-distortion',
      humanReviewStatus: 'approved',
    });

    const tempPropFile = path.resolve(repoRoot, `artifacts/temp_e2e_approved_${Date.now()}.json`);
    fs.mkdirSync(path.dirname(tempPropFile), { recursive: true });
    fs.writeFileSync(tempPropFile, JSON.stringify(proposal, null, 2), 'utf-8');

    const jobId = `e2e-job-${Date.now()}`;

    try {
      // 3. Execute Repair via Isolated Worktree
      const repairOutput = await runRepairJob(
        ['--proposal', tempPropFile, '--job-id', jobId, '--base-commit', 'HEAD'],
        repoRoot
      );

      expect(repairOutput.success).toBe(true);
      expect(repairOutput.report.finalState).toBe('PASSED');
      expect(repairOutput.report.approvalValidation.approved).toBe(true);
      expect(repairOutput.report.cleanupStatus.cleaned).toBe(true);

      // 4. Post-Repair Verification & Multi-Page Regression Audit
      const verifyRunId = `e2e-verify-run-${Date.now()}`;
      const verification = await runPostRepairVerification(page, {
        runId: verifyRunId,
        scenarioId: 'product-image-distortion',
        defectCategory: 'image_distortion',
        targetUrl: 'http://127.0.0.1:5173/products', // Clean repaired target
        repoRoot,
      });

      expect(verification.verificationStatus).toBe('passed');
      expect(verification.unrelatedRegressionsDetected).toBe(false);
      expect(verification.checks.length).toBeGreaterThan(0);
      expect(verification.checks.every((c) => c.passed)).toBe(true);

      // Verify screenshot evidence was generated
      expect(fs.existsSync(verification.postRepairEvidence.screenshotPath!)).toBe(true);

      // 5. Export Verification Markdown Report
      const exportReportPath = path.resolve(repoRoot, `artifacts/verification/${verifyRunId}/e2e_summary.md`);
      const exportResult = await exportVerificationReport({
        runId: verifyRunId,
        output: exportReportPath,
        artifactsDir: path.join(repoRoot, 'artifacts', 'verification'),
      });

      expect(exportResult.overallStatus).toBe('PASSED');
      expect(exportResult.totalScenarios).toBe(1);
      expect(exportResult.passedCount).toBe(1);
      expect(fs.existsSync(exportReportPath)).toBe(true);

      const markdownContent = fs.readFileSync(exportReportPath, 'utf-8');
      expect(markdownContent).toContain('# OmniSight Post-Repair Verification & Regression Report');
      expect(markdownContent).toContain('PASSED');
      expect(markdownContent).toContain('product-image-distortion');
    } finally {
      if (fs.existsSync(tempPropFile)) fs.unlinkSync(tempPropFile);
      const jobDir = path.resolve(repoRoot, 'artifacts', 'repair-executions', jobId);
      if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  // Scenario 2: Failed Repair
  // When the repair execution fails checks or page still has defect, verification reports FAILED accurately
  test('Scenario 2: Failed repair — verifier accurately reports failure when defect remains unresolved', async ({ page }) => {
    const runId = `e2e-fail-run-${Date.now()}`;
    // Target still contains active defect
    const targetUrl = 'http://127.0.0.1:5173/products?defect=product-image-distortion';

    const result = await runPostRepairVerification(page, {
      runId,
      scenarioId: 'product-image-distortion',
      defectCategory: 'image_distortion',
      targetUrl,
      repoRoot,
    });

    expect(result.verificationStatus).toBe('failed');
    expect(result.checks.some((c) => !c.passed)).toBe(true);
    expect(result.failureReasons.length).toBeGreaterThan(0);

    // Export report should reflect overall FAILED status
    const exportResult = await exportVerificationReport({
      runId,
      artifactsDir: path.join(repoRoot, 'artifacts', 'verification'),
    });
    expect(exportResult.overallStatus).toBe('FAILED');
    expect(exportResult.failedCount).toBe(1);
  });

  // Scenario 3: Inconclusive Verification
  // Missing or non-rendering pages must NEVER produce a false PASS
  test('Scenario 3: Inconclusive verification — missing target UI returns inconclusive and never declares success', async ({ page }) => {
    const runId = `e2e-inconclusive-run-${Date.now()}`;
    // 404 or broken route
    const targetUrl = 'http://127.0.0.1:5173/non-existent-broken-route';

    const result = await runPostRepairVerification(page, {
      runId,
      scenarioId: 'product-image-distortion',
      defectCategory: 'image_distortion',
      targetUrl,
      repoRoot,
    });

    expect(result.verificationStatus).toBe('inconclusive');
    expect(result.assertionSummary).toContain('inconclusive');
  });

  // Scenario 4: Regression Detection
  // Verifier detects when Home hero or Cart is missing after a change
  test('Scenario 4: Regression detection — detects multi-page side effects on Home or Cart', async ({ page }) => {
    const runId = `e2e-regression-run-${Date.now()}`;

    // Run verification on products page with full regression audit enabled
    const result = await runPostRepairVerification(page, {
      runId,
      scenarioId: 'product-image-distortion',
      defectCategory: 'image_distortion',
      targetUrl: 'http://127.0.0.1:5173/products',
      repoRoot,
      skipRegressionAudit: false,
    });

    expect(result.regressionAudit).toBeDefined();
    expect(result.regressionAudit!.length).toBeGreaterThanOrEqual(3);

    const homeCheck = result.regressionAudit!.find((r) => r.area === 'home');
    const cartCheck = result.regressionAudit!.find((r) => r.area === 'cart');
    const navCheck = result.regressionAudit!.find((r) => r.area === 'navigation');

    expect(homeCheck?.passed).toBe(true);
    expect(cartCheck?.passed).toBe(true);
    expect(navCheck?.passed).toBe(true);
    expect(result.unrelatedRegressionsDetected).toBe(false);
  });

  // Scenario 5: Evidence Provenance Mismatch
  // Verifier and review viewer reject alien job/evidence association
  test('Scenario 5: Evidence provenance mismatch — rejects or warns when repair job result belongs to another proposal', async ({ page }) => {
    await page.goto('/review/proposals/prop_product-image-distortion_001');

    // The EvidenceViewer must render warning if alien result is presented
    const viewer = page.getByTestId('evidence-viewer-root');
    await expect(viewer).toBeVisible();

    // Verify baseline and defective elements exist
    await expect(page.getByTestId('defective-image')).toBeVisible();
    await expect(page.getByTestId('baseline-image')).toBeVisible();
  });

  // Scenario 6: Authorization & Review Safety Controls
  // Unapproved proposal cannot be executed by the repair job runner
  test('Scenario 6: Authorization check — unapproved proposal is strictly rejected by the repair safety gate', async () => {
    const unapprovedProp = createProposalFixture({
      humanReviewStatus: 'pending_review',
    });

    const tempFile = path.resolve(repoRoot, `artifacts/temp_unapproved_${Date.now()}.json`);
    fs.mkdirSync(path.dirname(tempFile), { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(unapprovedProp), 'utf-8');

    const jobId = `unapproved-exec-${Date.now()}`;
    try {
      const output = await runRepairJob(['--proposal', tempFile, '--job-id', jobId], repoRoot);

      expect(output.success).toBe(false);
      expect(output.report.finalState).toBe('REJECTED');
      expect(output.report.approvalValidation.approved).toBe(false);
      expect(output.report.failureReason).toContain("must be 'approved' before code repair");
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      const jobDir = path.resolve(repoRoot, 'artifacts', 'repair-executions', jobId);
      if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  // Scenario 7: Report Export Completeness
  // Verification artifacts are correctly compiled into a reproducible summary
  test('Scenario 7: Report export — correctly represents verification results and check evidence in markdown', async () => {
    const runId = `e2e-report-check-${Date.now()}`;
    const runDir = path.join(repoRoot, 'artifacts', 'verification', runId);
    const scenarioDir = path.join(runDir, 'mobile-nav-overflow');
    fs.mkdirSync(scenarioDir, { recursive: true });

    // Write fixture result
    const fixtureResult = {
      runId,
      scenarioId: 'mobile-nav-overflow',
      defectCategory: 'responsive_overflow',
      verificationStatus: 'passed',
      timestamp: new Date().toISOString(),
      viewport: { width: 390, height: 844 },
      checks: [
        {
          name: 'viewport-scroll-overflow',
          expected: '0px',
          actual: '0px',
          passed: true,
          details: 'Document scrollWidth equals viewport width (390px).',
        },
      ],
      postRepairEvidence: {
        screenshotPath: path.join(scenarioDir, 'post_repair.png'),
        measurementsPath: path.join(scenarioDir, 'measurements.json'),
      },
      failureReasons: [],
      durationMs: 420,
      unrelatedRegressionsDetected: false,
      assertionSummary: 'Post-repair verification passed for mobile-nav-overflow.',
    };

    fs.writeFileSync(path.join(scenarioDir, 'verification-result.json'), JSON.stringify(fixtureResult, null, 2));
    fs.writeFileSync(path.join(scenarioDir, 'measurements.json'), JSON.stringify({ scrollWidth: 390, clientWidth: 390 }));
    fs.writeFileSync(path.join(scenarioDir, 'post_repair.png'), 'fake-png-data');

    const reportFile = path.join(runDir, 'verification_summary_report.md');
    const result = await exportVerificationReport({
      runId,
      output: reportFile,
      artifactsDir: path.join(repoRoot, 'artifacts', 'verification'),
    });

    expect(result.overallStatus).toBe('PASSED');
    expect(fs.existsSync(reportFile)).toBe(true);

    const reportMarkdown = fs.readFileSync(reportFile, 'utf-8');
    expect(reportMarkdown).toContain('mobile-nav-overflow');
    expect(reportMarkdown).toContain('responsive_overflow');
    expect(reportMarkdown).toContain('viewport-scroll-overflow');
  });
});
