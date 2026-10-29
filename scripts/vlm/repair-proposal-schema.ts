import { type DefectCategory, type DefectSeverity } from "./diagnosis-schema";

export type RepairProposalStatus =
  | "proposed"
  | "inconclusive"
  | "unsupported_category"
  | "localization_failed"
  | "stale_source"
  | "rejected_safety";

export type HumanReviewStatus = "pending_review" | "approved" | "rejected";

export type ConfidenceLevel = "low" | "medium" | "high";

export interface BoundedSourceExcerpt {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  sha256: string;
}

export interface ProposedCodeCorrection {
  type: "css_rule_modification" | "component_markup_adjustment" | "responsive_query_update";
  targetSelectorOrComponent: string;
  currentCode: string;
  proposedCode: string;
  diffSummary: string;
}

export interface LocalizationEvidence {
  matchedSelector?: string;
  matchedCategory: DefectCategory;
  sourceType: "css" | "react_component";
  rationale: string;
  confidence: number;
}

export interface SourceLocalizationResult {
  status: "localized" | "unsupported" | "ambiguous" | "failed";
  filePath: string | null;
  fileHash: string | null;
  componentOrSelector: string | null;
  excerpt: BoundedSourceExcerpt | null;
  evidence: LocalizationEvidence[];
  uncertaintyNotes: string[];
}

export interface RepairProposal {
  schemaVersion: "1.0";
  proposalId: string;
  scenarioId: string;
  diagnosisRef: {
    diagnosisStatus: string;
    model: string;
    provider: string;
    primaryDefectCategory: DefectCategory;
    reportedConfidence: number;
  };
  defectCategory: DefectCategory;
  severity: DefectSeverity;
  localization: SourceLocalizationResult;
  suspectedRootCause: string;
  evidenceExplanation: string[];
  proposedCorrection: ProposedCodeCorrection;
  expectedVisualImprovement: string;
  confidence: ConfidenceLevel;
  confidenceScore: number;
  potentialRisks: string[];
  requiredValidationTests: string[];
  humanReviewStatus: HumanReviewStatus;
  status: RepairProposalStatus;
  createdAt: string;
  isMock: boolean;
}

export interface RepairProposalValidationResult {
  valid: boolean;
  errors: string[];
  proposal?: RepairProposal;
}

const ALLOWED_CATEGORIES: Set<DefectCategory> = new Set([
  "image_distortion",
  "layout_breakage",
  "low_contrast",
  "responsive_overflow",
  "unknown",
]);

const ALLOWED_PROPOSAL_STATUSES: Set<RepairProposalStatus> = new Set([
  "proposed",
  "inconclusive",
  "unsupported_category",
  "localization_failed",
  "stale_source",
  "rejected_safety",
]);

const ALLOWED_CONFIDENCE_LEVELS: Set<ConfidenceLevel> = new Set(["low", "medium", "high"]);
const ALLOWED_REVIEW_STATUSES: Set<HumanReviewStatus> = new Set(["pending_review", "approved", "rejected"]);

/**
 * Validates a candidate repair proposal object against strict typing and invariants.
 */
