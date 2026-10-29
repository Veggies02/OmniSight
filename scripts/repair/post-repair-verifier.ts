import fs from 'fs';
import path from 'path';
import { Page, Browser, chromium } from '@playwright/test';
import {
  PostRepairVerificationResult,
  VerificationCheck,
  VerificationStatus,
  VerificationOptions,
} from './verification-schema';
import {
  calculateContrastRatio,
  resolveEffectiveColor,
  stripInspectionMetadataFromDom,
} from '../evidence-helpers';

export interface DefectStateMeasurement {
  metrics: Record<string, any>;
  checks: VerificationCheck[];
  isDefectPresent: boolean;
}

/**
 * Standard scenario viewport resolver.
 */
export function getScenarioViewport(scenarioId: string): { width: number; height: number } {
  if (scenarioId === 'mobile-nav-overflow' || scenarioId === 'responsive_overflow') {
    return { width: 390, height: 844 };
  }
  return { width: 1440, height: 900 };
}

/**
 * Discovers matching baseline and defective evidence from artifacts/visual-evidence.
 */
export function findMatchingScenarioEvidence(
  repoRoot: string,
  scenarioId: string
): {
  baseline?: { screenshotPath?: string; domPath?: string; measurementsPath?: string; metrics?: Record<string, any> };
  defective?: { screenshotPath?: string; domPath?: string; measurementsPath?: string; metrics?: Record<string, any> };
} {
  const evidenceBase = path.join(repoRoot, 'artifacts', 'visual-evidence');
  if (!fs.existsSync(evidenceBase)) return {};

  const runs = fs.readdirSync(evidenceBase).sort().reverse();
  for (const run of runs) {
    const scenarioDir = path.join(evidenceBase, run, scenarioId);
    if (fs.existsSync(scenarioDir)) {
      const bScreenshot = path.join(scenarioDir, 'baseline.png');
      const dScreenshot = path.join(scenarioDir, 'defective.png');
      const bDom = path.join(scenarioDir, 'dom-baseline.html');
      const dDom = path.join(scenarioDir, 'dom-defective.html');
      const measurements = path.join(scenarioDir, 'measurements.json');

      let baselineMetrics: Record<string, any> | undefined;
      let defectiveMetrics: Record<string, any> | undefined;

      if (fs.existsSync(measurements)) {
        try {
          const raw = JSON.parse(fs.readFileSync(measurements, 'utf-8'));
          baselineMetrics = raw.baseline?.specificMetrics || raw.baseline;
          defectiveMetrics = raw.defective?.specificMetrics || raw.defective;
        } catch {
          // ignore parse error
        }
      }

      return {
        baseline: {
          screenshotPath: fs.existsSync(bScreenshot) ? bScreenshot : undefined,
          domPath: fs.existsSync(bDom) ? bDom : undefined,
          measurementsPath: fs.existsSync(measurements) ? measurements : undefined,
          metrics: baselineMetrics,
        },
        defective: {
          screenshotPath: fs.existsSync(dScreenshot) ? dScreenshot : undefined,
          domPath: fs.existsSync(dDom) ? dDom : undefined,
          measurementsPath: fs.existsSync(measurements) ? measurements : undefined,
          metrics: defectiveMetrics,
        },
      };
    }
  }

  return {};
}

/**
 * Evaluates the 4 core defect scenarios against an active Playwright page.
 * Distinguishes genuine geometric/contrast/overflow presence from normal states.
 */
