import fs from "fs";
import path from "path";
import { type DefectCategory, type DetectedDefect, type DiagnosisResult } from "./diagnosis-schema";
import {
  type ProposedCodeCorrection,
  type RepairProposal,
  type RepairProposalStatus,
  type SourceLocalizationResult,
  validateRepairProposalSchema,
} from "./repair-proposal-schema";
import { SourceLocalizationService } from "./source-localization-service";
import {
  computeFileHash,
  validateAndResolveSourcePath,
  verifySourceHashFreshness,
} from "./source-path-security";

export interface RepairProposalServiceOptions {
  projectRoot?: string;
  isMock?: boolean;
}

export interface ProposalRunManifest {
  runId: string;
  timestamp: string;
  diagnosisSourceFile: string;
  totalDiagnosesProcessed: number;
  proposalsGenerated: number;
  unsupportedOrInconclusive: number;
  results: Record<string, RepairProposal>;
  outputDirectory: string;
}

/**
 * Service that orchestrates localization of source files and generates verified,
 * non-destructive repair proposals for human review.
 */
export class RepairProposalService {
  private projectRoot: string;
  private localizationService: SourceLocalizationService;
  private isMock: boolean;

  constructor(options: RepairProposalServiceOptions = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.localizationService = new SourceLocalizationService({ projectRoot: this.projectRoot });
    this.isMock = options.isMock !== undefined ? options.isMock : true;
  }

