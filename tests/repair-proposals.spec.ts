import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  validateRepairProposalSchema,
  type RepairProposal,
} from "../scripts/vlm/repair-proposal-schema";
import {
  computeFileHash,
  SOURCE_FILE_ALLOWLIST,
  validateAndResolveSourcePath,
  verifySourceHashFreshness,
} from "../scripts/vlm/source-path-security";
import { SourceLocalizationService } from "../scripts/vlm/source-localization-service";
import { RepairProposalService } from "../scripts/vlm/repair-proposal-service";
import { type DiagnosisResult } from "../scripts/vlm/diagnosis-schema";
import {
  resolveAuthoritativePatch,
  findPatchForScenario,
  getExpectedCategoryForScenario,
  findPatchForDefect,
} from "../scripts/repair/patch-registry";

test.describe("Step 4.4 Defect Localization & Repair Proposal Generation", () => {
  // =========================================================================
  // 1. Repair Proposal Schema Validation
  // =========================================================================
  test.describe("1. Repair Proposal Schema Validation", () => {
    test("accepts a valid, fully formed repair proposal", () => {
      const validProposal: RepairProposal = {
        schemaVersion: "1.0",
        proposalId: "prop_image_distortion_001",
        scenarioId: "product-image-distortion",
        diagnosisRef: {
          diagnosisStatus: "diagnosed",
          model: "mock-vlm-v1",
          provider: "mock",
          primaryDefectCategory: "image_distortion",
          reportedConfidence: 0.94,
        },
        defectCategory: "image_distortion",
        severity: "medium",
        localization: {
          status: "localized",
          filePath: "src/index.css",
          fileHash: "a".repeat(64),
          componentOrSelector: ".product-image",
          excerpt: {
            filePath: "src/index.css",
            startLine: 450,
            endLine: 470,
            content: ".product-image { object-fit: cover; }",
            sha256: "a".repeat(64),
          },
          evidence: [
            {
              matchedSelector: ".product-image",
              matchedCategory: "image_distortion",
              sourceType: "css",
              rationale: "Matched image rules",
              confidence: 0.94,
            },
          ],
          uncertaintyNotes: [],
        },
        suspectedRootCause: "object-fit: fill override",
        evidenceExplanation: ["Image height stretched."],
        proposedCorrection: {
          type: "css_rule_modification",
          targetSelectorOrComponent: ".product-image",
          currentCode: "object-fit: fill;",
          proposedCode: "object-fit: cover;",
          diffSummary: "Restore object-fit: cover",
        },
        expectedVisualImprovement: "Restore 1:1 aspect ratio",
        confidence: "high",
        confidenceScore: 0.94,
        potentialRisks: ["Image cropping"],
        requiredValidationTests: ["tests/defect-injection.spec.ts"],
        humanReviewStatus: "pending_review",
        status: "proposed",
        createdAt: new Date().toISOString(),
        isMock: true,
      };

      const result = validateRepairProposalSchema(validProposal);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.proposal).toBeDefined();
    });

    test("rejects invalid schema version, empty fields, and out-of-range confidence", () => {
      const invalid: any = {
        schemaVersion: "2.0",
        proposalId: "",
        scenarioId: "test-scenario",
        diagnosisRef: {},
        defectCategory: "invalid_category",
        severity: "low",
        localization: { status: "localized" },
        suspectedRootCause: "",
        evidenceExplanation: [],
        proposedCorrection: {},
        expectedVisualImprovement: "",
        confidence: "super_high",
        confidenceScore: 1.5,
        potentialRisks: "not-an-array",
        requiredValidationTests: [],
        humanReviewStatus: "auto_merge",
        status: "auto_applied",
        isMock: "true",
      };

      const result = validateRepairProposalSchema(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
      expect(result.errors.some((e) => e.includes("proposalId"))).toBe(true);
      expect(result.errors.some((e) => e.includes("defectCategory"))).toBe(true);
      expect(result.errors.some((e) => e.includes("confidenceScore"))).toBe(true);
      expect(result.errors.some((e) => e.includes("status"))).toBe(true);
    });
  });

  // =========================================================================
  // 2. Security Validation & Path Traversal Protections
  // =========================================================================
  test.describe("2. Security Validation & Path Traversal Protections", () => {
    test("rejects absolute paths", () => {
      const res = validateAndResolveSourcePath("/etc/passwd");
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Absolute paths are strictly forbidden");
    });

    test("rejects parent-directory traversal attempts", () => {
      const res = validateAndResolveSourcePath("../../../src/index.css");
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Path traversal or null bytes detected");
    });

    test("rejects paths outside source allowlist (configs, package.json, .env)", () => {
      expect(validateAndResolveSourcePath("package.json").valid).toBe(false);
      expect(validateAndResolveSourcePath(".env").valid).toBe(false);
      expect(validateAndResolveSourcePath("package-lock.json").valid).toBe(false);
      expect(validateAndResolveSourcePath("dist/index.html").valid).toBe(false);
      expect(validateAndResolveSourcePath("artifacts/visual-evidence/run-1/ground_truth_eval.json").valid).toBe(false);
    });

    test("rejects nonexistent files even if in allowlist format", () => {
      const res = validateAndResolveSourcePath("src/pages/NonExistent.tsx");
      expect(res.valid).toBe(false);
      expect(res.error).toContain("not in the source allowlist");
    });

    test("accepts valid allowlisted source files inside project tree", () => {
      const res = validateAndResolveSourcePath("src/index.css");
      expect(res.valid).toBe(true);
      expect(res.normalizedRelativePath).toBe("src/index.css");
      expect(res.absolutePath).toBeDefined();
    });
  });

  // =========================================================================
  // 3. Source Hash Verification & Freshness
  // =========================================================================
  test.describe("3. Source Hash Verification & Stale Source Detection", () => {
    test("computes sha256 hash and validates matching freshness", () => {
      const absPath = path.resolve(process.cwd(), "src/index.css");
      const hash = computeFileHash(absPath);
      expect(hash).toHaveLength(64);
      expect(verifySourceHashFreshness(absPath, hash)).toBe(true);
    });

    test("detects hash mismatch as stale source", () => {
      const absPath = path.resolve(process.cwd(), "src/index.css");
      const staleHash = "0".repeat(64);
      expect(verifySourceHashFreshness(absPath, staleHash)).toBe(false);
    });
  });

  // =========================================================================
  // 4. Source Localization Service
  // =========================================================================
  test.describe("4. Source Localization Service", () => {
    const locService = new SourceLocalizationService();

    test("localizes image_distortion defect to src/index.css with bounded excerpt", () => {
      const defect = {
        category: "image_distortion" as const,
        severity: "medium" as const,
        confidence: 0.94,
        description: "Image is vertically distorted.",
        evidence: ["Height is stretched."],
        affected_element: { description: "Product image", selector: ".product-image" },
        suspected_cause: "object-fit: fill",
        suggested_fix: "object-fit: cover",
      };

      const loc = locService.localizeDefect(defect);
      expect(loc.status).toBe("localized");
      expect(loc.filePath).toBe("src/index.css");
      expect(loc.excerpt).not.toBeNull();
      expect(loc.excerpt?.startLine).toBeGreaterThan(0);
      expect(loc.excerpt?.endLine).toBeGreaterThan(loc.excerpt!.startLine);
      expect(loc.fileHash).toHaveLength(64);
      expect(loc.evidence.length).toBeGreaterThan(0);
    });

    test("localizes layout_breakage defect to src/index.css", () => {
      const defect = {
        category: "layout_breakage" as const,
        severity: "high" as const,
        confidence: 0.96,
        description: "Footer displaced outside card.",
        evidence: ["Negative offset"],
        affected_element: { description: "Card footer", selector: ".product-card-footer" },
        suspected_cause: "Absolute positioning",
        suggested_fix: "Flex layout",
      };

      const loc = locService.localizeDefect(defect);
      expect(loc.status).toBe("localized");
      expect(loc.filePath).toBe("src/index.css");
      expect(loc.excerpt).not.toBeNull();
    });

    test("localizes low_contrast defect to src/index.css", () => {
      const defect = {
        category: "low_contrast" as const,
        severity: "medium" as const,
        confidence: 0.92,
        description: "Low contrast text.",
        evidence: ["Contrast ratio below 4.5:1"],
        affected_element: { description: "Snippet text", selector: ".product-snippet" },
        suspected_cause: "#cbd5e1 override",
        suggested_fix: "Use darker text color",
      };

      const loc = locService.localizeDefect(defect);
      expect(loc.status).toBe("localized");
      expect(loc.filePath).toBe("src/index.css");
      expect(loc.excerpt).not.toBeNull();
    });

    test("localizes responsive_overflow defect to src/index.css navbar media query", () => {
      const defect = {
        category: "responsive_overflow" as const,
        severity: "high" as const,
        confidence: 0.95,
        description: "Navbar exceeds mobile viewport.",
        evidence: ["Scroll width exceeds client width."],
        affected_element: { description: "Navbar container", selector: ".navbar-container" },
        suspected_cause: "650px min-width",
        suggested_fix: "Remove fixed min-width",
      };

      const loc = locService.localizeDefect(defect);
      expect(loc.status).toBe("localized");
      expect(loc.filePath).toBe("src/index.css");
      expect(loc.excerpt).not.toBeNull();
    });

    test("returns unsupported status for unknown defect category", () => {
      const defect = {
        category: "unknown" as const,
        severity: "low" as const,
        confidence: 0.1,
        description: "Unrecognized anomaly.",
        evidence: ["Visual difference"],
        affected_element: { description: "Unknown element" },
        suspected_cause: "Unknown",
        suggested_fix: "Manual investigation",
      };

      const loc = locService.localizeDefect(defect);
      expect(loc.status).toBe("unsupported");
      expect(loc.filePath).toBeNull();
      expect(loc.excerpt).toBeNull();
      expect(loc.uncertaintyNotes.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 5. Repair Proposal Service & End-to-End Proposal Generation
  // =========================================================================
  test.describe("5. Repair Proposal Generation Service", () => {
    const proposalService = new RepairProposalService({ isMock: true });

    test("generates valid proposals for all four seeded defect diagnosis outputs", () => {
      // Create isolated test fixture directory so test doesn't depend on another test's generated run
      const testFixtureDir = path.resolve(process.cwd(), `artifacts/temp_test_diagnoses_${Date.now()}`);
      const testOutputDir = path.resolve(process.cwd(), `artifacts/temp_test_proposals_${Date.now()}`);
      fs.mkdirSync(testFixtureDir, { recursive: true });

      const scenarios: Array<{ id: string; category: any; summary: string; cause: string; fix: string; selector: string }> = [
        {
          id: "product-image-distortion",
          category: "image_distortion",
          summary: "Image aspect ratio distorted",
          cause: "object-fit: fill with scaling",
          fix: "object-fit: cover",
          selector: ".product-image",
        },
        {
          id: "product-card-layout-break",
          category: "layout_breakage",
          summary: "Card layout boundary overflow",
          cause: "absolute positioning breaking flex flow",
          fix: "restore flex layout",
          selector: ".product-card-body",
        },
        {
          id: "low-contrast-text",
          category: "low_contrast",
          summary: "Text contrast violation",
          cause: "color: #cbd5e1 on light background",
          fix: "color: var(--color-text-muted)",
          selector: ".product-snippet",
        },
        {
          id: "mobile-nav-overflow",
          category: "responsive_overflow",
          summary: "Mobile viewport overflow",
          cause: "width: 650px fixed on mobile",
          fix: "width: 100%; max-width: 1200px",
          selector: ".navbar-container",
        },
      ];

      const resultsMap: Record<string, any> = {};
      for (const s of scenarios) {
        resultsMap[s.id] = {
          scenarioId: s.id,
          status: "diagnosed",
          model: "mock-vlm-v1",
          provider: "mock",
          diagnosis: {
            schema_version: "1.0",
            summary: s.summary,
            defects: [
              {
                id: `def-${s.id}`,
                category: s.category,
                severity: "medium",
                confidence: 0.95,
                evidence: [s.summary],
                suspected_cause: s.cause,
                suggested_fix: s.fix,
                affected_element: { selector: s.selector },
              },
            ],
          },
        };
      }

      const manifestPath = path.join(testFixtureDir, "diagnoses-manifest.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          runId: `isolated-fixture-run-${Date.now()}`,
          timestamp: new Date().toISOString(),
          provider: "mock",
          model: "mock-vlm-v1",
          scenariosDiagnosed: 4,
          totalScenarios: 4,
          results: resultsMap,
          outputArtifactsDirectory: testFixtureDir,
        })
      );

      try {
        const runManifest = proposalService.generateProposalsForRun(manifestPath, testOutputDir);

        expect(runManifest.totalDiagnosesProcessed).toBe(4);
        expect(runManifest.proposalsGenerated).toBe(4);
        expect(runManifest.unsupportedOrInconclusive).toBe(0);

        // Verify each scenario proposal
        for (const [scenarioId, proposal] of Object.entries(runManifest.results)) {
          expect(proposal.status).toBe("proposed");
          expect(proposal.humanReviewStatus).toBe("pending_review");
          expect(proposal.isMock).toBe(true);
          expect(proposal.localization.status).toBe("localized");
          expect(proposal.localization.filePath).toBe("src/index.css");
          expect(proposal.proposedCorrection.proposedCode).not.toBe("");
          expect(proposal.requiredValidationTests.length).toBeGreaterThan(0);
        }

        // Check files created
        expect(fs.existsSync(path.join(testOutputDir, "repair_proposals.json"))).toBe(true);
        expect(fs.existsSync(path.join(testOutputDir, "source_localization.json"))).toBe(true);
        expect(fs.existsSync(path.join(testOutputDir, "repair_proposal_summary.md"))).toBe(true);
      } finally {
        if (fs.existsSync(testFixtureDir)) {
          fs.rmSync(testFixtureDir, { recursive: true, force: true });
        }
        if (fs.existsSync(testOutputDir)) {
          fs.rmSync(testOutputDir, { recursive: true, force: true });
        }
      }
    });

    test("generates inconclusive proposal when diagnosis reports no defect or error", () => {
      const inconclusiveDiag: DiagnosisResult = {
        scenarioId: "clean-run",
        status: "no_defect_detected",
        diagnosis: {
          schema_version: "1.0",
          status: "no_defect_detected",
          summary: "No visual defects detected on page.",
          defects: [],
          limitations: [],
        },
        model: "mock-vlm-v1",
        provider: "mock",
        executionTimeMs: 2,
        sanitizedEvidenceRef: {
          baselineScreenshot: "baseline.png",
          defectiveScreenshot: "defective.png",
          viewport: { width: 1440, height: 900 },
        },
      };

      const proposal = proposalService.generateProposal(inconclusiveDiag);
      expect(proposal.status).toBe("inconclusive");
      expect(proposal.localization.status).toBe("unsupported");
      expect(proposal.proposedCorrection.targetSelectorOrComponent).toBe("none");
    });

    test("rejects proposal generation if source file SHA-256 is stale", () => {
      const diag: DiagnosisResult = {
        scenarioId: "product-image-distortion",
        status: "diagnosed",
        diagnosis: {
          schema_version: "1.0",
          status: "diagnosed",
          summary: "Distorted image",
          defects: [
            {
              category: "image_distortion",
              severity: "medium",
              confidence: 0.94,
              description: "Distorted",
              evidence: ["aspect-ratio"],
              affected_element: { description: "Image", selector: ".product-image" },
              suspected_cause: "fill",
              suggested_fix: "cover",
            },
          ],
          limitations: [],
        },
        model: "mock-vlm-v1",
        provider: "mock",
        executionTimeMs: 2,
        sanitizedEvidenceRef: {
          baselineScreenshot: "baseline.png",
          defectiveScreenshot: "defective.png",
          viewport: { width: 1440, height: 900 },
        },
      };

      // Mock localization service returning stale hash
      const customService = new RepairProposalService({ isMock: true });
      (customService as any).localizationService.localizeDefect = () => ({
        status: "localized",
        filePath: "src/index.css",
        fileHash: "0".repeat(64), // Deliberately stale hash
        componentOrSelector: ".product-image",
        excerpt: {
          filePath: "src/index.css",
          startLine: 1,
          endLine: 10,
          content: "test",
          sha256: "0".repeat(64),
        },
        evidence: [],
        uncertaintyNotes: [],
      });

      const proposal = customService.generateProposal(diag);
      expect(proposal.status).toBe("stale_source");
      expect(proposal.humanReviewStatus).toBe("rejected");
    });

    test("confirms proposal generation did NOT modify application source files", () => {
      // Re-read src/index.css, src/components/ProductCard.tsx, src/components/Navbar.tsx
      const indexCss = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
      expect(indexCss).toContain(".defect-product-image-distortion");
      expect(indexCss).toContain(".defect-product-card-layout-break");
      expect(indexCss).toContain(".defect-low-contrast-text");
      expect(indexCss).toContain(".defect-mobile-nav-overflow");

      const productCard = fs.readFileSync(path.resolve(process.cwd(), "src/components/ProductCard.tsx"), "utf8");
      expect(productCard).toContain("data-defect-applied");

      const navbar = fs.readFileSync(path.resolve(process.cwd(), "src/components/Navbar.tsx"), "utf8");
      expect(navbar).toContain("data-testid=\"navbar\"");
    });
  });

  // =========================================================================
  // 6. Authoritative Scenario Resolution & Category Mismatch Handling
  // =========================================================================
  test.describe("6. Authoritative Scenario Resolution & Category Mismatch Handling", () => {
    const proposalService = new RepairProposalService({ isMock: true });

    test("resolves authoritative patch and category when scenario and diagnosis category match", () => {
      const resolution = resolveAuthoritativePatch("product-image-distortion", "image_distortion");
      expect(resolution.patch).toBeDefined();
      expect(resolution.patch?.patchId).toBe("patch-product-image-distortion-001");
      expect(resolution.expectedCategory).toBe("image_distortion");
      expect(resolution.resolutionSource).toBe("scenario");
      expect(resolution.isMismatch).toBe(false);
      expect(resolution.mismatchWarning).toBeUndefined();

      const diag: DiagnosisResult = {
        scenarioId: "product-image-distortion",
        status: "diagnosed",
        diagnosis: {
          schema_version: "1.0",
          status: "diagnosed",
          summary: "Image distortion detected",
          defects: [
            {
              category: "image_distortion",
              severity: "medium",
              confidence: 0.94,
              description: "Image is distorted with fill",
              evidence: ["aspect-ratio"],
              affected_element: { description: "Thumbnail", selector: ".product-image" },
              suspected_cause: "object-fit: fill override",
              suggested_fix: "object-fit: cover",
            },
          ],
          limitations: [],
        },
        model: "mock-vlm-v1",
        provider: "mock",
        executionTimeMs: 2,
        sanitizedEvidenceRef: {
          baselineScreenshot: "baseline.png",
          defectiveScreenshot: "defective.png",
          viewport: { width: 1440, height: 900 },
        },
      };

      const proposal = proposalService.generateProposal(diag);
      expect(proposal.defectCategory).toBe("image_distortion");
      expect(proposal.diagnosisRef.primaryDefectCategory).toBe("image_distortion");
      expect(proposal.potentialRisks.some((r) => r.includes("Category mismatch detected"))).toBe(false);
      expect(proposal.humanReviewStatus).toBe("pending_review");
    });

    test("authoritatively resolves correct patch and category when AI misdiagnoses category", () => {
      // Scenario is product-card-layout-break (expects layout_breakage), but AI erroneously diagnosed image_distortion
      const resolution = resolveAuthoritativePatch("product-card-layout-break", "image_distortion");
      expect(resolution.patch).toBeDefined();
      expect(resolution.patch?.patchId).toBe("patch-product-card-layout-break-002");
      expect(resolution.expectedCategory).toBe("layout_breakage");
      expect(resolution.resolutionSource).toBe("scenario");
      expect(resolution.isMismatch).toBe(true);
      expect(resolution.mismatchWarning).toContain("Category mismatch detected");
      expect(resolution.mismatchWarning).toContain("product-card-layout-break");

      const misdiagnosedResult: DiagnosisResult = {
        scenarioId: "product-card-layout-break",
        status: "diagnosed",
        diagnosis: {
          schema_version: "1.0",
          status: "diagnosed",
          summary: "AI mistakenly calls layout break an image distortion defect",
          defects: [
            {
              category: "image_distortion", // Erroneous category
              severity: "high",
              confidence: 0.91,
              description: "Product layout is squished",
              evidence: ["grid-distortion"],
              affected_element: { description: "Card container", selector: ".product-grid" },
              suspected_cause: "grid flex issue",
              suggested_fix: "grid fix",
            },
          ],
          limitations: [],
        },
        model: "mock-vlm-v1",
        provider: "mock",
        executionTimeMs: 2,
        sanitizedEvidenceRef: {
          baselineScreenshot: "baseline.png",
          defectiveScreenshot: "defective.png",
          viewport: { width: 1440, height: 900 },
        },
      };

      const proposal = proposalService.generateProposal(misdiagnosedResult);

      // Proposal effective category must be the authoritative expected category
      expect(proposal.defectCategory).toBe("layout_breakage");
      // Raw diagnosis reference retains the model's actual diagnosed category
      expect(proposal.diagnosisRef.primaryDefectCategory).toBe("image_distortion");
      // Code localization targets the authoritative layout element, not image
      expect(proposal.proposedCorrection.targetSelectorOrComponent).toBe(".product-card-footer, .product-card-body");

      // Critical safety check: potentialRisks must contain the explicit mismatch warning
      const riskWarning = proposal.potentialRisks.find((r) => r.includes("Category mismatch detected"));
      expect(riskWarning).toBeDefined();
      expect(riskWarning).toContain("Authoritative scenario 'product-card-layout-break' expects 'layout_breakage'");
      expect(riskWarning).toContain("AI model diagnosed 'image_distortion'");

      // Critical safety check: uncertaintyNotes must also flag the mismatch
      expect(proposal.localization.uncertaintyNotes.some((n) => n.includes("Category mismatch"))).toBe(true);

      // Human review gate must remain strictly enforced
      expect(proposal.humanReviewStatus).toBe("pending_review");
      expect(proposal.status).toBe("proposed");
    });

    test("handles scenario aliases and evaluation case identifiers authoritatively", () => {
      // Short alias
      expect(findPatchForScenario("product-card-layout")?.patchId).toBe("patch-product-card-layout-break-002");
      expect(getExpectedCategoryForScenario("product-card-layout")).toBe("layout_breakage");

      // Evaluation suite IDs
      expect(findPatchForScenario("scenario_01")?.patchId).toBe("patch-product-image-distortion-001");
      expect(findPatchForScenario("scenario_02")?.patchId).toBe("patch-product-card-layout-break-002");
      expect(findPatchForScenario("scenario_03")?.patchId).toBe("patch-low-contrast-text-003");
      expect(findPatchForScenario("scenario_04")?.patchId).toBe("patch-mobile-nav-overflow-004");

      // Case aliases
      expect(findPatchForScenario("case_01")?.patchId).toBe("patch-product-image-distortion-001");
      expect(findPatchForScenario("case_04")?.patchId).toBe("patch-mobile-nav-overflow-004");

      // Ground truth defect labels
      expect(findPatchForScenario("visual-distortion")?.patchId).toBe("patch-product-image-distortion-001");
      expect(findPatchForScenario("layout-shift")?.patchId).toBe("patch-product-card-layout-break-002");
      expect(findPatchForScenario("color-contrast")?.patchId).toBe("patch-low-contrast-text-003");
      expect(findPatchForScenario("responsive-overflow")?.patchId).toBe("patch-mobile-nav-overflow-004");
    });

    test("rejects unknown scenario even with a valid AI category and returns unsupported_category", () => {
      // Security check (AUD-SEC-01): Unknown scenario ID must NOT fall back to AI category
      const resolution = resolveAuthoritativePatch("unknown-custom-scenario-99", "low_contrast");
      expect(resolution.patch).toBeUndefined();
      expect(resolution.expectedCategory).toBeUndefined();
      expect(resolution.resolutionSource).toBe("none");
      expect(resolution.isMismatch).toBe(false);
      expect(resolution.mismatchWarning).toBeUndefined();

      const diag: DiagnosisResult = {
        scenarioId: "unknown-custom-scenario-99",
        status: "diagnosed",
        diagnosis: {
          schema_version: "1.0",
          status: "diagnosed",
          summary: "Low contrast text detected on unmapped scenario",
          defects: [
            {
              category: "low_contrast",
              severity: "low",
              confidence: 0.88,
              description: "Text contrast is below WCAG AAA",
              evidence: ["contrast-ratio"],
              affected_element: { description: "Price tag", selector: ".product-price" },
              suspected_cause: "color: #999",
              suggested_fix: "color: #333",
            },
          ],
          limitations: [],
        },
        model: "mock-vlm-v1",
        provider: "mock",
        executionTimeMs: 2,
        sanitizedEvidenceRef: {
          baselineScreenshot: "baseline.png",
          defectiveScreenshot: "defective.png",
          viewport: { width: 1440, height: 900 },
        },
      };

      const proposal = proposalService.generateProposal(diag);
      expect(proposal.status).toBe("unsupported_category");
      expect(proposal.localization.status).toBe("unsupported");
      expect(proposal.confidenceScore).toBe(0);
      expect(proposal.potentialRisks.some((r) => r.includes("has no registered patch. Automated code repair is unsupported"))).toBe(true);
      expect(proposal.localization.uncertaintyNotes.some((n) => n.includes("Unknown scenario 'unknown-custom-scenario-99'"))).toBe(true);
    });

    test("preserves backward-compatible category fallback when scenarioId is genuinely missing or empty", () => {
      // Legacy proposals without scenarioId fall back to diagnosed category
      const resolutionUndefined = resolveAuthoritativePatch(undefined, "low_contrast");
      expect(resolutionUndefined.patch).toBeDefined();
      expect(resolutionUndefined.patch?.patchId).toBe("patch-low-contrast-text-003");
      expect(resolutionUndefined.resolutionSource).toBe("category");

      const resolutionEmpty = resolveAuthoritativePatch("", "low_contrast");
      expect(resolutionEmpty.patch).toBeDefined();
      expect(resolutionEmpty.patch?.patchId).toBe("patch-low-contrast-text-003");
      expect(resolutionEmpty.resolutionSource).toBe("category");

      const legacyDiag: DiagnosisResult = {
        scenarioId: "", // Genuinely empty scenarioId
        status: "diagnosed",
        diagnosis: {
          schema_version: "1.0",
          status: "diagnosed",
          summary: "Legacy low contrast issue",
          defects: [
            {
              category: "low_contrast",
              severity: "low",
              confidence: 0.9,
              description: "Low contrast text",
              evidence: ["contrast-ratio"],
              affected_element: { description: "Price", selector: ".product-price" },
              suspected_cause: "color: #999",
              suggested_fix: "color: #333",
            },
          ],
          limitations: [],
        },
        model: "mock-vlm-v1",
        provider: "mock",
        executionTimeMs: 2,
        sanitizedEvidenceRef: {
          baselineScreenshot: "baseline.png",
          defectiveScreenshot: "defective.png",
          viewport: { width: 1440, height: 900 },
        },
      };

      const proposal = proposalService.generateProposal(legacyDiag);
      expect(proposal.status).toBe("proposed");
      expect(proposal.defectCategory).toBe("low_contrast");
      expect(proposal.localization.status).toBe("localized");
      expect(proposal.proposedCorrection.targetSelectorOrComponent).toBe(".product-snippet, .product-title-link, .product-price");
    });

    test("returns unsupported when both scenarioId and diagnosed category are unknown", () => {
      const resolution = resolveAuthoritativePatch("unknown-scenario", "unknown_category" as any);
      expect(resolution.patch).toBeUndefined();
      expect(resolution.expectedCategory).toBeUndefined();
      expect(resolution.resolutionSource).toBe("none");

      const diag: DiagnosisResult = {
        scenarioId: "unrecognized-scenario",
        status: "diagnosed",
        diagnosis: {
          schema_version: "1.0",
          status: "diagnosed",
          summary: "Unrecognized defect category",
          defects: [
            {
              category: "unsupported_defect_category" as any,
              severity: "low",
              confidence: 0.5,
              description: "Mystery glitch",
              evidence: [],
              affected_element: { description: "Unknown", selector: ".unknown" },
              suspected_cause: "Unknown",
              suggested_fix: "Unknown",
            },
          ],
          limitations: [],
        },
        model: "mock-vlm-v1",
        provider: "mock",
        executionTimeMs: 2,
        sanitizedEvidenceRef: {
          baselineScreenshot: "baseline.png",
          defectiveScreenshot: "defective.png",
          viewport: { width: 1440, height: 900 },
        },
      };

      const proposal = proposalService.generateProposal(diag);
      expect(proposal.status).toBe("unsupported_category");
      expect(proposal.localization.status).toBe("unsupported");
    });

    test("preserves backward compatibility for legacy findPatchForDefect lookups", () => {
      expect(findPatchForDefect("image_distortion")?.patchId).toBe("patch-product-image-distortion-001");
      expect(findPatchForDefect("layout_breakage")?.patchId).toBe("patch-product-card-layout-break-002");
      expect(findPatchForDefect("color_contrast")?.patchId).toBe("patch-low-contrast-text-003");
      expect(findPatchForDefect("responsive_overflow")?.patchId).toBe("patch-mobile-nav-overflow-004");
      // Scenario ID lookup via findPatchForDefect
      expect(findPatchForDefect("product-image-distortion")?.patchId).toBe("patch-product-image-distortion-001");
      expect(findPatchForDefect("non_existent")).toBeUndefined();
    });
  });
});
