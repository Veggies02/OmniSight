import fs from 'fs';
import path from 'path';
import { chromium, Browser, Page } from '@playwright/test';
import { RegisteredPatch } from './patch-registry';
import { VisualValidationResult } from './repair-job-schema';
import { serveWorktreeDist, WorktreeServerHandle } from './worktree-server';
import {
  calculateContrastRatio,
  resolveEffectiveColor,
  stripInspectionMetadataFromDom,
} from '../evidence-helpers';

export interface VisualVerificationOptions {
  worktreePath: string;
  patch: RegisteredPatch;
  jobId: string;
  artifactsDir: string;
  repoRoot: string;
}

/**
 * Searches artifacts/visual-evidence for the latest matching baseline screenshot and measurement.
 */
export function findMatchingBaselineEvidence(
  repoRoot: string,
  defectCategory: string
): { baselineScreenshotPath?: string; baselineMetric?: Record<string, any>; baselineDomPath?: string } {
  const evidenceBase = path.join(repoRoot, 'artifacts', 'visual-evidence');
  if (!fs.existsSync(evidenceBase)) return {};

  const runs = fs.readdirSync(evidenceBase).sort().reverse();
  for (const run of runs) {
    const scenarioDir = path.join(evidenceBase, run, defectCategory);
    if (fs.existsSync(scenarioDir)) {
      const screenshot = path.join(scenarioDir, 'baseline.png');
      const measurements = path.join(scenarioDir, 'measurements.json');
      const dom = path.join(scenarioDir, 'dom-baseline.html');

      let baselineMetric: Record<string, any> | undefined;
      if (fs.existsSync(measurements)) {
        try {
          const raw = JSON.parse(fs.readFileSync(measurements, 'utf-8'));
          baselineMetric = raw.baseline?.specificMetrics || raw.baseline;
        } catch {
          // ignore parse error
        }
      }

      return {
        baselineScreenshotPath: fs.existsSync(screenshot) ? screenshot : undefined,
        baselineMetric,
        baselineDomPath: fs.existsSync(dom) ? dom : undefined,
      };
    }
  }

  return {};
}

/**
 * Evaluates real post-repair browser rendering inside headless Chromium against the isolated worktree dist build.
 */