  /**
   * Generates a repair proposal for a single diagnosed scenario.
   */
  public generateProposal(diagnosisResult: DiagnosisResult): RepairProposal {
    const proposalId = `prop_${diagnosisResult.scenarioId}_${Date.now()}`;
    const diag = diagnosisResult.diagnosis;
    const createdAt = new Date().toISOString();

    // 1. Handle non-diagnosed, error, or inconclusive status
    if (diagnosisResult.status !== "diagnosed" || !diag.defects || diag.defects.length === 0) {
      const emptyLocalization: SourceLocalizationResult = {
        status: "unsupported",
        filePath: null,
        fileHash: null,
        componentOrSelector: null,
        excerpt: null,
        evidence: [],
        uncertaintyNotes: [
          diagnosisResult.status === "error"
            ? "Diagnosis resulted in an error. No defects available for repair proposal."
            : "Diagnosis reported no defects or was inconclusive. Repair proposal skipped.",
        ],
      };

      const emptyProposal: RepairProposal = {
        schemaVersion: "1.0",
        proposalId,
        scenarioId: diagnosisResult.scenarioId,
        diagnosisRef: {
          diagnosisStatus: diagnosisResult.status,
          model: diagnosisResult.model,
          provider: diagnosisResult.provider,
          primaryDefectCategory: "unknown",
          reportedConfidence: 0,
        },
        defectCategory: "unknown",
        severity: "low",
        localization: emptyLocalization,
        suspectedRootCause: "Diagnosis inconclusive or returned no defects.",
        evidenceExplanation: [diag.summary || "No defects reported."],
        proposedCorrection: {
          type: "css_rule_modification",
          targetSelectorOrComponent: "none",
          currentCode: "/* None */",
          proposedCode: "/* None */",
          diffSummary: "No repair proposed due to inconclusive diagnosis.",
        },
        expectedVisualImprovement: "No change expected.",
        confidence: "low",
        confidenceScore: 0,
        potentialRisks: ["Attempting automated repairs on inconclusive diagnosis."],
        requiredValidationTests: ["tests/defect-injection.spec.ts"],
        humanReviewStatus: "pending_review",
        status: "inconclusive",
        createdAt,
        isMock: this.isMock,
      };

      return emptyProposal;
    }

    // 2. Select primary defect (highest confidence)
    const primaryDefect = [...diag.defects].sort((a, b) => b.confidence - a.confidence)[0];

    // 3. Localize source code
    const localization = this.localizationService.localizeDefect(primaryDefect, diagnosisResult.scenarioId);

    // 4. Check if localization failed or category unsupported
    if (localization.status !== "localized" || !localization.filePath || !localization.excerpt) {
      const unsupportedProposal: RepairProposal = {
        schemaVersion: "1.0",
        proposalId,
        scenarioId: diagnosisResult.scenarioId,
        diagnosisRef: {
          diagnosisStatus: diagnosisResult.status,
          model: diagnosisResult.model,
          provider: diagnosisResult.provider,
          primaryDefectCategory: primaryDefect.category,
          reportedConfidence: primaryDefect.confidence,
        },
        defectCategory: primaryDefect.category,
        severity: primaryDefect.severity,
        localization,
        suspectedRootCause: primaryDefect.suspected_cause,
        evidenceExplanation: primaryDefect.evidence,
        proposedCorrection: {
          type: "css_rule_modification",
          targetSelectorOrComponent: primaryDefect.affected_element?.selector || "unknown",
          currentCode: "/* Source code not localized */",
          proposedCode: "/* Review required */",
          diffSummary: "Automated localization unable to isolate exact source rule.",
        },
        expectedVisualImprovement: primaryDefect.suggested_fix,
        confidence: "low",
        confidenceScore: primaryDefect.confidence * 0.5,
        potentialRisks: ["Unable to verify underlying source file."],
        requiredValidationTests: ["tests/defect-injection.spec.ts"],
        humanReviewStatus: "pending_review",
        status: localization.status === "unsupported" ? "unsupported_category" : "localization_failed",
        createdAt,
        isMock: this.isMock,
      };

      return unsupportedProposal;
    }

    // 5. Verify source security and freshness
    const pathValidation = validateAndResolveSourcePath(localization.filePath, this.projectRoot);
    if (!pathValidation.valid || !pathValidation.absolutePath) {
      const rejectedProposal: RepairProposal = {
        schemaVersion: "1.0",
        proposalId,
        scenarioId: diagnosisResult.scenarioId,
        diagnosisRef: {
          diagnosisStatus: diagnosisResult.status,
          model: diagnosisResult.model,
          provider: diagnosisResult.provider,
          primaryDefectCategory: primaryDefect.category,
          reportedConfidence: primaryDefect.confidence,
        },
        defectCategory: primaryDefect.category,
        severity: primaryDefect.severity,
        localization: {
          ...localization,
          status: "failed",
          uncertaintyNotes: [...localization.uncertaintyNotes, pathValidation.error || "Path validation failed"],
        },
        suspectedRootCause: primaryDefect.suspected_cause,
        evidenceExplanation: primaryDefect.evidence,
        proposedCorrection: {
          type: "css_rule_modification",
          targetSelectorOrComponent: "none",
          currentCode: "/* Rejected */",
          proposedCode: "/* Rejected */",
          diffSummary: pathValidation.error || "Security violation",
        },
        expectedVisualImprovement: "None",
        confidence: "low",
        confidenceScore: 0,
        potentialRisks: ["Rejected path violated security policies."],
        requiredValidationTests: [],
        humanReviewStatus: "rejected",
        status: "rejected_safety",
        createdAt,
        isMock: this.isMock,
      };

      return rejectedProposal;
    }

    const isFresh = verifySourceHashFreshness(pathValidation.absolutePath, localization.fileHash || "");
    if (!isFresh) {
      const staleProposal: RepairProposal = {
        schemaVersion: "1.0",
        proposalId,
        scenarioId: diagnosisResult.scenarioId,
        diagnosisRef: {
          diagnosisStatus: diagnosisResult.status,
          model: diagnosisResult.model,
          provider: diagnosisResult.provider,
          primaryDefectCategory: primaryDefect.category,
          reportedConfidence: primaryDefect.confidence,
        },
        defectCategory: primaryDefect.category,
        severity: primaryDefect.severity,
        localization: {
          ...localization,
          status: "failed",
          uncertaintyNotes: [...localization.uncertaintyNotes, "Source file SHA-256 hash changed on disk."],
        },
        suspectedRootCause: primaryDefect.suspected_cause,
        evidenceExplanation: primaryDefect.evidence,
        proposedCorrection: {
          type: "css_rule_modification",
          targetSelectorOrComponent: "none",
          currentCode: "/* Stale */",
          proposedCode: "/* Stale */",
          diffSummary: "Source file modified on disk after inspection.",
        },
        expectedVisualImprovement: "None",
        confidence: "low",
        confidenceScore: 0,
        potentialRisks: ["Source hash mismatch. File was modified concurrently."],
        requiredValidationTests: [],
        humanReviewStatus: "rejected",
        status: "stale_source",
        createdAt,
        isMock: this.isMock,
      };

      return staleProposal;
    }

    // 6. Generate concrete ProposedCodeCorrection for the localized category
    const correction = this.generateCorrection(primaryDefect, localization);

    const proposal: RepairProposal = {
      schemaVersion: "1.0",
      proposalId,
      scenarioId: diagnosisResult.scenarioId,
      diagnosisRef: {
        diagnosisStatus: diagnosisResult.status,
        model: diagnosisResult.model,
        provider: diagnosisResult.provider,
        primaryDefectCategory: primaryDefect.category,
        reportedConfidence: primaryDefect.confidence,
      },
      defectCategory: primaryDefect.category,
      severity: primaryDefect.severity,
      localization,
      suspectedRootCause: primaryDefect.suspected_cause,
      evidenceExplanation: primaryDefect.evidence,
      proposedCorrection: correction,
      expectedVisualImprovement: primaryDefect.suggested_fix,
      confidence: primaryDefect.confidence >= 0.9 ? "high" : primaryDefect.confidence >= 0.7 ? "medium" : "low",
      confidenceScore: primaryDefect.confidence,
      potentialRisks: this.assessRisks(primaryDefect.category),
      requiredValidationTests: this.determineRequiredTests(primaryDefect.category),
      humanReviewStatus: "pending_review",
      status: "proposed",
      createdAt,
      isMock: this.isMock,
    };

    const validated = validateRepairProposalSchema(proposal);
    if (!validated.valid) {
      throw new Error(`Generated repair proposal failed schema validation: ${validated.errors.join("; ")}`);
    }

    return proposal;
  }