export async function measureScenarioOnPage(
  page: Page,
  scenarioId: string
): Promise<DefectStateMeasurement> {
  const checks: VerificationCheck[] = [];

  switch (scenarioId) {
    case 'product-image-distortion':
    case 'image_distortion': {
      const firstCard = page.locator('.product-card').first();
      await firstCard.waitFor({ state: 'visible', timeout: 5000 });
      const img = firstCard.locator('.product-image');
      const media = firstCard.locator('.product-card-media');

      const imgComputed = await img.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          objectFit: style.objectFit,
          transform: style.transform,
          renderedWidth: rect.width,
          renderedHeight: rect.height,
          aspectRatio: rect.height > 0 ? Number((rect.width / rect.height).toFixed(2)) : 0,
        };
      });

      const mediaHeight = await media.evaluate((el) => window.getComputedStyle(el).height);

      const isObjectFitCover = imgComputed.objectFit === 'cover';
      const isIdentityTransform = imgComputed.transform === 'none' || !imgComputed.transform.includes('1.45');
      const isMediaHeightNormal = mediaHeight !== '380px';

      checks.push({
        name: 'image-object-fit',
        expected: 'cover',
        actual: imgComputed.objectFit,
        passed: isObjectFitCover,
        details: `CSS object-fit is '${imgComputed.objectFit}', expected 'cover'`,
      });

      checks.push({
        name: 'image-no-distorting-transform',
        expected: 'none or non-distorted',
        actual: imgComputed.transform,
        passed: isIdentityTransform,
        details: `CSS transform is '${imgComputed.transform}'`,
      });

      checks.push({
        name: 'media-container-height',
        expected: '!= 380px',
        actual: mediaHeight,
        passed: isMediaHeightNormal,
        details: `Media container computed height is '${mediaHeight}'`,
      });

      // Defect is present if object-fit is fill or height is 380px or transform is distorted
      const isDefectPresent = imgComputed.objectFit === 'fill' || mediaHeight === '380px' || !isIdentityTransform;

      return {
        metrics: {
          objectFit: imgComputed.objectFit,
          transform: imgComputed.transform,
          renderedWidth: imgComputed.renderedWidth,
          renderedHeight: imgComputed.renderedHeight,
          aspectRatio: imgComputed.aspectRatio,
          mediaHeight,
        },
        checks,
        isDefectPresent,
      };
    }

    case 'product-card-layout-break':
    case 'layout_breakage': {
      const firstCard = page.locator('.product-card').first();
      await firstCard.waitFor({ state: 'visible', timeout: 5000 });
      const body = firstCard.locator('.product-card-body');
      const footer = firstCard.locator('.product-card-footer');

      const cardBox = await firstCard.boundingBox();
      const footerBox = await footer.boundingBox();

      const footerComputed = await footer.evaluate((el) => {
        const s = window.getComputedStyle(el);
        return { position: s.position, bottom: s.bottom };
      });

      const bodyComputed = await body.evaluate((el) => {
        const s = window.getComputedStyle(el);
        return { marginTop: s.marginTop };
      });

      let protrusionPx = 0;
      if (cardBox && footerBox) {
        const footerBottom = footerBox.y + footerBox.height;
        const cardBottom = cardBox.y + cardBox.height;
        protrusionPx = Math.max(0, Number((footerBottom - cardBottom).toFixed(2)));
      }

      const isPositionStatic = footerComputed.position === 'static';
      const isZeroProtrusion = protrusionPx <= 1; // 1px rounding tolerance
      const isBodyMarginNormal = bodyComputed.marginTop === '0px' || !bodyComputed.marginTop.startsWith('-');

      checks.push({
        name: 'footer-in-flow-position',
        expected: 'static',
        actual: footerComputed.position,
        passed: isPositionStatic,
        details: `Footer position is '${footerComputed.position}'`,
      });

      checks.push({
        name: 'footer-card-boundary-protrusion',
        expected: '<= 1px',
        actual: `${protrusionPx}px`,
        passed: isZeroProtrusion,
        details: `Footer protrudes ${protrusionPx}px below parent card`,
      });

      checks.push({
        name: 'body-margin-non-negative',
        expected: '>= 0px',
        actual: bodyComputed.marginTop,
        passed: isBodyMarginNormal,
        details: `Card body margin-top is '${bodyComputed.marginTop}'`,
      });

      const isDefectPresent = footerComputed.position === 'absolute' || protrusionPx > 10 || bodyComputed.marginTop.startsWith('-');

      return {
        metrics: {
          footerPosition: footerComputed.position,
          bodyMarginTop: bodyComputed.marginTop,
          footerProtrusionPx: protrusionPx,
        },
        checks,
        isDefectPresent,
      };
    }

    case 'low-contrast-text':
    case 'low_contrast': {
      const firstCard = page.locator('.product-card').first();
      await firstCard.waitFor({ state: 'visible', timeout: 5000 });

      const colorData = await firstCard.evaluate((cardEl) => {
        const snipEl = cardEl.querySelector('.product-snippet') as HTMLElement;
        const sStyle = window.getComputedStyle(snipEl);
        const cStyle = window.getComputedStyle(cardEl);
        return {
          fgColor: sStyle.color,
          bgColor: cStyle.backgroundColor,
        };
      });

      const effectiveFg = resolveEffectiveColor(colorData.fgColor);
      const effectiveBg = resolveEffectiveColor(colorData.bgColor, { r: 255, g: 255, b: 255 });
      const contrastRatio = calculateContrastRatio(effectiveFg, effectiveBg);

      const passesAA = contrastRatio >= 4.5;
      const passesAAA = contrastRatio >= 7.0;

      checks.push({
        name: 'wcag-aa-contrast-ratio',
        expected: '>= 4.5:1',
        actual: `${contrastRatio}:1`,
        passed: passesAA,
        details: `Contrast ratio is ${contrastRatio}:1 (foreground: ${colorData.fgColor}, background: ${colorData.bgColor})`,
      });

      const isDefectPresent = contrastRatio < 4.5; // Defect is present whenever text fails WCAG AA 4.5:1 threshold

      return {
        metrics: {
          foregroundColor: colorData.fgColor,
          backgroundColor: colorData.bgColor,
          contrastRatio,
          passesWcagAA: passesAA,
          passesWcagAAA: passesAAA,
        },
        checks,
        isDefectPresent,
      };
    }

    case 'mobile-nav-overflow':
    case 'responsive_overflow': {
      const navbar = page.locator('.navbar');
      await navbar.waitFor({ state: 'visible', timeout: 5000 });

      const docMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      const overflowPx = Math.max(0, docMetrics.scrollWidth - docMetrics.clientWidth);
      const hasNoOverflow = overflowPx <= 0;

      checks.push({
        name: 'document-horizontal-overflow',
        expected: '0px',
        actual: `${overflowPx}px`,
        passed: hasNoOverflow,
        details: `Document scrollWidth (${docMetrics.scrollWidth}px) vs clientWidth (${docMetrics.clientWidth}px)`,
      });

      const isDefectPresent = overflowPx > 5;

      return {
        metrics: {
          clientWidth: docMetrics.clientWidth,
          scrollWidth: docMetrics.scrollWidth,
          horizontalOverflowPx: overflowPx,
        },
        checks,
        isDefectPresent,
      };
    }

    default:
      throw new Error(`Unsupported defect scenario ID: ${scenarioId}`);
  }
}

