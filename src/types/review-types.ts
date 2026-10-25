/**
 * Types and interfaces for the Step 4.5 Human-in-the-Loop Repair Review Dashboard.
 */

export type ReviewStatus = "pending_review" | "approved" | "rejected";

export type SourceFreshness = "fresh" | "stale" | "missing" | "unverified";

export type DefectCategory =
  | "image_distortion"
  | "layout_breakage"
  | "low_contrast"
  | "responsive_overflow"
  | "unknown";

export type DefectSeverity = "low" | "medium" | "high" | "critical";

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

export interface VisualEvidencePair {
  scenarioId: string;
  route: string;
  viewport: { width: number; height: number };
  baselineScreenshotUrl: string;
  defectiveScreenshotUrl: string;
  postRepairScreenshotUrl?: string;
  pageTitle: string;
  measurements?: Record<string, any>;
  runId?: string;
  postRepairRunId?: string;
  postRepairJobId?: string;
}

export interface ReviewProposalItem {
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
  confidence: "low" | "medium" | "high";
  confidenceScore: number;
  potentialRisks: string[];
  requiredValidationTests: string[];
  humanReviewStatus: ReviewStatus;
  status: string;
  createdAt: string;
  isMock: boolean;
  // Dashboard-computed or enriched fields
  sourceFreshness: SourceFreshness;
  visualEvidence?: VisualEvidencePair;
}

export interface ReviewDecisionRecord {
  proposalId: string;
  scenarioId: string;
  previousStatus: ReviewStatus;
  newStatus: ReviewStatus;
  reviewer: string;
  timestamp: string;
  rejectionReason?: string;
  notes?: string;
}

export interface ReviewDashboardStats {
  totalProposals: number;
  awaitingReview: number;
  approved: number;
  rejected: number;
  staleOrBlocked: number;
}

export interface ProposalFilterState {
  category: string;
  reviewStatus: string;
  freshness: string;
  minConfidence: number;
  searchQuery: string;
}

export interface ClientRepairJobResult {
  jobId: string;
  proposalId: string;
  status: 'PENDING' | 'PASSED' | 'FAILED' | 'REJECTED';
  verificationStatus?: 'passed' | 'failed' | 'inconclusive';
  executedAt: string;
  worktreeBranch: string;
  patchId: string;
  buildPassed: boolean;
  visualPassed: boolean;
  cleanupCompleted: boolean;
  reportPath: string;
  summary: string;
  stage?: string;
  finalState?: string;
  failureReason?: string;
  stdoutTail?: string;
  stderrTail?: string;
  durationSeconds?: number;
  postRepairScreenshotUrl?: string;
  verificationChecks?: Array<{
    name: string;
    expected: string | number | boolean;
    actual: string | number | boolean | null;
    passed: boolean;
  }>;
}