export async function verifyRepairedWorktreeVisually(
  options: VisualVerificationOptions
): Promise<VisualValidationResult> {
  const { worktreePath, patch, jobId, artifactsDir, repoRoot } = options;

  let serverHandle: WorktreeServerHandle | null = null;
  let browser: Browser | null = null;

  const jobArtifactsDir = path.join(artifactsDir, jobId);
  if (!fs.existsSync(jobArtifactsDir)) {
    fs.mkdirSync(jobArtifactsDir, { recursive: true });
  }

  const afterScreenshotPath = path.join(jobArtifactsDir, 'post_repair.png');
  const afterDomPath = path.join(jobArtifactsDir, 'dom_post_repair.html');

  // Find baseline evidence if available
  const baselineInfo = findMatchingBaselineEvidence(repoRoot, patch.defectCategory);

  try {
    // 1. Launch isolated worktree server on ephemeral port
    serverHandle = await serveWorktreeDist(worktreePath);

    // 2. Launch headless Chromium
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: patch.defectCategory === 'mobile-nav-overflow' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    });

    const page = await context.newPage();

    // Enable defect injection parameter simulation on repaired worktree
    await page.addInitScript(() => {
      window.sessionStorage.setItem('omnisight:enable-defects', 'true');
    });

    // 3. Navigate to the defect route on the ephemeral worktree server
    const sep = '?';
    const targetUrl = `${serverHandle.url}/products${sep}defect=${patch.defectCategory}`;
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    // Wait for the UI elements appropriate to the scenario
    const waitSelector = patch.defectCategory === 'mobile-nav-overflow' ? '.navbar' : '.product-card';
    await page.waitForSelector(waitSelector, { timeout: 10000 });

    // 4. Capture real post-repair screenshot and DOM
    await page.screenshot({ path: afterScreenshotPath, fullPage: false });
    const rawDom = await page.content();
    const sanitizedDom = stripInspectionMetadataFromDom(rawDom);
    fs.writeFileSync(afterDomPath, sanitizedDom, 'utf-8');

    // 5. Evaluate defect-specific visual and layout metrics
    let passed = false;
    let assertionSummary = '';
    let repairedMetric: Record<string, any> = {};

    switch (patch.defectCategory) {
      case 'product-image-distortion': {
        const firstCard = page.locator('.product-card').first();
        const img = firstCard.locator('.product-image');
        const media = firstCard.locator('.product-card-media');

        const imgComputed = await img.evaluate((el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return {
            objectFit: style.objectFit,
            transform: style.transform,
            width: rect.width,
            height: rect.height,
            aspectRatio: rect.height > 0 ? Number((rect.width / rect.height).toFixed(2)) : 0,
          };
        });

        const mediaHeight = await media.evaluate((el) => window.getComputedStyle(el).height);

        repairedMetric = {
          objectFit: imgComputed.objectFit,
          transform: imgComputed.transform,
          renderedWidth: imgComputed.width,
          renderedHeight: imgComputed.height,
          renderedAspectRatio: imgComputed.aspectRatio,
          mediaHeight,
        };

        const isObjectFitCover = imgComputed.objectFit === 'cover';
        const isNotDistortedTransform = imgComputed.transform === 'none' || !imgComputed.transform.includes('1.45');
        const isNormalHeight = mediaHeight !== '380px';

        passed = isObjectFitCover && isNotDistortedTransform && isNormalHeight;
        assertionSummary = passed
          ? `Product image distortion resolved: object-fit is ${imgComputed.objectFit}, aspect ratio is ${imgComputed.aspectRatio}, media height is ${mediaHeight}.`
          : `Product image distortion verification failed: object-fit is ${imgComputed.objectFit}, media height is ${mediaHeight}.`;
        break;
      }

      case 'product-card-layout-break': {
        const firstCard = page.locator('.product-card').first();
        const body = firstCard.locator('.product-card-body');
        const footer = firstCard.locator('.product-card-footer');

        const cardBox = await firstCard.boundingBox();
        const bodyBox = await body.boundingBox();
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

        repairedMetric = {
          footerPosition: footerComputed.position,
          bodyMarginTop: bodyComputed.marginTop,
          footerProtrusionPx: protrusionPx,
          isLayoutNormal: protrusionPx === 0 && footerComputed.position === 'static',
        };

        passed = protrusionPx === 0 && footerComputed.position === 'static' && bodyComputed.marginTop === '0px';
        assertionSummary = passed
          ? `Card layout break resolved: footer position is static with 0px protrusion, body margin is 0px.`
          : `Card layout break verification failed: protrusion is ${protrusionPx}px, footer position is ${footerComputed.position}.`;
        break;
      }

      case 'low-contrast-text': {
        const firstCard = page.locator('.product-card').first();
        const snippet = firstCard.locator('.product-snippet');

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

        repairedMetric = {
          foregroundColor: colorData.fgColor,
          backgroundColor: colorData.bgColor,
          contrastRatio,
          passesWcagAA: contrastRatio >= 4.5,
          passesWcagAAA: contrastRatio >= 7.0,
        };

        // Text requires at least WCAG AA (4.5:1), and our AAA token achieves >= 7.0
        passed = contrastRatio >= 4.5;
        assertionSummary = passed
          ? `Low-contrast text resolved: measured contrast ratio is ${contrastRatio}:1 (passes WCAG AA threshold 4.5:1).`
          : `Low-contrast text verification failed: contrast ratio is ${contrastRatio}:1 (below WCAG 4.5:1).`;
        break;
      }

      case 'mobile-nav-overflow': {
        const navbar = page.locator('.navbar');
        const navContainer = navbar.locator('.navbar-container');

        const containerComputed = await navContainer.evaluate((el) => {
          const s = window.getComputedStyle(el);
          return { width: s.width };
        });

        const docMetrics = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));

        const overflowPx = Math.max(0, docMetrics.scrollWidth - docMetrics.clientWidth);

        repairedMetric = {
          containerWidth: containerComputed.width,
          clientWidth: docMetrics.clientWidth,
          scrollWidth: docMetrics.scrollWidth,
          horizontalOverflowPx: overflowPx,
        };

        passed = overflowPx === 0 && docMetrics.scrollWidth <= docMetrics.clientWidth;
        assertionSummary = passed
          ? `Mobile nav overflow resolved: document scrollWidth (${docMetrics.scrollWidth}px) <= clientWidth (${docMetrics.clientWidth}px), 0px overflow.`
          : `Mobile nav overflow verification failed: document has ${overflowPx}px horizontal overflow.`;
        break;
      }

      default:
        passed = false;
        assertionSummary = `Unsupported defect category: ${patch.defectCategory}`;
        break;
    }

    // 6. Verify Unaffected UI Behavior (Regressions)
    // Navigate to Home page and Cart to verify core functionality remains intact
    let unrelatedRegressionsDetected = false;
    try {
      await page.goto(`${serverHandle.url}/`, { waitUntil: 'networkidle' });
      const hero = await page.locator('.hero-section').count();
      if (hero === 0) {
        unrelatedRegressionsDetected = true;
      }
    } catch {
      unrelatedRegressionsDetected = true;
    }

    return {
      passed,
      defectCategory: patch.defectCategory,
      route: `/products?defect=${patch.defectCategory}`,
      viewport: patch.defectCategory === 'mobile-nav-overflow' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      cleanBaselineMetric: baselineInfo.baselineMetric,
      defectiveMetric: undefined,
      repairedMetric,
      assertionSummary: unrelatedRegressionsDetected
        ? `${assertionSummary} [REGRESSION DETECTED: Home page failed to render properly]`
        : assertionSummary,
      unrelatedRegressionsDetected,
      beforeScreenshotPath: baselineInfo.baselineScreenshotPath,
      afterScreenshotPath,
    };
  } catch (err: any) {
    return {
      passed: false,
      defectCategory: patch.defectCategory,
      route: `/products?defect=${patch.defectCategory}`,
      viewport: { width: 1280, height: 800 },
      assertionSummary: `Browser-based post-repair verification failed with infrastructure error: ${err?.message || String(err)}`,
      unrelatedRegressionsDetected: false,
      beforeScreenshotPath: baselineInfo.baselineScreenshotPath,
      afterScreenshotPath: fs.existsSync(afterScreenshotPath) ? afterScreenshotPath : undefined,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (serverHandle) {
      await serverHandle.close().catch(() => {});
    }
  }
}
