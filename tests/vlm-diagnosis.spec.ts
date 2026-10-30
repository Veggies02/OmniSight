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
import { RepairProposalService } from "../scripts/vlm/repair-proposal-service";

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

  // E. End-to-End Integration: Evidence Harness -> AI Defect Analyzer -> Repair Proposal -> Registered Repair
  test.describe("E. Evidence to AI Defect Analyzer to Repair Integration", () => {
    const evidenceBaseDir = path.resolve(process.cwd(), "artifacts/visual-evidence");

    test("integrates product-image-distortion evidence with analyzer, generates proposal, maps to registered repair, and verifies human approval safety", async () => {
      // 1. Locate latest evidence run
      const runs = fs
        .readdirSync(evidenceBaseDir)
        .filter((d) => d.startsWith("run-") && fs.statSync(path.join(evidenceBaseDir, d)).isDirectory())
        .sort()
        .reverse();
      expect(runs.length).toBeGreaterThan(0);
      const targetRunDir = path.join(evidenceBaseDir, runs[0]);

      // 2. Load model-facing evidence
      const modelEvidencePath = path.join(targetRunDir, "model_facing_evidence.json");
      expect(fs.existsSync(modelEvidencePath)).toBe(true);
      const modelEvidence = JSON.parse(fs.readFileSync(modelEvidencePath, "utf8"));

      const imageDistortionScenario = modelEvidence.scenarios.find(
        (s: any) => s.scenarioId === "product-image-distortion"
      );
      expect(imageDistortionScenario).toBeDefined();

      // Verify screenshot evidence files exist on disk
      const baselineImg = path.join(targetRunDir, imageDistortionScenario.baselineScreenshot);
      const defectiveImg = path.join(targetRunDir, imageDistortionScenario.defectiveScreenshot);
      expect(fs.existsSync(baselineImg)).toBe(true);
      expect(fs.existsSync(defectiveImg)).toBe(true);

      // 3. Run AI Defect Analyzer (DiagnosisService with mock provider)
      const diagnosisService = new DiagnosisService({ providerName: "mock" });
      const diagnosisResult = await diagnosisService.diagnoseScenario(targetRunDir, imageDistortionScenario, 0);

      // 4. Validate structured diagnosis findings
      expect(diagnosisResult.status).toBe("diagnosed");
      expect(diagnosisResult.diagnosis.schema_version).toBe("1.0");
      expect(diagnosisResult.diagnosis.defects.length).toBeGreaterThan(0);

      const primaryDefect = diagnosisResult.diagnosis.defects[0];
      expect(primaryDefect.category).toBe("image_distortion");
      expect(primaryDefect.confidence).toBeGreaterThanOrEqual(0.9);
      expect(primaryDefect.evidence.length).toBeGreaterThan(0);

      // 5. Generate repair proposal via RepairProposalService
      const proposalService = new RepairProposalService({ isMock: true });
      const proposal = proposalService.generateProposal(diagnosisResult);

      expect(proposal.schemaVersion).toBe("1.0");
      expect(proposal.scenarioId).toBe("product-image-distortion");
      expect(proposal.defectCategory).toBe("image_distortion");
      expect(proposal.localization.status).toBe("localized");
      expect(proposal.localization.filePath).toBe("src/index.css");
      expect(proposal.humanReviewStatus).toBe("pending_review");
      expect(proposal.status).toBe("proposed");

      // 6. Map finding to registered patch
      const { findPatchForDefect } = await import("../scripts/repair/patch-registry");
      const matchedPatch = findPatchForDefect(proposal.defectCategory);
      expect(matchedPatch).toBeDefined();
      expect(matchedPatch!.patchId).toBe("patch-product-image-distortion-001");
      expect(matchedPatch!.defectCategory).toBe("product-image-distortion");
      expect(matchedPatch!.approvedSourceFiles).toContain("src/index.css");

      // 7. Human Review Safety Guarantee: Unapproved proposal MUST be rejected by RepairExecutionService
      const { RepairExecutionService } = await import("../scripts/repair/repair-execution-service");
      const repairService = new RepairExecutionService(process.cwd());

      const unapprovedContract = {
        jobId: `test-safety-${Date.now()}`,
        proposalId: proposal.proposalId,
        proposal, // humanReviewStatus: 'pending_review'
        approvedSourcePaths: [proposal.localization.filePath!],
        approvedPatchId: matchedPatch!.patchId,
        targetRepositoryPath: process.cwd(),
        targetBaseCommit: "HEAD",
        createdAt: new Date().toISOString(),
        state: "PENDING" as const,
      };

      const unapprovedReport = await repairService.executeRepairJob(unapprovedContract);
      expect(unapprovedReport.finalState).toBe("REJECTED");
      expect(unapprovedReport.approvalValidation.approved).toBe(false);
      expect(unapprovedReport.failureReason).toContain("must be 'approved'");
      expect(unapprovedReport.patchApplication).toBeUndefined();

      // 8. With explicit human approval, execute repair end-to-end in isolated worktree with visual verifier
      const approvedProposal = {
        ...proposal,
        humanReviewStatus: "approved" as const,
        reviewedBy: "qa-reviewer@omnisight.ai",
        reviewedAt: new Date().toISOString(),
        reviewNotes: "Human reviewer verified distorted aspect ratio finding and approved patch.",
      };

      const approvedContract = {
        ...unapprovedContract,
        jobId: `test-exec-${Date.now()}`,
        proposal: approvedProposal,
      };

      const approvedReport = await repairService.executeRepairJob(approvedContract);
      expect(approvedReport.finalState).toBe("PASSED");
      expect(approvedReport.approvalValidation.approved).toBe(true);
      expect(approvedReport.patchApplication?.appliedSuccessfully).toBe(true);
      expect(approvedReport.buildExecution?.passed).toBe(true);
      expect(approvedReport.visualValidation?.passed).toBe(true);
      expect(approvedReport.cleanupStatus.cleaned).toBe(true);
      expect(approvedReport.cleanupStatus.worktreeRemoved).toBe(true);
    });

    test("handles unknown defect category by returning explicit unmatched result without attempting repair", async () => {
      const { findPatchForDefect } = await import("../scripts/repair/patch-registry");
      const unknownPatch = findPatchForDefect("unknown");
      expect(unknownPatch).toBeUndefined();

      const completelyUnknown = findPatchForDefect("non_existent_category_999");
      expect(completelyUnknown).toBeUndefined();
    });

    test("rejects malformed evidence or missing screenshots safely", async () => {
      const diagnosisService = new DiagnosisService({ providerName: "mock" });
      const malformedScenario = {
        scenarioId: "product-image-distortion",
        baselineScreenshot: "non-existent-baseline.png",
        defectiveScreenshot: "non-existent-defective.png",
        baselineDom: "dom-baseline.html",
        defectiveDom: "dom-defective.html",
        viewport: { width: 1440, height: 900 },
        route: "/products",
        pageTitle: "Title",
        consoleErrors: { baseline: [], defective: [] },
      };

      await expect(
        diagnosisService.diagnoseScenario(process.cwd(), malformedScenario, 0)
      ).rejects.toThrow(/Screenshot artifacts not found/);
    });
  });
});
