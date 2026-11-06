import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { DEFECT_REGISTRY } from "../src/data/defects";
import {
  calculateContrastRatio,
  parseCssColor,
  resolveEffectiveColor,
  stripInspectionMetadataFromDom,
} from "../scripts/evidence-helpers";
import { SCENARIO_DEFINITIONS, VisualEvidenceHarness } from "../scripts/capture-visual-evidence";

test.describe("Visual Evidence Capture Harness & Measurement Unit Tests", () => {
  test("every registered defect has an associated capture scenario definition", () => {
    const registeredIds = Object.keys(DEFECT_REGISTRY);
    const scenarioDefectIds = SCENARIO_DEFINITIONS.map((s) => s.defectId);

    expect(scenarioDefectIds.length).toBeGreaterThanOrEqual(4);
    for (const defectId of registeredIds) {
      expect(scenarioDefectIds).toContain(defectId);
    }
  });

  test("calculates relative contrast ratio correctly for known WCAG standards", () => {
    // Pure Black on Pure White -> 21:1
    const blackOnWhite = calculateContrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(blackOnWhite).toBe(21.0);

    // Pure White on Pure White -> 1:1
    const whiteOnWhite = calculateContrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 });
    expect(whiteOnWhite).toBe(1.0);

    // Slate 500 (#64748b -> rgb(100, 116, 139)) on White (#ffffff) -> ~4.76:1 (Passes WCAG AA)
    const slateOnWhite = calculateContrastRatio({ r: 100, g: 116, b: 139 }, { r: 255, g: 255, b: 255 });
    expect(slateOnWhite).toBeGreaterThan(4.5);

    // Slate 300 (#cbd5e1 -> rgb(203, 213, 225)) on White (#ffffff) -> ~1.48:1 (Fails WCAG AA/AAA)
    const lowContrast = calculateContrastRatio({ r: 203, g: 213, b: 225 }, { r: 255, g: 255, b: 255 });
    expect(lowContrast).toBeLessThan(2.0);
    expect(lowContrast).toBe(1.48);
  });

  test("parses css colors and resolves effective colors with alpha blending", () => {
    const parsedRgb = parseCssColor("rgb(10, 20, 30)");
    expect(parsedRgb).toEqual({ r: 10, g: 20, b: 30, a: 1.0 });

    const parsedRgba = parseCssColor("rgba(10, 20, 30, 0.5)");
    expect(parsedRgba).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });

    // Semi-transparent black over white backing
    const blended = resolveEffectiveColor("rgba(0, 0, 0, 0.5)", { r: 255, g: 255, b: 255 });
    expect(blended.r).toBeCloseTo(128, -1);
    expect(blended.g).toBeCloseTo(128, -1);
    expect(blended.b).toBeCloseTo(128, -1);
  });

  test("strips inspection metadata and internal defect classes from model-facing DOM", () => {
    const sampleHtml = `
      <div id="root">
        <div id="omnisight-defect-metadata" data-defect-active="true" data-defect-id="product-image-distortion"></div>
        <article class="product-card defect-product-image-distortion" data-defect-applied="product-image-distortion">
          <h2>Product Name</h2>
        </article>
      </div>
    `;

    const cleaned = stripInspectionMetadataFromDom(sampleHtml);
    expect(cleaned).not.toContain("omnisight-defect-metadata");
    expect(cleaned).not.toContain("data-defect-applied");
    expect(cleaned).not.toContain("defect-product-image-distortion");
    expect(cleaned).toContain("product-card");
    expect(cleaned).toContain("Product Name");
  });

  test("executes evidence capture harness and verifies manifest and ground-truth separation", async () => {
    const tempOutputDir = path.resolve(process.cwd(), "artifacts/visual-evidence/test-harness-run");
    const harness = new VisualEvidenceHarness({
      outputDir: tempOutputDir,
      runId: "test-run-verification",
    });

    const manifest = await harness.executeCapture();

    // Verify manifest structure
    expect(manifest.success).toBe(true);
    expect(manifest.scenariosCaptured).toBe(4);
    expect(manifest.totalScenarios).toBe(4);

    const runDir = harness.getRunDirectory();
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "model_facing_evidence.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "ground_truth_eval.json"))).toBe(true);

    // Verify model-facing evidence does not contain ground-truth defect ID labels
    const modelEvidenceContent = fs.readFileSync(path.join(runDir, "model_facing_evidence.json"), "utf8");
    const parsedModelEvidence = JSON.parse(modelEvidenceContent);
    for (const scenario of parsedModelEvidence.scenarios) {
      expect(scenario.defectId).toBeUndefined();
      expect(scenario.expectedCategory).toBeUndefined();
      expect(scenario.expectedSymptom).toBeUndefined();
      expect(scenario.baselineScreenshot).toBeTruthy();
      expect(scenario.defectiveScreenshot).toBeTruthy();

      // Check screenshot files actually exist on disk
      const baselineImg = path.join(runDir, scenario.baselineScreenshot);
      const defectiveImg = path.join(runDir, scenario.defectiveScreenshot);
      expect(fs.existsSync(baselineImg)).toBe(true);
      expect(fs.existsSync(defectiveImg)).toBe(true);
    }

    // Verify ground-truth evaluation record contains the expected details and measurements
    const groundTruthContent = fs.readFileSync(path.join(runDir, "ground_truth_eval.json"), "utf8");
    const parsedGroundTruth = JSON.parse(groundTruthContent);
    expect(parsedGroundTruth.scenarios["product-image-distortion"].defectId).toBe("product-image-distortion");
    expect(parsedGroundTruth.scenarios["product-card-layout-break"].defectId).toBe("product-card-layout-break");
    expect(parsedGroundTruth.scenarios["low-contrast-text"].defectId).toBe("low-contrast-text");
    expect(parsedGroundTruth.scenarios["mobile-nav-overflow"].defectId).toBe("mobile-nav-overflow");

    // Check specific measurements in ground-truth:
    // 1. Image distortion: objectFit changed from cover to fill
    const imgScenario = parsedGroundTruth.scenarios["product-image-distortion"];
    expect(imgScenario.baselineMeasurements.computedStyles["image.objectFit"]).toBe("cover");
    expect(imgScenario.defectiveMeasurements.computedStyles["image.objectFit"]).toBe("fill");

    // 2. Card layout break: footer protrudes outside card
    const cardScenario = parsedGroundTruth.scenarios["product-card-layout-break"];
    expect(cardScenario.baselineMeasurements.specificMetrics.footerProtrusionPx).toBe(0);
    expect(cardScenario.defectiveMeasurements.specificMetrics.footerProtrusionPx).toBeGreaterThan(15);

    // 3. Low contrast: contrast ratio dropped below 2.0
    const contrastScenario = parsedGroundTruth.scenarios["low-contrast-text"];
    expect(contrastScenario.baselineMeasurements.specificMetrics.contrastRatio).toBeGreaterThan(4.5);
    expect(contrastScenario.defectiveMeasurements.specificMetrics.contrastRatio).toBeLessThan(2.0);

    // 4. Mobile overflow: horizontal overflow observed at 390px
    const overflowScenario = parsedGroundTruth.scenarios["mobile-nav-overflow"];
    expect(overflowScenario.baselineMeasurements.specificMetrics.horizontalOverflowPx).toBe(0);
    expect(overflowScenario.defectiveMeasurements.specificMetrics.horizontalOverflowPx).toBe(260);

    // Clean up test harness artifact directory
    fs.rmSync(tempOutputDir, { recursive: true, force: true });
  });
});