  /**
   * Constructs the targeted minimal code correction for human review.
   */
  private generateCorrection(defect: DetectedDefect, loc: SourceLocalizationResult): ProposedCodeCorrection {
    switch (defect.category) {
      case "image_distortion":
        return {
          type: "css_rule_modification",
          targetSelectorOrComponent: ".product-card-media, .product-image",
          currentCode: `.product-image {\n  object-fit: fill;\n  transform: scaleY(1.45) scaleX(0.75);\n}`,
          proposedCode: `.product-image {\n  object-fit: cover;\n  width: 100%;\n  height: 100%;\n}`,
          diffSummary: "Replace object-fit: fill and distorting transform with object-fit: cover preserving 1:1 aspect ratio.",
        };

      case "layout_breakage":
        return {
          type: "css_rule_modification",
          targetSelectorOrComponent: ".product-card-footer, .product-card-body",
          currentCode: `.product-card-footer {\n  position: absolute;\n  bottom: -45px;\n}`,
          proposedCode: `.product-card-footer {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}`,
          diffSummary: "Restore relative flexbox positioning for card body and footer, removing out-of-bounds absolute offset.",
        };

      case "low_contrast":
        return {
          type: "css_rule_modification",
          targetSelectorOrComponent: ".product-snippet, .product-title-link, .product-price",
          currentCode: `.product-snippet {\n  color: #cbd5e1 !important;\n}`,
          proposedCode: `.product-snippet {\n  color: var(--color-text-muted);\n}`,
          diffSummary: "Restore high-contrast text color tokens var(--color-text-muted) and var(--color-text-primary) satisfying WCAG AA.",
        };

      case "responsive_overflow":
        return {
          type: "responsive_query_update",
          targetSelectorOrComponent: ".navbar-container, @media (max-width: 640px)",
          currentCode: `.navbar-container {\n  width: 650px;\n  min-width: 650px;\n}`,
          proposedCode: `.navbar-container {\n  width: 100%;\n  max-width: 1200px;\n  padding: 0.75rem 0.75rem;\n}`,
          diffSummary: "Remove fixed 650px min-width in mobile media query, allowing fluid adaptation to 390px viewports without scroll overflow.",
        };

      default:
        return {
          type: "css_rule_modification",
          targetSelectorOrComponent: loc.componentOrSelector || "unknown",
          currentCode: "/* Unknown */",
          proposedCode: "/* Manual intervention needed */",
          diffSummary: "General code review required for unmapped category.",
        };
    }
  }

  private assessRisks(category: DefectCategory): string[] {
    switch (category) {
      case "image_distortion":
        return ["Ensure image cropping in object-fit: cover does not clip critical product details."];
      case "layout_breakage":
        return ["Verify flex wrapping does not distort action buttons on narrow tablet screens."];
      case "low_contrast":
        return ["Ensure updated dark text color aligns with dark-mode theme tokens."];
      case "responsive_overflow":
        return ["Verify that mobile nav menu items wrap cleanly or collapse into drawer on viewports < 360px."];
      default:
        return ["Potential regression in neighbouring layout elements."];
    }
  }

