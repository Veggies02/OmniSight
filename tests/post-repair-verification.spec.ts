import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  runPostRepairVerification,
  measureScenarioOnPage,
  getScenarioViewport,
  findMatchingScenarioEvidence,
} from '../scripts/repair/post-repair-verifier';

test.describe('Automated UI Post-Repair Verification & Regression Pipeline', () => {
  const repoRoot = process.cwd();

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('omnisight:enable-defects', 'true');
    });
  });

  // Test 1: Defect remains after repair -> verifier must report failure
  test('Test 1: Defect remains after repair — verifier reports failure when defect criteria fail', async ({ page }) => {
    // Navigate to defect route where defect is actively un-repaired (still distorted)
    const runId = `test-run-fail-${Date.now()}`;
    const targetUrl = 'http://127.0.0.1:5173/products?defect=product-image-distortion';

    const result = await runPostRepairVerification(page, {
      runId,
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      targetUrl,
      repoRoot,
    });

    expect(result.verificationStatus).toBe('failed');
    expect(result.checks.length).toBeGreaterThan(0);
    const failedChecks = result.checks.filter((c) => !c.passed);
    expect(failedChecks.length).toBeGreaterThan(0);
    expect(result.failureReasons.length).toBeGreaterThan(0);
    expect(result.assertionSummary).toContain('failed');

    // Artifacts must be generated
    const resultJson = path.join(repoRoot, 'artifacts', 'verification', runId, 'product-image-distortion', 'verification-result.json');
    expect(fs.existsSync(resultJson)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(resultJson, 'utf-8'));
    expect(parsed.verificationStatus).toBe('failed');
  });

  // Test 2: Defect is resolved -> verifier reports success only when all checks pass
  test('Test 2: Defect is resolved — verifier reports success when post-repair checks pass', async ({ page }) => {
    // Navigate to clean /products route (representing the successfully repaired state)
    const runId = `test-run-pass-${Date.now()}`;
    const targetUrl = 'http://127.0.0.1:5173/products';

    const result = await runPostRepairVerification(page, {
      runId,
      scenarioId: 'product-image-distortion',
      defectCategory: 'product-image-distortion',
      targetUrl,
      repoRoot,
    });

    expect(result.verificationStatus).toBe('passed');
    expect(result.checks.length).toBeGreaterThanOrEqual(3);
    for (const check of result.checks) {
      expect(check.passed).toBe(true);
    }
    expect(result.failureReasons).toHaveLength(0);
    expect(result.assertionSummary).toContain('passed');
    expect(result.postRepairEvidence.screenshotPath).toBeDefined();
    expect(fs.existsSync(result.postRepairEvidence.screenshotPath!)).toBe(true);
  });

  // Test 3: Page fails to load -> verifier returns inconclusive/failed, never success
  test('Test 3: Page fails to load — returns inconclusive and never declares success', async ({ page }) => {
    const runId = `test-run-404-${Date.now()}`;
    const targetUrl = 'http://127.0.0.1:5173/non-existent-page-404-error';

    // Mock 404 response for this test
    await page.route('**/non-existent-page-404-error', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'text/html',
        body: '<html><body>404 Not Found</body></html>',
      });
    });

    const result = await runPostRepairVerification(page, {
      runId,
      scenarioId: 'product-image-distortion',
      targetUrl,
      repoRoot,
    });

    expect(result.verificationStatus).toBe('inconclusive');
    expect(result.verificationStatus).not.toBe('passed');
    expect(result.failureReasons.some((r) => r.includes('HTTP 404'))).toBe(true);
  });

  // Test 4: Missing evidence -> missing baseline or defective evidence handled safely without false positive
  test('Test 4: Missing evidence — handled gracefully without declaring false positive success on defective page', async ({ page }) => {
    const runId = `test-run-noevidence-${Date.now()}`;
    // Non-existent scenario ID has no baseline or defective evidence
    const nonExistentScenario = 'non-existent-ui-scenario-xyz';
    const evidence = findMatchingScenarioEvidence(repoRoot, nonExistentScenario);
    expect(evidence.baseline).toBeUndefined();
    expect(evidence.defective).toBeUndefined();

    // Verifying an unknown scenario must safely yield inconclusive or failed, never false positive pass
    const result = await runPostRepairVerification(page, {
      runId,
      scenarioId: nonExistentScenario,
      targetUrl: 'http://127.0.0.1:5173/products',
      repoRoot,
    });

    expect(result.verificationStatus).not.toBe('passed');
  });

  // Test 5: Viewport-specific verification for mobile overflow
  test('Test 5: Viewport-specific verification — mobile navigation overflow at 390x844 viewport', async ({ page }) => {
    const mobileViewport = getScenarioViewport('mobile-nav-overflow');
    expect(mobileViewport).toEqual({ width: 390, height: 844 });

    // 5A. On defective route, overflow is present -> verifier detects failure
    const runIdFail = `test-run-mobile-fail-${Date.now()}`;
    const resultFail = await runPostRepairVerification(page, {
      runId: runIdFail,
      scenarioId: 'mobile-nav-overflow',
      targetUrl: 'http://127.0.0.1:5173/products?defect=mobile-nav-overflow',
      viewport: mobileViewport,
      repoRoot,
    });

    expect(resultFail.verificationStatus).toBe('failed');
    const overflowCheck = resultFail.checks.find((c) => c.name === 'document-horizontal-overflow');
    expect(overflowCheck).toBeDefined();
    expect(overflowCheck!.passed).toBe(false);

    // 5B. On clean route at mobile viewport, overflow is 0px -> verifier passes
    const runIdPass = `test-run-mobile-pass-${Date.now()}`;
    const resultPass = await runPostRepairVerification(page, {
      runId: runIdPass,
      scenarioId: 'mobile-nav-overflow',
      targetUrl: 'http://127.0.0.1:5173/products',
      viewport: mobileViewport,
      repoRoot,
    });

    expect(resultPass.verificationStatus).toBe('passed');
    const passCheck = resultPass.checks.find((c) => c.name === 'document-horizontal-overflow');
    expect(passCheck!.passed).toBe(true);
    expect(passCheck!.actual).toBe('0px');
  });

  // Test 6: Evidence generation (screenshots, measurements, DOM, result JSON)
  test('Test 6: Evidence generation — creates post-repair screenshot, measurements.json, and verification-result.json', async ({ page }) => {
    const runId = `test-run-evidence-${Date.now()}`;
    const result = await runPostRepairVerification(page, {
      runId,
      scenarioId: 'low-contrast-text',
      targetUrl: 'http://127.0.0.1:5173/products',
      repoRoot,
    });

    const scenarioDir = path.join(repoRoot, 'artifacts', 'verification', runId, 'low-contrast-text');
    expect(fs.existsSync(scenarioDir)).toBe(true);

    const screenshotPath = path.join(scenarioDir, 'post-repair.png');
    const domPath = path.join(scenarioDir, 'dom-post-repair.html');
    const measurementsPath = path.join(scenarioDir, 'measurements.json');
    const resultJsonPath = path.join(scenarioDir, 'verification-result.json');

    expect(fs.existsSync(screenshotPath)).toBe(true);
    expect(fs.existsSync(domPath)).toBe(true);
    expect(fs.existsSync(measurementsPath)).toBe(true);
    expect(fs.existsSync(resultJsonPath)).toBe(true);

    // Verify measurements.json contents
    const measurements = JSON.parse(fs.readFileSync(measurementsPath, 'utf-8'));
    expect(measurements.scenarioId).toBe('low-contrast-text');
    expect(measurements.repairedMetrics).toBeDefined();
    expect(measurements.repairedMetrics.contrastRatio).toBeGreaterThanOrEqual(4.5);

    // Verify verification-result.json contents
    const resultJson = JSON.parse(fs.readFileSync(resultJsonPath, 'utf-8'));
    expect(resultJson.verificationStatus).toBe('passed');
    expect(resultJson.checks.length).toBeGreaterThan(0);
    expect(resultJson.durationMs).toBeGreaterThan(0);
  });

  // Test 7: Layout breakage scenario verification (card overlap & protrusion)
  test('Test 7: Layout breakage scenario — measures card, body, and footer bounding boxes', async ({ page }) => {
    const runId = `test-run-layout-${Date.now()}`;
    // Repaired state (clean /products)
    const result = await runPostRepairVerification(page, {
      runId,
      scenarioId: 'product-card-layout-break',
      targetUrl: 'http://127.0.0.1:5173/products',
      repoRoot,
    });

    expect(result.verificationStatus).toBe('passed');
    const protrusionCheck = result.checks.find((c) => c.name === 'footer-card-boundary-protrusion');
    expect(protrusionCheck).toBeDefined();
    expect(protrusionCheck!.passed).toBe(true);

    const positionCheck = result.checks.find((c) => c.name === 'footer-in-flow-position');
    expect(positionCheck).toBeDefined();
    expect(positionCheck!.passed).toBe(true);
  });
});
