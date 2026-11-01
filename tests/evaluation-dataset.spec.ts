import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import {
  assertNoGroundTruthLeakage,
  FORBIDDEN_LEAKAGE_TOKENS,
} from "../scripts/vlm/evidence-sanitizer";
import {
  prepareEvaluationBundle,
  createEvaluationZipArchives,
  EVALUATION_SCENARIOS,
} from "../scripts/prepare-evaluation-bundle";

test.describe("OmniSight Evaluation Dataset Bundle Verification", () => {
  // Execute sequentially to prevent race conditions on shared zip archive creation
  test.describe.configure({ mode: "serial" });

  const bundleDir = path.resolve(process.cwd(), "omnisight-yuvraj-evaluation");
  const modelOnlyZip = path.resolve(process.cwd(), "omnisight-yuvraj-model-inputs-v2.zip");
  const metadataZip = path.resolve(process.cwd(), "omnisight-yuvraj-evaluation-metadata-v2.zip");

  test("prepares evaluation bundle and generates isolated ZIP archives", () => {
    const result = prepareEvaluationBundle({ copyImages: true, createArchives: true });
    expect(result.success).toBe(true);
    expect(result.totalCases).toBe(8);
    expect(result.defectiveCases).toBe(4);
    expect(result.baselineCases).toBe(4);
    expect(fs.existsSync(modelOnlyZip)).toBe(true);
    expect(fs.existsSync(metadataZip)).toBe(true);
  });

  test("contains exactly 4 defective and 4 baseline cases (8 total inputs)", () => {
    const defectiveDir = path.join(bundleDir, "model_inputs", "defective");
    const baselineDir = path.join(bundleDir, "model_inputs", "baseline");

    expect(fs.existsSync(defectiveDir)).toBe(true);
    expect(fs.existsSync(baselineDir)).toBe(true);

    const defCases = fs.readdirSync(defectiveDir).filter((d) => d.startsWith("case_")).sort();
    const baseCases = fs.readdirSync(baselineDir).filter((d) => d.startsWith("case_")).sort();

    expect(defCases).toEqual(["case_01", "case_02", "case_03", "case_04"]);
    expect(baseCases).toEqual(["case_01", "case_02", "case_03", "case_04"]);
  });

  test("every case has valid screenshot, DOM snapshot, and evidence JSON files", () => {
    for (const group of ["defective", "baseline"]) {
      for (const caseId of ["case_01", "case_02", "case_03", "case_04"]) {
        const caseDir = path.join(bundleDir, "model_inputs", group, caseId);
        const screenshotPath = path.join(caseDir, "screenshot.png");
        const domPath = path.join(caseDir, "dom.html");
        const evidencePath = path.join(caseDir, "evidence.json");

        expect(fs.existsSync(screenshotPath), `Missing screenshot in ${caseDir}`).toBe(true);
        expect(fs.existsSync(domPath), `Missing dom.html in ${caseDir}`).toBe(true);
        expect(fs.existsSync(evidencePath), `Missing evidence.json in ${caseDir}`).toBe(true);

        const imgStats = fs.statSync(screenshotPath);
        expect(imgStats.size).toBeGreaterThan(10_000); // Valid PNG file

        const domContent = fs.readFileSync(domPath, "utf8");
        expect(domContent.length).toBeGreaterThan(100);
      }
    }
  });

  test("each case provides evidence.json conforming to full normalized schema", () => {
    for (const group of ["defective", "baseline"]) {
      for (const caseId of ["case_01", "case_02", "case_03", "case_04"]) {
        const evidencePath = path.join(bundleDir, "model_inputs", group, caseId, "evidence.json");
        const data = JSON.parse(fs.readFileSync(evidencePath, "utf8"));

        expect(data.case_id).toBe(caseId);
        expect(data.step_name).toBe("not_recorded");
        expect(data.screenshot_path).toBe("screenshot.png");
        expect(data.dom_path).toBe("dom.html");
        expect(data.url).toMatch(/^http:\/\/127\.0\.0\.1:5173\//);
        expect(data.route).toBeDefined();
        expect(typeof data.viewport.width).toBe("number");
        expect(typeof data.viewport.height).toBe("number");
        expect(typeof data.is_mobile).toBe("boolean");
        expect(data.document_metrics).toBeDefined();
        expect(typeof data.document_metrics.clientWidth).toBe("number");
        expect(typeof data.document_metrics.scrollWidth).toBe("number");
        expect(data.element_bounding_boxes).toBeDefined();
        expect(data.computed_styles).toBeDefined();
      }
    }
  });

  test("leakage tests: DOM snapshots and evidence JSON files are free of all forbidden tokens", () => {
    const modelInputsDir = path.join(bundleDir, "model_inputs");

    function walkDir(dir: string, fileList: string[] = []): string[] {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          walkDir(fullPath, fileList);
        } else if (file.endsWith(".json") || file.endsWith(".html")) {
          fileList.push(fullPath);
        }
      }
      return fileList;
    }

    const filesToCheck = walkDir(modelInputsDir);
    expect(filesToCheck.length).toBe(16); // 8 evidence.json + 8 dom.html

    for (const filePath of filesToCheck) {
      const content = fs.readFileSync(filePath, "utf8");

      // Verify no forbidden leakage tokens
      expect(() => assertNoGroundTruthLeakage(content)).not.toThrow();

      // Explicit targeted assertions
      expect(content).not.toContain("/Users/");
      expect(content).not.toContain("data-vite-dev-id");
      expect(content).not.toMatch(/Defect\s+[1-4]\b/i);
      expect(content).not.toMatch(/Controlled UI Defect Scenarios/i);
      expect(content).not.toContain("expected_category");
      expect(content).not.toContain("expected_symptom");
      expect(content).not.toContain("omnisight-defect-metadata");
    }
  });

  test("preservation tests: legitimate diagnostic CSS declarations and DOM structures are intact", () => {
    // case_01 defective: image distortion declarations
    const dom01Def = fs.readFileSync(
      path.join(bundleDir, "model_inputs", "defective", "case_01", "dom.html"),
      "utf8"
    );
    expect(dom01Def).toContain("object-fit: fill;");
    expect(dom01Def).toContain("380px;");
    expect(dom01Def).toContain("product-card");

    // case_02 defective: layout break declarations
    const dom02Def = fs.readFileSync(
      path.join(bundleDir, "model_inputs", "defective", "case_02", "dom.html"),
      "utf8"
    );
    expect(dom02Def).toContain("margin-top: -40px;");
    expect(dom02Def).toContain("bottom: -45px;");

    // case_03 defective: low-contrast color value
    const dom03Def = fs.readFileSync(
      path.join(bundleDir, "model_inputs", "defective", "case_03", "dom.html"),
      "utf8"
    );
    expect(dom03Def).toContain("#cbd5e1");

    // case_04 defective: mobile nav overflow width
    const dom04Def = fs.readFileSync(
      path.join(bundleDir, "model_inputs", "defective", "case_04", "dom.html"),
      "utf8"
    );
    expect(dom04Def).toContain("650px;");
    expect(dom04Def).toContain("navbar");

    // Verify computed styles in evidence.json
    const ev01Def = JSON.parse(
      fs.readFileSync(
        path.join(bundleDir, "model_inputs", "defective", "case_01", "evidence.json"),
        "utf8"
      )
    );
    expect(ev01Def.computed_styles["image.objectFit"]).toBe("fill");
    expect(ev01Def.computed_styles["image.height"]).toBe("380px");

    // Verify baseline computed styles
    const ev01Base = JSON.parse(
      fs.readFileSync(
        path.join(bundleDir, "model_inputs", "baseline", "case_01", "evidence.json"),
        "utf8"
      )
    );
    expect(ev01Base.computed_styles["image.objectFit"]).toBe("cover");
    expect(ev01Base.computed_styles["image.height"]).toBe("265px");
  });

  test("scoring/ground_truth.json is strictly separated and correctly mapped", () => {
    const gtPath = path.join(bundleDir, "scoring", "ground_truth.json");
    expect(fs.existsSync(gtPath)).toBe(true);

    const gt = JSON.parse(fs.readFileSync(gtPath, "utf8"));
    expect(Array.isArray(gt)).toBe(true);
    expect(gt).toHaveLength(4);

    const caseIds = gt.map((g: any) => g.case_id).sort();
    expect(caseIds).toEqual(["case_01", "case_02", "case_03", "case_04"]);

    const expectedScenarios = EVALUATION_SCENARIOS.map((s) => s.scenarioId).sort();
    const actualScenarios = gt.map((g: any) => g.scenario_id).sort();
    expect(actualScenarios).toEqual(expectedScenarios);

    for (const entry of gt) {
      expect(entry.expected_category).toBeDefined();
      expect(entry.canonical_category).toBeDefined();
      expect(entry.expected_symptom).toBeDefined();
    }
  });

  test("dataset_manifest.json indexes all 8 cases and references resolve", () => {
    const manifestPath = path.join(bundleDir, "dataset_manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.total_cases).toBe(8);
    expect(manifest.defective_cases_count).toBe(4);
    expect(manifest.baseline_cases_count).toBe(4);
    expect(manifest.cases).toHaveLength(8);

    for (const c of manifest.cases) {
      expect(c.step_name).toBe("not_recorded");
      const evidenceFullPath = path.join(bundleDir, c.evidence_json_path);
      expect(fs.existsSync(evidenceFullPath)).toBe(true);

      const domFullPath = path.join(bundleDir, c.dom_path);
      expect(fs.existsSync(domFullPath)).toBe(true);
    }
  });

  test("DATASET_README.md documentation covers dual packages, schemas, and usage", () => {
    const readmePath = path.join(bundleDir, "DATASET_README.md");
    expect(fs.existsSync(readmePath)).toBe(true);

    const content = fs.readFileSync(readmePath, "utf8");
    expect(content).toContain("OmniSight Multimodal UI Defect Evaluation Dataset");
    expect(content).toContain("omnisight-yuvraj-model-inputs-v2.zip");
    expect(content).toContain("omnisight-yuvraj-evaluation-metadata-v2.zip");
    expect(content).toContain("step_name");
    expect(content).toContain("Ground-Truth Isolation");
  });

  test("ZIP Archives: Archive A is model-only and Archive B is evaluator metadata only", () => {
    expect(fs.existsSync(modelOnlyZip)).toBe(true);
    expect(fs.existsSync(metadataZip)).toBe(true);

    // Verify integrity
    expect(() => execFileSync("unzip", ["-t", modelOnlyZip], { stdio: "pipe" })).not.toThrow();
    expect(() => execFileSync("unzip", ["-t", metadataZip], { stdio: "pipe" })).not.toThrow();

    // Check Archive A listing: must NOT contain scoring/, ground_truth, manifest, or README
    const modelOnlyListing = execFileSync("unzip", ["-l", modelOnlyZip], { encoding: "utf8" });
    expect(modelOnlyListing).toContain("model_inputs/");
    expect(modelOnlyListing).not.toContain("scoring/");
    expect(modelOnlyListing).not.toContain("ground_truth.json");
    expect(modelOnlyListing).not.toContain("dataset_manifest.json");
    expect(modelOnlyListing).not.toContain("DATASET_README.md");

    // Check Archive B listing: must contain ground_truth, manifest, README, and NO screenshots
    const metadataListing = execFileSync("unzip", ["-l", metadataZip], { encoding: "utf8" });
    expect(metadataListing).toContain("scoring/ground_truth.json");
    expect(metadataListing).toContain("dataset_manifest.json");
    expect(metadataListing).toContain("DATASET_README.md");
    expect(metadataListing).not.toContain(".png");
    expect(metadataListing).not.toContain("model_inputs/");
  });
});
