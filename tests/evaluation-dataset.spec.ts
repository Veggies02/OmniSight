import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { assertNoGroundTruthLeakage } from "../scripts/vlm/evidence-sanitizer";
import {
  prepareEvaluationBundle,
  EVALUATION_SCENARIOS,
} from "../scripts/prepare-evaluation-bundle";

test.describe("OmniSight Evaluation Dataset Bundle Verification", () => {
  const bundleDir = path.resolve(process.cwd(), "omnisight-yuvraj-evaluation");

  test("prepares evaluation bundle without error", () => {
    const result = prepareEvaluationBundle({ copyImages: false });
    expect(result.success).toBe(true);
    expect(result.totalCases).toBe(8);
    expect(result.defectiveCases).toBe(4);
    expect(result.baselineCases).toBe(4);
  });

  test("contains exactly 4 defective and 4 baseline cases in model_inputs", () => {
    const defectiveDir = path.join(bundleDir, "model_inputs", "defective");
    const baselineDir = path.join(bundleDir, "model_inputs", "baseline");

    expect(fs.existsSync(defectiveDir)).toBe(true);
    expect(fs.existsSync(baselineDir)).toBe(true);

    const defCases = fs.readdirSync(defectiveDir).filter((d) => d.startsWith("case_")).sort();
    const baseCases = fs.readdirSync(baselineDir).filter((d) => d.startsWith("case_")).sort();

    expect(defCases).toEqual(["case_01", "case_02", "case_03", "case_04"]);
    expect(baseCases).toEqual(["case_01", "case_02", "case_03", "case_04"]);
  });

  test("each case provides valid evidence.json with required schema fields", () => {
    for (const group of ["defective", "baseline"]) {
      for (const caseId of ["case_01", "case_02", "case_03", "case_04"]) {
        const evidencePath = path.join(bundleDir, "model_inputs", group, caseId, "evidence.json");
        expect(fs.existsSync(evidencePath)).toBe(true);

        const data = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
        expect(data.case_id).toBe(caseId);
        expect(data.route).toBeDefined();
        expect(data.viewport).toBeDefined();
        expect(typeof data.viewport.width).toBe("number");
        expect(typeof data.viewport.height).toBe("number");
        expect(typeof data.is_mobile).toBe("boolean");
        expect(data.document_metrics).toBeDefined();
        expect(data.element_bounding_boxes).toBeDefined();
        expect(data.computed_styles).toBeDefined();
      }
    }
  });

  test("guarantees strict zero-leakage of ground-truth defect labels into model_inputs", () => {
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
    expect(filesToCheck.length).toBeGreaterThan(0);

    for (const filePath of filesToCheck) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(() => assertNoGroundTruthLeakage(content)).not.toThrow();
    }
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
      const evidenceFullPath = path.join(bundleDir, c.evidence_json_path);
      expect(fs.existsSync(evidenceFullPath)).toBe(true);

      const domFullPath = path.join(bundleDir, c.dom_path);
      expect(fs.existsSync(domFullPath)).toBe(true);
    }
  });

  test("DATASET_README.md documentation exists and covers evaluation workflow", () => {
    const readmePath = path.join(bundleDir, "DATASET_README.md");
    expect(fs.existsSync(readmePath)).toBe(true);

    const content = fs.readFileSync(readmePath, "utf8");
    expect(content).toContain("OmniSight Multimodal UI Defect Evaluation Dataset");
    expect(content).toContain("case_01");
    expect(content).toContain("case_04");
    expect(content).toContain("Ground-Truth Separation");
  });
});
