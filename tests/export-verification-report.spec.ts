import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  parseExportCliArgs,
  exportVerificationReport,
  generateVerificationMarkdownReport,
  loadRunScenarios,
  listVerificationRuns,
} from '../scripts/export-verification-report';

test.describe('Verification Evidence Export CLI & Report Generator', () => {
  const repoRoot = process.cwd();
  const testArtifactsBase = path.join(repoRoot, 'artifacts', 'verification');
  const tempFixtureBase = path.join(repoRoot, 'test-results', `export-test-${Date.now()}`);

  test.beforeAll(() => {
    fs.mkdirSync(tempFixtureBase, { recursive: true });
  });

  test.afterAll(() => {
    if (fs.existsSync(tempFixtureBase)) {
      fs.rmSync(tempFixtureBase, { recursive: true, force: true });
    }
  });

  // Test 1: CLI Argument Parsing & Validation
  test('Test 1: CLI Argument Parsing — validates arguments and prevents path traversal', () => {
    // Valid args
    const valid = parseExportCliArgs(['--run-id', 'test-run-123', '--output', 'reports/test.md']);
    expect(valid.runId).toBe('test-run-123');
    expect(valid.output).toBe('reports/test.md');

    // Equated args
    const equated = parseExportCliArgs(['--run-id=run-abc', '--output=out.md']);
    expect(equated.runId).toBe('run-abc');
    expect(equated.output).toBe('out.md');

    // Missing value
    expect(() => parseExportCliArgs(['--run-id'])).toThrow(/Missing value for --run-id/);

    // Path traversal rejection
    expect(() => parseExportCliArgs(['--run-id', '../forbidden'])).toThrow(/Path traversal characters are strictly forbidden/);
    expect(() => parseExportCliArgs(['--run-id', 'dir/secret'])).toThrow(/Path traversal characters are strictly forbidden/);
  });

  // Test 2: Run with all scenarios passing
  test('Test 2: All scenarios passing — exports PASSED report with full check details', async () => {
    const runId = `fixture-all-pass-${Date.now()}`;
    const runDir = path.join(tempFixtureBase, runId);
    const scenarioDir = path.join(runDir, 'product-image-distortion');
    fs.mkdirSync(scenarioDir, { recursive: true });

    // Mock passing result
    const passResult = {
      runId,
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      verificationStatus: 'passed',
      timestamp: new Date().toISOString(),
      viewport: { width: 1440, height: 900 },
      checks: [
        { name: 'image-object-fit', expected: 'cover', actual: 'cover', passed: true, details: 'Object fit matches' },
        { name: 'image-transform', expected: 'none', actual: 'none', passed: true },
      ],
      postRepairEvidence: {
        screenshotPath: path.join(scenarioDir, 'post-repair.png'),
        domPath: path.join(scenarioDir, 'dom-post-repair.html'),
        measurementsPath: path.join(scenarioDir, 'measurements.json'),
      },
      failureReasons: [],
      durationMs: 850,
      unrelatedRegressionsDetected: false,
      regressionAudit: [
        { area: 'home', route: '/', passed: true, details: 'Hero clean' },
        { area: 'cart', route: '/cart', passed: true, details: 'Cart clean' },
      ],
      assertionSummary: 'All checks passed cleanly.',
    };

    fs.writeFileSync(path.join(scenarioDir, 'verification-result.json'), JSON.stringify(passResult, null, 2));
    fs.writeFileSync(path.join(scenarioDir, 'post-repair.png'), 'fake-image');
    fs.writeFileSync(path.join(scenarioDir, 'dom-post-repair.html'), '<html></html>');
    fs.writeFileSync(path.join(scenarioDir, 'measurements.json'), JSON.stringify({ pass: true }));

    const report = await exportVerificationReport(
      { runId, artifactsDir: tempFixtureBase },
      repoRoot
    );

    expect(report.overallStatus).toBe('PASSED');
    expect(report.passedCount).toBe(1);
    expect(report.failedCount).toBe(0);
    expect(report.inconclusiveCount).toBe(0);
    expect(report.markdownContent).toContain('🟢 PASSED');
    expect(report.markdownContent).toContain('image-object-fit');
    expect(report.markdownContent).toContain('Hero clean');
    expect(fs.existsSync(report.outputPath!)).toBe(true);
  });

  // Test 3: Run containing a failed scenario
  test('Test 3: Failed scenario — exports FAILED report with failure reasons and check diagnostics', async () => {
    const runId = `fixture-fail-${Date.now()}`;
    const runDir = path.join(tempFixtureBase, runId);
    const scenarioDir = path.join(runDir, 'low-contrast-text');
    fs.mkdirSync(scenarioDir, { recursive: true });

    const failResult = {
      runId,
      scenarioId: 'low-contrast-text',
      defectCategory: 'low-contrast-text',
      verificationStatus: 'failed',
      timestamp: new Date().toISOString(),
      viewport: { width: 1440, height: 900 },
      checks: [
        { name: 'wcag-aa-contrast', expected: '>= 4.5:1', actual: '1.4:1', passed: false, details: 'Text contrast below AA' },
      ],
      failureReasons: ['Contrast ratio 1.4:1 is below WCAG AA threshold 4.5:1'],
      durationMs: 1200,
      unrelatedRegressionsDetected: false,
      assertionSummary: 'Contrast check failed.',
    };

    fs.writeFileSync(path.join(scenarioDir, 'verification-result.json'), JSON.stringify(failResult, null, 2));

    const report = await exportVerificationReport(
      { runId, artifactsDir: tempFixtureBase },
      repoRoot
    );

    expect(report.overallStatus).toBe('FAILED');
    expect(report.failedCount).toBe(1);
    expect(report.markdownContent).toContain('🔴 FAILED');
    expect(report.markdownContent).toContain('Contrast ratio 1.4:1 is below WCAG AA threshold 4.5:1');
    expect(report.markdownContent).toContain('✕ Fail');
  });

  // Test 4: Run containing an inconclusive scenario
  test('Test 4: Inconclusive scenario — exports INCONCLUSIVE report with infrastructure error', async () => {
    const runId = `fixture-inconclusive-${Date.now()}`;
    const runDir = path.join(tempFixtureBase, runId);
    const scenarioDir = path.join(runDir, 'mobile-nav-overflow');
    fs.mkdirSync(scenarioDir, { recursive: true });

    const inconclusiveResult = {
      runId,
      scenarioId: 'mobile-nav-overflow',
      defectCategory: 'mobile-nav-overflow',
      verificationStatus: 'inconclusive',
      timestamp: new Date().toISOString(),
      viewport: { width: 390, height: 844 },
      checks: [],
      failureReasons: ['Page failed to load cleanly: HTTP 500 from server'],
      durationMs: 400,
      unrelatedRegressionsDetected: false,
      assertionSummary: 'Verification inconclusive: HTTP 500 error.',
    };

    fs.writeFileSync(path.join(scenarioDir, 'verification-result.json'), JSON.stringify(inconclusiveResult, null, 2));

    const report = await exportVerificationReport(
      { runId, artifactsDir: tempFixtureBase },
      repoRoot
    );

    expect(report.overallStatus).toBe('INCONCLUSIVE');
    expect(report.inconclusiveCount).toBe(1);
    expect(report.markdownContent).toContain('🟡 INCONCLUSIVE');
    expect(report.markdownContent).toContain('HTTP 500 from server');
  });

  // Test 5: Missing evidence files explicitly audited
  test('Test 5: Missing evidence files — explicitly reported in Captured Evidence Audit table', async () => {
    const runId = `fixture-missing-evidence-${Date.now()}`;
    const runDir = path.join(tempFixtureBase, runId);
    const scenarioDir = path.join(runDir, 'product-card-layout-break');
    fs.mkdirSync(scenarioDir, { recursive: true });

    // Only verification-result.json exists, screenshot and DOM are missing
    const partialResult = {
      runId,
      scenarioId: 'product-card-layout-break',
      defectCategory: 'product-card-layout-break',
      verificationStatus: 'passed',
      timestamp: new Date().toISOString(),
      viewport: { width: 1440, height: 900 },
      checks: [
        { name: 'footer-position', expected: 'static', actual: 'static', passed: true },
      ],
      failureReasons: [],
      durationMs: 700,
      unrelatedRegressionsDetected: false,
      assertionSummary: 'Layout passed',
    };

    fs.writeFileSync(path.join(scenarioDir, 'verification-result.json'), JSON.stringify(partialResult, null, 2));

    const report = await exportVerificationReport(
      { runId, artifactsDir: tempFixtureBase },
      repoRoot
    );

    expect(report.scenarios[0].hasPostRepairScreenshot).toBe(false);
    expect(report.scenarios[0].hasPostRepairDom).toBe(false);
    expect(report.markdownContent).toContain('| **Post-Repair Screenshot** | ✕ Missing |');
    expect(report.markdownContent).toContain('| **Sanitized DOM Snapshot** | ✕ Missing |');
  });

  // Test 6: Malformed JSON handled gracefully
  test('Test 6: Malformed JSON — reports error gracefully without crashing', async () => {
    const runId = `fixture-malformed-${Date.now()}`;
    const runDir = path.join(tempFixtureBase, runId);
    const scenarioDir = path.join(runDir, 'product-image-distortion');
    fs.mkdirSync(scenarioDir, { recursive: true });

    fs.writeFileSync(path.join(scenarioDir, 'verification-result.json'), '{ malformed json content ...');

    const report = await exportVerificationReport(
      { runId, artifactsDir: tempFixtureBase },
      repoRoot
    );

    expect(report.overallStatus).toBe('INCONCLUSIVE');
    expect(report.scenarios[0].error).toContain('Malformed verification-result.json');
    expect(report.markdownContent).toContain('Malformed verification-result.json');
  });

  // Test 7: Nonexistent run ID
  test('Test 7: Nonexistent run ID — throws descriptive error', async () => {
    await expect(
      exportVerificationReport({ runId: 'non-existent-run-id-999', artifactsDir: tempFixtureBase }, repoRoot)
    ).rejects.toThrow(/Verification run 'non-existent-run-id-999' not found/);
  });

  // Test 8: Live repository integration with existing verification runs
  test('Test 8: Live repository integration — exports latest real verification run', async () => {
    const availableRuns = listVerificationRuns(testArtifactsBase);
    expect(availableRuns.length).toBeGreaterThan(0);

    // Export without specifying runId to test auto-discovery of latest run
    const report = await exportVerificationReport({}, repoRoot);
    expect(report.runId).toBe(availableRuns[0]);
    expect(report.totalScenarios).toBeGreaterThan(0);
    expect(fs.existsSync(report.outputPath!)).toBe(true);

    const content = fs.readFileSync(report.outputPath!, 'utf-8');
    expect(content).toContain('OmniSight Post-Repair Verification & Regression Report');
    expect(content).toContain('Executive Summary');
  });
});
