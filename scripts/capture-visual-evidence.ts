import { chromium, type Browser, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { DEFECT_REGISTRY } from "../src/data/defects";
import {
  calculateContrastRatio,
  resolveEffectiveColor,
  stripInspectionMetadataFromDom,
  type DefectMeasurement,
  type GroundTruthRecord,
  type HarnessManifest,
  type ModelFacingEvidence,
  type ScenarioEvidence,
} from "./evidence-helpers";

interface CaptureOptions {
  baseUrl?: string;
  outputDir?: string;
  runId?: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:5173";
const DEFAULT_ARTIFACTS_DIR = path.resolve(process.cwd(), "artifacts/visual-evidence");

export interface ScenarioDefinition {
  id: string;
  defectId: string;
  route: string;
  viewport: { width: number; height: number };
  waitForSelector: string;
  measureScenario: (page: Page, isDefective: boolean) => Promise<DefectMeasurement>;
}

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  {
    id: "product-image-distortion",
    defectId: "product-image-distortion",
    route: "/products",
    viewport: { width: 1440, height: 900 },
    waitForSelector: ".product-card[data-product-id='prod-1']",
    measureScenario: async (page, isDefective) => {
      const card = page.locator(".product-card[data-product-id='prod-1']");
      const media = card.locator(".product-card-media");
      const img = card.locator(".product-image");

      const cardBox = await card.boundingBox();
      const mediaBox = await media.boundingBox();
      const imgBox = await img.boundingBox();

      const imgComputed = await img.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const htmlImg = el as HTMLImageElement;
        return {
          objectFit: style.objectFit,
          width: style.width,
          height: style.height,
          transform: style.transform,
          naturalWidth: htmlImg.naturalWidth,
          naturalHeight: htmlImg.naturalHeight,
        };
      });

      const mediaComputed = await media.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          height: style.height,
          aspectRatio: style.aspectRatio,
        };
      });

      const docMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      }));

      return {
        defectId: "product-image-distortion",
        category: "visual-distortion",
        route: "/products",
        viewport: { width: 1440, height: 900 },
        state: isDefective ? "defective" : "baseline",
        elementBoundingBoxes: {
          card: cardBox,
          media: mediaBox,
          image: imgBox,
        },
        computedStyles: {
          "image.objectFit": imgComputed.objectFit,
          "image.height": imgComputed.height,
          "image.transform": imgComputed.transform,
          "media.height": mediaComputed.height,
        },
        specificMetrics: {
          imageRenderedWidth: imgBox?.width ?? null,
          imageRenderedHeight: imgBox?.height ?? null,
          imageNaturalWidth: imgComputed.naturalWidth,
          imageNaturalHeight: imgComputed.naturalHeight,
          mediaRenderedHeight: mediaBox?.height ?? null,
          isDistorted: imgComputed.objectFit === "fill",
        },
        hasHorizontalOverflow: docMetrics.scrollWidth > docMetrics.clientWidth,
        documentMetrics: docMetrics,
      };
    },
  },
  {
    id: "product-card-layout-break",
    defectId: "product-card-layout-break",
    route: "/products",
    viewport: { width: 1440, height: 900 },
    waitForSelector: ".product-card[data-product-id='prod-1']",
    measureScenario: async (page, isDefective) => {
      const card = page.locator(".product-card[data-product-id='prod-1']");
      const body = card.locator(".product-card-body");
      const footer = card.locator(".product-card-footer");

      const cardBox = await card.boundingBox();
      const bodyBox = await body.boundingBox();
      const footerBox = await footer.boundingBox();

      const footerComputed = await footer.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          position: style.position,
          bottom: style.bottom,
          left: style.left,
          right: style.right,
        };
      });

      const bodyComputed = await body.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          position: style.position,
          marginTop: style.marginTop,
        };
      });

      const docMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      }));

      // Calculate protrusion: amount footer bottom exceeds card bottom
      let protrusionPx = 0;
      if (cardBox && footerBox) {
        const footerBottom = footerBox.y + footerBox.height;
        const cardBottom = cardBox.y + cardBox.height;
        protrusionPx = Math.max(0, Number((footerBottom - cardBottom).toFixed(2)));
      }

      return {
        defectId: "product-card-layout-break",
        category: "layout-shift",
        route: "/products",
        viewport: { width: 1440, height: 900 },
        state: isDefective ? "defective" : "baseline",
        elementBoundingBoxes: {
          card: cardBox,
          body: bodyBox,
          footer: footerBox,
        },
        computedStyles: {
          "footer.position": footerComputed.position,
          "footer.bottom": footerComputed.bottom,
          "body.marginTop": bodyComputed.marginTop,
        },
        specificMetrics: {
          footerProtrusionPx: protrusionPx,
          isLayoutDisplaced: protrusionPx > 0 || footerComputed.position === "absolute",
        },
        hasHorizontalOverflow: docMetrics.scrollWidth > docMetrics.clientWidth,
        documentMetrics: docMetrics,
      };
    },
  },
  {
    id: "low-contrast-text",
    defectId: "low-contrast-text",
    route: "/products",
    viewport: { width: 1440, height: 900 },
    waitForSelector: ".product-card[data-product-id='prod-1']",
    measureScenario: async (page, isDefective) => {
      const card = page.locator(".product-card[data-product-id='prod-1']");
      const snippet = card.locator(".product-snippet");

      const cardBox = await card.boundingBox();
      const snippetBox = await snippet.boundingBox();

      const colorData = await card.evaluate((cardEl) => {
        const snipEl = cardEl.querySelector(".product-snippet") as HTMLElement;
        const sStyle = window.getComputedStyle(snipEl);
        const cStyle = window.getComputedStyle(cardEl);
        return {
          fgColor: sStyle.color,
          bgColor: cStyle.backgroundColor,
          fontSize: sStyle.fontSize,
          fontWeight: sStyle.fontWeight,
        };
      });

      const effectiveFg = resolveEffectiveColor(colorData.fgColor);
      const effectiveBg = resolveEffectiveColor(colorData.bgColor, { r: 255, g: 255, b: 255 });
      const contrastRatio = calculateContrastRatio(effectiveFg, effectiveBg);

      const docMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      }));

      return {
        defectId: "low-contrast-text",
        category: "color-contrast",
        route: "/products",
        viewport: { width: 1440, height: 900 },
        state: isDefective ? "defective" : "baseline",
        elementBoundingBoxes: {
          card: cardBox,
          snippet: snippetBox,
        },
        computedStyles: {
          "snippet.color": colorData.fgColor,
          "card.backgroundColor": colorData.bgColor,
          "snippet.fontSize": colorData.fontSize,
          "snippet.fontWeight": colorData.fontWeight,
        },
        specificMetrics: {
          foregroundColor: colorData.fgColor,
          backgroundColor: colorData.bgColor,
          contrastRatio,
          passesWcagAA: contrastRatio >= 4.5,
          passesWcagLargeText: contrastRatio >= 3.0,
        },
        hasHorizontalOverflow: docMetrics.scrollWidth > docMetrics.clientWidth,
        documentMetrics: docMetrics,
      };
    },
  },
  {
    id: "mobile-nav-overflow",
    defectId: "mobile-nav-overflow",
    route: "/products",
    viewport: { width: 390, height: 844 },
    waitForSelector: ".navbar",
    measureScenario: async (page, isDefective) => {
      const navbar = page.locator(".navbar");
      const navContainer = navbar.locator(".navbar-container");

      const navbarBox = await navbar.boundingBox();
      const containerBox = await navContainer.boundingBox();

      const containerComputed = await navContainer.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          width: style.width,
          minWidth: style.minWidth,
        };
      });

      const docMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      }));

      const overflowPx = Math.max(0, docMetrics.scrollWidth - docMetrics.clientWidth);

      return {
        defectId: "mobile-nav-overflow",
        category: "responsive-overflow",
        route: "/products",
        viewport: { width: 390, height: 844 },
        state: isDefective ? "defective" : "baseline",
        elementBoundingBoxes: {
          navbar: navbarBox,
          navContainer: containerBox,
        },
        computedStyles: {
          "navbarContainer.width": containerComputed.width,
          "navbarContainer.minWidth": containerComputed.minWidth,
        },
        specificMetrics: {
          viewportWidth: 390,
          documentClientWidth: docMetrics.clientWidth,
          documentScrollWidth: docMetrics.scrollWidth,
          horizontalOverflowPx: overflowPx,
          hasHorizontalOverflow: overflowPx > 0,
        },
        hasHorizontalOverflow: overflowPx > 0,
        documentMetrics: docMetrics,
      };
    },
  },
];