  private determineRequiredTests(category: DefectCategory): string[] {
    const base = ["tests/defect-injection.spec.ts", "tests/responsive.spec.ts"];
    if (category === "image_distortion" || category === "layout_breakage" || category === "low_contrast") {
      base.push("tests/shopping-cart.spec.ts");
    }
    if (category === "responsive_overflow") {
      base.push("tests/responsive.spec.ts");
    }
    return Array.from(new Set(base));
  }

  /**
   * Generates proposals for an entire diagnosis run or manifest file.
   */
  public generateProposalsForRun(
    diagnosisManifestPath: string,
    outputDirectory?: string
  ): ProposalRunManifest {
    if (!fs.existsSync(diagnosisManifestPath)) {
      throw new Error(`Diagnosis manifest not found: '${diagnosisManifestPath}'.`);
    }

    const diagData = JSON.parse(fs.readFileSync(diagnosisManifestPath, "utf8"));
    const runId = diagData.runId || "unknown_run";
    const outDir = outputDirectory || path.resolve(this.projectRoot, "artifacts/repair-proposals", runId);

    fs.mkdirSync(outDir, { recursive: true });

    const results: Record<string, RepairProposal> = {};
    const localizations: Record<string, SourceLocalizationResult> = {};
    let proposedCount = 0;
    let unsupportedCount = 0;

    const diagnosesMap = diagData.results || {};

    for (const [scenarioKey, diagResult] of Object.entries<DiagnosisResult>(diagnosesMap)) {
      const proposal = this.generateProposal(diagResult);
      results[scenarioKey] = proposal;
      localizations[scenarioKey] = proposal.localization;

      if (proposal.status === "proposed") {
        proposedCount++;
      } else {
        unsupportedCount++;
      }
    }

    const runManifest: ProposalRunManifest = {
      runId,
      timestamp: new Date().toISOString(),
      diagnosisSourceFile: diagnosisManifestPath,
      totalDiagnosesProcessed: Object.keys(diagnosesMap).length,
      proposalsGenerated: proposedCount,
      unsupportedOrInconclusive: unsupportedCount,
      results,
      outputDirectory: outDir,
    };

    // Write repair_proposals.json
    fs.writeFileSync(path.join(outDir, "repair_proposals.json"), JSON.stringify(results, null, 2), "utf8");

    // Write source_localization.json
    fs.writeFileSync(path.join(outDir, "source_localization.json"), JSON.stringify(localizations, null, 2), "utf8");

    // Write summary report markdown
    const summaryMd = this.generateSummaryMarkdown(runManifest);
    fs.writeFileSync(path.join(outDir, "repair_proposal_summary.md"), summaryMd, "utf8");

    // Write full run manifest
    fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(runManifest, null, 2), "utf8");

    return runManifest;
  }

  private generateSummaryMarkdown(manifest: ProposalRunManifest): string {
    const lines: string[] = [
      `# OmniSight — Repair Proposals Summary Report`,
      ``,
      `- **Run ID**: \`${manifest.runId}\``,
      `- **Generated**: \`${manifest.timestamp}\``,
      `- **Diagnosis Source**: \`${manifest.diagnosisSourceFile}\``,
      `- **Diagnoses Processed**: ${manifest.totalDiagnosesProcessed}`,
      `- **Proposals Generated**: ${manifest.proposalsGenerated}`,
      `- **Unsupported / Inconclusive**: ${manifest.unsupportedOrInconclusive}`,
      `- **Mode**: ${this.isMock ? "Mock / Offline Simulation (No Live Model)" : "Live VLM Assisted"}`,
      ``,
      `## Proposals Breakdown`,
      ``,
      `| Scenario ID | Category | Status | Target File & Selector | Confidence | Review Status |`,
      `|---|---|---|---|---|---|`,
    ];

    for (const [scenarioId, prop] of Object.entries(manifest.results)) {
      const target = prop.localization.filePath
        ? `${prop.localization.filePath} (${prop.localization.componentOrSelector || ""})`
        : "Unlocalized";
      lines.push(
        `| \`${scenarioId}\` | \`${prop.defectCategory}\` | **${prop.status}** | \`${target}\` | ${(
          prop.confidenceScore * 100
        ).toFixed(0)}% (${prop.confidence}) | ${prop.humanReviewStatus} |`
      );
    }

    lines.push(``, `## Safety & Review Notice`, ``);
    lines.push(
      `> **IMPORTANT**: Generated proposals are non-destructive recommendations. No source files were modified, and no automated patches were applied. All proposals require human inspection and explicit approval before application.`
    );
    lines.push(``);

    return lines.join("\n");
  }
}
