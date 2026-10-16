import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  parseAndValidateDiagnosis,
  validateDiagnosisSchema,
  type StructuredDiagnosis,
} from "../scripts/vlm/diagnosis-schema";
import {
  assertNoGroundTruthLeakage,
  createNeutralScenarioAlias,
  sanitizeDomForVlm,
} from "../scripts/vlm/evidence-sanitizer";
import {
  createVlmProvider,
  GeminiVlmProvider,
  MockVlmProvider,
} from "../scripts/vlm/vlm-provider";
import { DiagnosisService } from "../scripts/vlm/diagnosis-service";
import { DiagnosisEvaluator } from "../scripts/vlm/diagnosis-evaluator";

test.describe("Step 4.3 VLM Integration & Blind Defect Diagnosis Unit & Pipeline Tests", () => {
  // A. Schema Validation Tests
  test.describe("A. Diagnosis Schema Validation", () => {
    test("accepts a valid structured diagnosis", () => {
      const valid: StructuredDiagnosis = {
        schema_version: "1.0",
        status: "diagnosed",
        summary: "Product image is distorted with aspect ratio skew.",
        defects: [
          {
            category: "image_distortion",
            severity: "medium",
            confidence: 0.92,
            description: "Image is disproportionately stretched vertically.",
            evidence: ["Height is 380px compared to 265px baseline.", "object-fit: fill applied."],
            affected_element: {
              description: "Catalogue product image",
              selector: ".product-image",
            },
            suspected_cause: "CSS object-fit: fill override.",
            suggested_fix: "Use object-fit: cover.",
          },
        ],
        limitations: [],
      };

      const result = validateDiagnosisSchema(valid);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("rejects invalid categories and severities", () => {
      const invalid = {
        schema_version: "1.0",
        status: "diagnosed",
        summary: "Invalid defect testing",
        defects: [
          {
            category: "magic_defect",
            severity: "super_critical",
            confidence: 0.5,
            description: "Invalid fields",
            evidence: ["Some evidence"],
            affected_element: { description: "Element" },
            suspected_cause: "Unknown",
            suggested_fix: "Fix it",
          },
        ],
        limitations: [],
      };

      const result = validateDiagnosisSchema(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("category"))).toBe(true);
      expect(result.errors.some((e) => e.includes("severity"))).toBe(true);
    });

    test("rejects confidence outside [0.0, 1.0]", () => {
      const invalid = {
        schema_version: "1.0",
        status: "diagnosed",
        summary: "Out of bounds confidence",
        defects: [
          {
            category: "low_contrast",
            severity: "low",
            confidence: 1.5,
            description: "Too confident",
            evidence: ["Evidence"],
            affected_element: { description: "Text" },
            suspected_cause: "Cause",
            suggested_fix: "Fix",
          },
        ],
        limitations: [],
      };

      const result = validateDiagnosisSchema(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("confidence"))).toBe(true);
    });

    test("rejects missing required fields, malformed JSON, and oversized response", () => {
      expect(parseAndValidateDiagnosis("").valid).toBe(false);
      expect(parseAndValidateDiagnosis("not json at all").valid).toBe(false);

      const hugeJson = JSON.stringify({
        schema_version: "1.0",
        status: "diagnosed",
        summary: "x".repeat(60000),
        defects: [],
        limitations: [],
      });
      const hugeResult = parseAndValidateDiagnosis(hugeJson);
      expect(hugeResult.valid).toBe(false);
      expect(hugeResult.errors[0]).toContain("exceeds safety limit");
    });
  });

  // B. Evidence Sanitization & Zero Leakage Tests
  test.describe("B. Evidence Sanitization & Zero Leakage", () => {
    test("neutralizes scenario aliases to prevent leakage in model prompts", () => {
      expect(createNeutralScenarioAlias(0)).toBe("scenario_01");
      expect(createNeutralScenarioAlias(3)).toBe("scenario_04");
    });

    test("sanitizes DOM by removing inspection metadata, defect classes, and script tags", () => {
      const rawDom = `
        <html>
          <head><script>alert('xss')</script></head>
          <body>
            <div id="omnisight-defect-metadata" data-defect-active="true" data-defect-id="low-contrast-text"></div>
            <article class="product-card defect-low-contrast-text" data-defect-applied="low-contrast-text">
              <p class="product-snippet">Great sound quality</p>
            </article>
          </body>
        </html>
      `;

      const sanitized = sanitizeDomForVlm(rawDom);
      expect(sanitized).not.toContain("omnisight-defect-metadata");
      expect(sanitized).not.toContain("data-defect-applied");
      expect(sanitized).not.toContain("defect-low-contrast-text");
      expect(sanitized).not.toContain("<script>");
      expect(sanitized).toContain("Great sound quality");
    });

    test("assertNoGroundTruthLeakage throws when forbidden tokens appear", () => {
      expect(() => {
        assertNoGroundTruthLeakage("This has ground_truth inside it!");
      }).toThrow(/CRITICAL LEAKAGE DETECTED/);

      expect(() => {
        assertNoGroundTruthLeakage("Diagnosing product-image-distortion directly.");
      }).toThrow(/CRITICAL LEAKAGE DETECTED/);

      expect(() => {
        assertNoGroundTruthLeakage("Safe neutral prompt for scenario_01.");
      }).not.toThrow();
    });
  });

  // C. Provider Abstraction Tests
  test.describe("C. VLM Provider Behavior", () => {
    test("creates Mock provider by default without credentials", () => {
      const provider = createVlmProvider({ providerName: "mock" });
      expect(provider.name).toBe("mock");
      expect(provider.model).toBe("mock-vlm-v1");
    });

    test("fails clearly with descriptive error if Gemini credentials missing", () => {
      expect(() => {
        new GeminiVlmProvider({ apiKey: "" });
      }).toThrow(/Gemini API key is missing/);
    });

    test("mock provider returns deterministic diagnoses for visual cues", async () => {
      const mock = new MockVlmProvider();
      const res = await mock.diagnose({
        prompt: "TECHNICAL CONTEXT & COMPUTED METRICS: { 'image.objectFit': 'fill', 'media.height': '380px' }",
      });
      expect(res.status).toBe("diagnosed");
      expect(res.defects[0].category).toBe("image_distortion");
      expect(res.defects[0].confidence).toBeGreaterThan(0.9);
    });
  });

  // D. Evaluator Scoring Tests
  test.describe("D. Evaluation Pipeline & Scoring Rules", () => {
    test("computes exact accuracy, confidence, and per-category breakdowns correctly", () => {
      const evaluator = new DiagnosisEvaluator();

      const mockManifest: any = {
        runId: "test-run",
        provider: "test-provider",
        model: "test-model",
        outputArtifactsDirectory: path.resolve(process.cwd(), "artifacts/visual-evidence"),
        results: {
          "scenario-1": {
            scenarioId: "scenario-1",
            status: "diagnosed",
            diagnosis: {
              schema_version: "1.0",
              status: "diagnosed",
              summary: "Distorted",
              defects: [
                {
                  category: "image_distortion",
                  severity: "medium",
                  confidence: 0.95,
                  description: "Image skewed",
                  evidence: ["Aspect ratio"],
                  affected_element: { description: "Image" },
                  suspected_cause: "fill",
                  suggested_fix: "cover",
                },
              ],
              limitations: [],
            },
          },
          "scenario-2": {
            scenarioId: "scenario-2",
            status: "diagnosed",
            diagnosis: {
              schema_version: "1.0",
              status: "diagnosed",
              summary: "Wrong category",
              defects: [
                {
                  category: "low_contrast",
                  severity: "low",
                  confidence: 0.8,
                  description: "Contrast issue",
                  evidence: ["Color"],
                  affected_element: { description: "Text" },
                  suspected_cause: "Color",
                  suggested_fix: "Darken",
                },
              ],
              limitations: [],
            },
          },
        },
      };

      const mockGroundTruth = {
        scenarios: {
          "scenario-1": {
            defectId: "product-image-distortion",
            expectedCategory: "visual-distortion",
            expectedSymptom: "Distorted image",
          },
          "scenario-2": {
            defectId: "product-card-layout-break",
            expectedCategory: "layout-shift",
            expectedSymptom: "Layout displacement",
          },
        },
      };

      const tempOutDir = path.resolve(process.cwd(), "artifacts/visual-evidence/temp-eval-test");
      fs.mkdirSync(tempOutDir, { recursive: true });

      const report = evaluator.evaluate(mockManifest, mockGroundTruth, tempOutDir);

      expect(report.totalScenarios).toBe(2);
      expect(report.successfullyDiagnosed).toBe(2);
      expect(report.correctCategoryPredictions).toBe(1);
      expect(report.incorrectCategoryPredictions).toBe(1);
      expect(report.overallAccuracyPercent).toBe(50.0);
      expect(report.categoryBreakdown["image_distortion"].correctPredictions).toBe(1);
      expect(report.categoryBreakdown["layout_breakage"].correctPredictions).toBe(0);

      // Clean up temp test directory
      fs.rmSync(tempOutDir, { recursive: true, force: true });
    });
  });

  // E. End-to-End Pipeline Integration Test
  test.describe("E. End-to-End Blind Diagnosis & Evaluation Integration", () => {
    test("runs blind diagnosis and evaluation pipeline against real captured evidence", async () => {
      const evidenceBaseDir = path.resolve(process.cwd(), "artifacts/visual-evidence");
      const runs = fs
        .readdirSync(evidenceBaseDir)
        .filter((d) => d.startsWith("run-") && fs.statSync(path.join(evidenceBaseDir, d)).isDirectory())
        .sort()
        .reverse();

      expect(runs.length).toBeGreaterThan(0);
      const latestRun = runs[0];
      const targetRunDir = path.join(evidenceBaseDir, latestRun);

      // 1. Run diagnosis service with mock provider
      const service = new DiagnosisService({ providerName: "mock" });
      const manifest = await service.diagnoseRun({ runDirectory: targetRunDir });

      expect(manifest.scenariosDiagnosed).toBe(4);
      expect(manifest.totalScenarios).toBe(4);
      expect(fs.existsSync(path.join(manifest.outputArtifactsDirectory, "diagnoses-manifest.json"))).toBe(true);

      // 2. Run evaluation against existing ground_truth_eval.json
      const groundTruthPath = path.join(targetRunDir, "ground_truth_eval.json");
      expect(fs.existsSync(groundTruthPath)).toBe(true);
      const groundTruthData = JSON.parse(fs.readFileSync(groundTruthPath, "utf8"));

      const evaluator = new DiagnosisEvaluator();
      const report = evaluator.evaluate(manifest, groundTruthData, manifest.outputArtifactsDirectory);

      expect(report.totalScenarios).toBe(4);
      expect(report.successfullyDiagnosed).toBe(4);
      expect(report.correctCategoryPredictions).toBe(4);
      expect(report.overallAccuracyPercent).toBe(100.0);
      expect(fs.existsSync(report.evaluationArtifactPath)).toBe(true);

      // 3. Confirm that ground_truth_eval.json and original model_facing_evidence.json were not modified
      expect(groundTruthData.runId).toBe(latestRun);
      const modelEvidence = JSON.parse(fs.readFileSync(path.join(targetRunDir, "model_facing_evidence.json"), "utf8"));
      expect(modelEvidence.runId).toBe(latestRun);
    });
  });
});