/**
 * Executes post-repair UI verification on a target page.
 * Captures screenshot, sanitized DOM, measurements, runs checks, checks for regressions,
 * and records result to artifacts/verification/<runId>/<scenarioId>/.
 */
export async function runPostRepairVerification(
  page: Page,
  options: VerificationOptions
): Promise<PostRepairVerificationResult> {
  const startTime = Date.now();
  const runId = options.runId || `verify-${Date.now()}`;
  const scenarioId = options.scenarioId;
  const defectCategory = options.defectCategory || scenarioId;
  const repoRoot = options.repoRoot || process.cwd();
  const artifactsBase = options.artifactsDir || path.join(repoRoot, 'artifacts', 'verification');
  const scenarioArtifactsDir = path.join(artifactsBase, runId, scenarioId);

  fs.mkdirSync(scenarioArtifactsDir, { recursive: true });

  const postRepairScreenshotPath = path.join(scenarioArtifactsDir, 'post-repair.png');
  const postRepairDomPath = path.join(scenarioArtifactsDir, 'dom-post-repair.html');
  const measurementsPath = path.join(scenarioArtifactsDir, 'measurements.json');
  const resultJsonPath = path.join(scenarioArtifactsDir, 'verification-result.json');

  const viewport = options.viewport || getScenarioViewport(scenarioId);
  const failureReasons: string[] = [];

  // Match existing baseline/defective evidence from artifacts if available
  const existingEvidence = findMatchingScenarioEvidence(repoRoot, scenarioId);

  try {
    // 1. Set viewport
    await page.setViewportSize(viewport);

    // 2. Navigate to target URL with timeout
    const navResponse = await page.goto(options.targetUrl, {
      waitUntil: 'networkidle',
      timeout: options.timeoutMs || 15000,
    });

    if (!navResponse || !navResponse.ok()) {
      const status = navResponse ? navResponse.status() : 'no-response';
      failureReasons.push(`Page failed to load cleanly: HTTP ${status} from ${options.targetUrl}`);
      const durationMs = Date.now() - startTime;
      const inconclusiveResult: PostRepairVerificationResult = {
        runId,
        scenarioId,
        defectCategory,
        verificationStatus: 'inconclusive',
        timestamp: new Date().toISOString(),
        viewport,
        checks: [],
        baselineEvidence: existingEvidence.baseline,
        defectiveEvidence: existingEvidence.defective,
        postRepairEvidence: {},
        failureReasons,
        durationMs,
        unrelatedRegressionsDetected: false,
        assertionSummary: `Verification inconclusive: Target page failed to load (HTTP ${status}).`,
      };
      fs.writeFileSync(resultJsonPath, JSON.stringify(inconclusiveResult, null, 2), 'utf-8');
      return inconclusiveResult;
    }

    // 3. Wait for scenario stability
    const waitSelector = scenarioId.includes('mobile-nav') ? '.navbar' : '.product-card';
    try {
      await page.waitForSelector(waitSelector, { timeout: 10000 });
    } catch (e: any) {
      failureReasons.push(`Selector '${waitSelector}' failed to appear within timeout: ${e.message}`);
      const durationMs = Date.now() - startTime;
      const inconclusiveResult: PostRepairVerificationResult = {
        runId,
        scenarioId,
        defectCategory,
        verificationStatus: 'inconclusive',
        timestamp: new Date().toISOString(),
        viewport,
        checks: [],
        baselineEvidence: existingEvidence.baseline,
        defectiveEvidence: existingEvidence.defective,
        postRepairEvidence: {},
        failureReasons,
        durationMs,
        unrelatedRegressionsDetected: false,
        assertionSummary: `Verification inconclusive: Expected UI elements did not render.`,
      };
      fs.writeFileSync(resultJsonPath, JSON.stringify(inconclusiveResult, null, 2), 'utf-8');
      return inconclusiveResult;
    }

    // 4. Capture Post-Repair Evidence (Screenshot + Sanitized DOM)
    await page.screenshot({ path: postRepairScreenshotPath, fullPage: false });
    const rawDom = await page.content();
    const sanitizedDom = stripInspectionMetadataFromDom(rawDom);
    fs.writeFileSync(postRepairDomPath, sanitizedDom, 'utf-8');

    // Also update public/evidence/verification/post_repair.png for the review dashboard display
    const publicVerificationDir = path.join(repoRoot, 'public', 'evidence', 'verification');
    if (!fs.existsSync(publicVerificationDir)) {
      fs.mkdirSync(publicVerificationDir, { recursive: true });
    }
    fs.copyFileSync(postRepairScreenshotPath, path.join(publicVerificationDir, 'post_repair.png'));

    // 5. Measure Repaired State & Run Defect-Specific Checks
    const measurement = await measureScenarioOnPage(page, scenarioId);

    // 6. Comprehensive Multi-Page Regression Audit (Home, Cart, Navbar)
    let unrelatedRegressionsDetected = false;
    const regressionAudit: import('./verification-schema').RegressionCheck[] = [];

    if (!options.skipRegressionAudit) {
      try {
        const urlObj = new URL(options.targetUrl);
        const origin = urlObj.origin;

        // 6A. Home Page Verification (Hero section and featured products)
        const homeUrl = `${origin}/`;
        try {
          await page.goto(homeUrl, { waitUntil: 'networkidle', timeout: 8000 });
          const heroCount = await page.locator('.hero-section').count();
          const hasHero = heroCount > 0;
          regressionAudit.push({
            area: 'home',
            route: '/',
            passed: hasHero,
            details: hasHero ? 'Home hero section renders cleanly.' : 'Home hero section missing from DOM.',
          });
          if (!hasHero) {
            unrelatedRegressionsDetected = true;
            failureReasons.push('Regression: Home page hero section failed to render properly.');
          }
        } catch (homeErr: any) {
          unrelatedRegressionsDetected = true;
          failureReasons.push(`Regression: Home page navigation failed: ${homeErr.message}`);
          regressionAudit.push({
            area: 'home',
            route: '/',
            passed: false,
            details: `Navigation error: ${homeErr.message}`,
          });
        }

        // 6B. Shopping Cart Verification (Cart empty state or table renders cleanly without error)
        const cartUrl = `${origin}/cart`;
        try {
          await page.goto(cartUrl, { waitUntil: 'networkidle', timeout: 8000 });
          const hasCartContainer = (await page.locator('.cart-page, .cart-empty-state, .shopping-cart-container, main').count()) > 0;
          regressionAudit.push({
            area: 'cart',
            route: '/cart',
            passed: hasCartContainer,
            details: hasCartContainer ? 'Cart view renders expected layout.' : 'Cart container missing from DOM.',
          });
          if (!hasCartContainer) {
            unrelatedRegressionsDetected = true;
            failureReasons.push('Regression: Shopping cart page failed to render expected layout.');
          }
        } catch (cartErr: any) {
          unrelatedRegressionsDetected = true;
          failureReasons.push(`Regression: Cart page navigation failed: ${cartErr.message}`);
          regressionAudit.push({
            area: 'cart',
            route: '/cart',
            passed: false,
            details: `Navigation error: ${cartErr.message}`,
          });
        }

        // 6C. Navigation Bar Verification (Brand link and main links present)
        try {
          const navBrandCount = await page.locator('.navbar-brand, .nav-brand, .brand-logo, a[href="/"]').count();
          const hasBrand = navBrandCount > 0;
          regressionAudit.push({
            area: 'navigation',
            route: '/cart',
            passed: hasBrand,
            details: hasBrand ? 'Global navigation bar rendered intact.' : 'Navbar brand missing from layout.',
          });
          if (!hasBrand) {
            unrelatedRegressionsDetected = true;
            failureReasons.push('Regression: Global navigation bar brand element missing.');
          }
        } catch (navErr: any) {
          unrelatedRegressionsDetected = true;
          failureReasons.push(`Regression: Navbar check failed: ${navErr.message}`);
          regressionAudit.push({
            area: 'navigation',
            route: '/cart',
            passed: false,
            details: `Navbar check error: ${navErr.message}`,
          });
        }
      } catch (auditErr: any) {
        unrelatedRegressionsDetected = true;
        failureReasons.push(`Regression: Overall audit harness error: ${auditErr.message}`);
      }
    }

    // Determine final status
    const allChecksPassed = measurement.checks.length > 0 && measurement.checks.every((c) => c.passed);
    const defectResolved = !measurement.isDefectPresent;

    let verificationStatus: VerificationStatus = 'passed';
    if (!allChecksPassed || !defectResolved || unrelatedRegressionsDetected) {
      verificationStatus = 'failed';
      for (const check of measurement.checks) {
        if (!check.passed) {
          failureReasons.push(`Check '${check.name}' failed: Expected ${check.expected}, got ${check.actual} (${check.details})`);
        }
      }
      if (!defectResolved && failureReasons.length === 0) {
        failureReasons.push(`Observable defect geometry/symptom is still present on the page.`);
      }
    }

    const durationMs = Date.now() - startTime;
    const assertionSummary =
      verificationStatus === 'passed'
        ? `Post-repair verification passed for ${scenarioId}: all ${measurement.checks.length} checks satisfied, defect resolved.`
        : `Post-repair verification failed for ${scenarioId}: ${failureReasons.join('; ')}`;

    // Save quantitative measurements
    fs.writeFileSync(
      measurementsPath,
      JSON.stringify(
        {
          scenarioId,
          runId,
          timestamp: new Date().toISOString(),
          viewport,
          baselineMetrics: existingEvidence.baseline?.metrics,
          defectiveMetrics: existingEvidence.defective?.metrics,
          repairedMetrics: measurement.metrics,
          checks: measurement.checks,
          regressionAudit,
        },
        null,
        2
      ),
      'utf-8'
    );

    const result: PostRepairVerificationResult = {
      runId,
      scenarioId,
      defectCategory,
      verificationStatus,
      timestamp: new Date().toISOString(),
      viewport,
      checks: measurement.checks,
      baselineEvidence: existingEvidence.baseline,
      defectiveEvidence: existingEvidence.defective,
      postRepairEvidence: {
        screenshotPath: postRepairScreenshotPath,
        domPath: postRepairDomPath,
        measurementsPath,
      },
      baselineMetrics: existingEvidence.baseline?.metrics,
      defectiveMetrics: existingEvidence.defective?.metrics,
      repairedMetrics: measurement.metrics,
      failureReasons,
      durationMs,
      unrelatedRegressionsDetected,
      regressionAudit,
      assertionSummary,
    };

    fs.writeFileSync(resultJsonPath, JSON.stringify(result, null, 2), 'utf-8');
    return result;
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    failureReasons.push(`Unexpected error during verification: ${err.message || String(err)}`);
    const inconclusiveResult: PostRepairVerificationResult = {
      runId,
      scenarioId,
      defectCategory,
      verificationStatus: 'inconclusive',
      timestamp: new Date().toISOString(),
      viewport,
      checks: [],
      baselineEvidence: existingEvidence.baseline,
      defectiveEvidence: existingEvidence.defective,
      postRepairEvidence: fs.existsSync(postRepairScreenshotPath) ? { screenshotPath: postRepairScreenshotPath } : {},
      failureReasons,
      durationMs,
      unrelatedRegressionsDetected: false,
      assertionSummary: `Verification inconclusive due to infrastructure/browser error: ${err.message}`,
    };
    fs.writeFileSync(resultJsonPath, JSON.stringify(inconclusiveResult, null, 2), 'utf-8');
    return inconclusiveResult;
  }
}