export function validateRepairProposalSchema(data: any): RepairProposalValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, errors: ["RepairProposal must be a non-null object."] };
  }

  if (data.schemaVersion !== "1.0") {
    errors.push(`Invalid schemaVersion: expected '1.0', got '${data.schemaVersion}'.`);
  }

  if (typeof data.proposalId !== "string" || !data.proposalId.trim()) {
    errors.push("Missing or empty 'proposalId'.");
  }

  if (typeof data.scenarioId !== "string" || !data.scenarioId.trim()) {
    errors.push("Missing or empty 'scenarioId'.");
  }

  if (!data.diagnosisRef || typeof data.diagnosisRef !== "object") {
    errors.push("Missing or invalid 'diagnosisRef'.");
  }

  if (!ALLOWED_CATEGORIES.has(data.defectCategory)) {
    errors.push(`Invalid defectCategory: '${data.defectCategory}'.`);
  }

  if (!ALLOWED_PROPOSAL_STATUSES.has(data.status)) {
    errors.push(`Invalid status: '${data.status}'.`);
  }

  if (!ALLOWED_CONFIDENCE_LEVELS.has(data.confidence)) {
    errors.push(`Invalid confidence: '${data.confidence}'.`);
  }

  if (typeof data.confidenceScore !== "number" || isNaN(data.confidenceScore) || data.confidenceScore < 0 || data.confidenceScore > 1) {
    errors.push(`confidenceScore must be a number in [0.0, 1.0], received: ${data.confidenceScore}.`);
  }

  if (!ALLOWED_REVIEW_STATUSES.has(data.humanReviewStatus)) {
    errors.push(`Invalid humanReviewStatus: '${data.humanReviewStatus}'.`);
  }

  if (typeof data.suspectedRootCause !== "string" || !data.suspectedRootCause.trim()) {
    errors.push("Missing or empty 'suspectedRootCause'.");
  }

  if (typeof data.expectedVisualImprovement !== "string" || !data.expectedVisualImprovement.trim()) {
    errors.push("Missing or empty 'expectedVisualImprovement'.");
  }

  if (!Array.isArray(data.evidenceExplanation) || data.evidenceExplanation.length === 0) {
    errors.push("'evidenceExplanation' must be a non-empty array of strings.");
  }

  if (!Array.isArray(data.potentialRisks)) {
    errors.push("'potentialRisks' must be an array of strings.");
  }

  if (!Array.isArray(data.requiredValidationTests)) {
    errors.push("'requiredValidationTests' must be an array of strings.");
  }

  if (typeof data.isMock !== "boolean") {
    errors.push("'isMock' flag must be a boolean.");
  }

  // Validate localization section
  if (!data.localization || typeof data.localization !== "object") {
    errors.push("Missing or invalid 'localization' section.");
  } else {
    const loc = data.localization;
    if (!["localized", "unsupported", "ambiguous", "failed"].includes(loc.status)) {
      errors.push(`Invalid localization status: '${loc.status}'.`);
    }

    if (loc.status === "localized") {
      if (!loc.filePath || typeof loc.filePath !== "string") {
        errors.push("Localized proposal must specify a valid non-empty 'filePath'.");
      }
      if (!loc.fileHash || typeof loc.fileHash !== "string" || loc.fileHash.length !== 64) {
        errors.push("Localized proposal must provide a 64-character SHA-256 'fileHash'.");
      }
      if (!loc.excerpt || typeof loc.excerpt !== "object") {
        errors.push("Localized proposal must include a bounded source 'excerpt'.");
      } else {
        if (loc.excerpt.startLine <= 0 || loc.excerpt.endLine < loc.excerpt.startLine) {
          errors.push(`Invalid excerpt line range: ${loc.excerpt.startLine}-${loc.excerpt.endLine}.`);
        }
        if (typeof loc.excerpt.content !== "string" || !loc.excerpt.content.trim()) {
          errors.push("Excerpt content must be a non-empty string.");
        }
      }
    }
  }

  // Validate proposedCorrection if status is proposed
  if (data.status === "proposed") {
    if (!data.proposedCorrection || typeof data.proposedCorrection !== "object") {
      errors.push("Status is 'proposed' but 'proposedCorrection' is missing.");
    } else {
      const corr = data.proposedCorrection;
      if (!corr.targetSelectorOrComponent || !corr.targetSelectorOrComponent.trim()) {
        errors.push("proposedCorrection must have targetSelectorOrComponent.");
      }
      if (typeof corr.currentCode !== "string" || !corr.currentCode.trim()) {
        errors.push("proposedCorrection must provide non-empty currentCode.");
      }
      if (typeof corr.proposedCode !== "string" || !corr.proposedCode.trim()) {
        errors.push("proposedCorrection must provide non-empty proposedCode.");
      }
      if (typeof corr.diffSummary !== "string" || !corr.diffSummary.trim()) {
        errors.push("proposedCorrection must provide a non-empty diffSummary.");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    proposal: errors.length === 0 ? (data as RepairProposal) : undefined,
  };
}