export class VisualEvidenceHarness {
  private baseUrl: string;
  private outputDir: string;
  private runId: string;

  constructor(options: CaptureOptions = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.outputDir = options.outputDir || DEFAULT_ARTIFACTS_DIR;
    this.runId = options.runId || `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  }

  public getRunId(): string {
    return this.runId;
  }

  public getRunDirectory(): string {
    return path.join(this.outputDir, this.runId);
  }

  public async executeCapture(): Promise<HarnessManifest> {
    const runDir = this.getRunDirectory();
    fs.mkdirSync(runDir, { recursive: true });

    // Validate that all registered defects are covered
    for (const defectId of Object.keys(DEFECT_REGISTRY)) {
      const found = SCENARIO_DEFINITIONS.some((s) => s.defectId === defectId);
      if (!found) {
        throw new Error(`Registered defect '${defectId}' is missing a capture scenario definition!`);
      }
    }

    const browser: Browser = await chromium.launch();
    const manifest: HarnessManifest = {
      runId: this.runId,
      timestamp: new Date().toISOString(),
      browser: "chromium",
      scenariosCaptured: 0,
      totalScenarios: SCENARIO_DEFINITIONS.length,
      success: false,
      artifactsDirectory: runDir,
      scenarios: {},
    };

    const modelFacingEvidence: ModelFacingEvidence = {
      runId: this.runId,
      timestamp: manifest.timestamp,
      browser: manifest.browser,
      scenarios: [],
    };

    const groundTruthRecord: GroundTruthRecord = {
      runId: this.runId,
      timestamp: manifest.timestamp,
      scenarios: {},
    };

    try {
      for (const scenario of SCENARIO_DEFINITIONS) {
        const scenarioDir = path.join(runDir, scenario.id);
        fs.mkdirSync(scenarioDir, { recursive: true });

        // 1. CAPTURE BASELINE
        const baselineContext = await browser.newContext({
          viewport: scenario.viewport,
        });
        const baselinePage = await baselineContext.newPage();
        const baselineErrors: string[] = [];
        baselinePage.on("console", (msg) => {
          if (msg.type() === "error") {
            baselineErrors.push(msg.text());
          }
        });

        // Ensure defects are not injected for baseline
        await baselinePage.addInitScript(() => {
          window.sessionStorage.setItem("omnisight:enable-defects", "true");
        });

        const baselineUrl = `${this.baseUrl}${scenario.route}`;
        await baselinePage.goto(baselineUrl, { waitUntil: "networkidle" });
        await baselinePage.waitForSelector(scenario.waitForSelector);

        const baselineScreenshotPath = path.join(scenarioDir, "baseline.png");
        await baselinePage.screenshot({ path: baselineScreenshotPath, fullPage: false });

        const baselineRawDom = await baselinePage.content();
        const baselineDom = stripInspectionMetadataFromDom(baselineRawDom);
        const baselineDomPath = path.join(scenarioDir, "dom-baseline.html");
        fs.writeFileSync(baselineDomPath, baselineDom, "utf8");

        const baselineMeasurements = await scenario.measureScenario(baselinePage, false);
        const baselineMeasurementsPath = path.join(scenarioDir, "measurements-baseline.json");
        fs.writeFileSync(baselineMeasurementsPath, JSON.stringify(baselineMeasurements, null, 2), "utf8");

        const baselineTitle = await baselinePage.title();
        await baselineContext.close();

        // 2. CAPTURE DEFECTIVE
        const defectiveContext = await browser.newContext({
          viewport: scenario.viewport,
        });
        const defectivePage = await defectiveContext.newPage();
        const defectiveErrors: string[] = [];
        defectivePage.on("console", (msg) => {
          if (msg.type() === "error") {
            defectiveErrors.push(msg.text());
          }
        });

        await defectivePage.addInitScript(() => {
          window.sessionStorage.setItem("omnisight:enable-defects", "true");
        });

        const sep = scenario.route.includes("?") ? "&" : "?";
        const defectiveUrl = `${this.baseUrl}${scenario.route}${sep}defect=${scenario.defectId}`;
        await defectivePage.goto(defectiveUrl, { waitUntil: "networkidle" });
        await defectivePage.waitForSelector(scenario.waitForSelector);

        const defectiveScreenshotPath = path.join(scenarioDir, "defective.png");
        await defectivePage.screenshot({ path: defectiveScreenshotPath, fullPage: false });

        const defectiveRawDom = await defectivePage.content();
        const defectiveDom = stripInspectionMetadataFromDom(defectiveRawDom);
        const defectiveDomPath = path.join(scenarioDir, "dom-defective.html");
        fs.writeFileSync(defectiveDomPath, defectiveDom, "utf8");

        const defectiveMeasurements = await scenario.measureScenario(defectivePage, true);
        const defectiveMeasurementsPath = path.join(scenarioDir, "measurements-defective.json");
        fs.writeFileSync(defectiveMeasurementsPath, JSON.stringify(defectiveMeasurements, null, 2), "utf8");

        // Save paired scenario measurements
        const pairedMeasurementsPath = path.join(scenarioDir, "measurements.json");
        fs.writeFileSync(
          pairedMeasurementsPath,
          JSON.stringify(
            {
              scenarioId: scenario.id,
              baseline: baselineMeasurements,
              defective: defectiveMeasurements,
            },
            null,
            2
          ),
          "utf8"
        );

        const defectiveTitle = await defectivePage.title();
        await defectiveContext.close();

        // Record Scenario Evidence
        const rel = (p: string) => path.relative(runDir, p);
        const scenarioEvidence: ScenarioEvidence = {
          scenarioId: scenario.id,
          defectId: scenario.defectId,
          route: scenario.route,
          viewport: scenario.viewport,
          baseline: {
            screenshotPath: rel(baselineScreenshotPath),
            domPath: rel(baselineDomPath),
            measurementsPath: rel(baselineMeasurementsPath),
            title: baselineTitle,
            url: baselineUrl,
            consoleErrors: baselineErrors,
          },
          defective: {
            screenshotPath: rel(defectiveScreenshotPath),
            domPath: rel(defectiveDomPath),
            measurementsPath: rel(defectiveMeasurementsPath),
            title: defectiveTitle,
            url: defectiveUrl,
            consoleErrors: defectiveErrors,
          },
        };

        manifest.scenarios[scenario.id] = scenarioEvidence;
        manifest.scenariosCaptured++;

        // Append to Model-Facing Evidence (NO GROUND-TRUTH DEFECT LABELS)
        modelFacingEvidence.scenarios.push({
          scenarioId: scenario.id,
          route: scenario.route,
          viewport: scenario.viewport,
          baselineScreenshot: rel(baselineScreenshotPath),
          defectiveScreenshot: rel(defectiveScreenshotPath),
          baselineDom: rel(baselineDomPath),
          defectiveDom: rel(defectiveDomPath),
          pageTitle: baselineTitle,
          consoleErrors: {
            baseline: baselineErrors,
            defective: defectiveErrors,
          },
        });

        // Append to Ground-Truth Evaluation Record
        const defectDef = DEFECT_REGISTRY[scenario.defectId];
        groundTruthRecord.scenarios[scenario.id] = {
          defectId: scenario.defectId,
          expectedCategory: defectDef?.category || "unknown",
          expectedSymptom: defectDef?.expectedSymptom || "unknown",
          targetComponent: defectDef?.targetComponent || "unknown",
          targetRoute: defectDef?.targetRoute || scenario.route,
          baselineMeasurements,
          defectiveMeasurements,
          measuredDelta: {
            baselineMetrics: baselineMeasurements.specificMetrics,
            defectiveMetrics: defectiveMeasurements.specificMetrics,
          },
        };
      }

      manifest.success = manifest.scenariosCaptured === manifest.totalScenarios;

      // Save manifest.json
      fs.writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

      // Save separate model_facing_evidence.json and ground_truth_eval.json
      fs.writeFileSync(
        path.join(runDir, "model_facing_evidence.json"),
        JSON.stringify(modelFacingEvidence, null, 2),
        "utf8"
      );
      fs.writeFileSync(
        path.join(runDir, "ground_truth_eval.json"),
        JSON.stringify(groundTruthRecord, null, 2),
        "utf8"
      );

      return manifest;
    } finally {
      await browser.close();
    }
  }
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith("capture-visual-evidence.ts")) {
  const harness = new VisualEvidenceHarness();
  console.log(`Starting Visual Evidence Capture Harness (Run ID: ${harness.getRunId()})...`);
  harness
    .executeCapture()
    .then((manifest) => {
      console.log(`Successfully captured ${manifest.scenariosCaptured}/${manifest.totalScenarios} scenarios.`);
      console.log(`Artifacts saved in: ${manifest.artifactsDirectory}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Visual evidence capture harness failed:", err);
      process.exit(1);
    });
}
