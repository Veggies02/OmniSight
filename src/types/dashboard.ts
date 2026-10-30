/**
 * OmniSight Frontend QA Dashboard Domain Types
 *
 * Provides strongly-typed interfaces, domain models, status mappings, and runtime
 * type guards for the React dashboard components.
 */

import type {
  BackendJobStatus,
  BackendJobResponse,
  ArtifactKind,
  DefectCategoryTaxonomy,
  AIFinding,
  GitHubPullRequest,
} from "./contracts.ts";

// ---------------------------------------------------------------------------
// 1. Dashboard Visual Statuses
// ---------------------------------------------------------------------------

export type BadgeStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "needs-review";

export type ValidationStatus =
  | "passed"
  | "failed"
  | "needs-review"
  | "pending"
  | "running"
  | "not-applicable";

export type CheckResultStatus =
  | "passed"
  | "failed"
  | "running"
  | "pending"
  | "skipped";

export type DefectSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "major"
  | "minor"
  | "cosmetic";

export type DefectStatus =
  | "open"
  | "under-review"
  | "resolved"
  | "fix-staged"
  | "pending-review";

// ---------------------------------------------------------------------------
// 2. Defect Findings & Evidence Entities
// ---------------------------------------------------------------------------

export interface DefectFinding {
  id: string;
  title: string;
  category: string | DefectCategoryTaxonomy;
  severity: DefectSeverity;
  affectedComponent: string;
  status: DefectStatus;
  description: string;
  selector?: string;
  evidenceRef?: string;
  jobId?: string;
  targetRoute?: string;
  aiConfidence?: number;
  aiSuggestedNextStep?: string;
}

export interface InspectionEvidence {
  id: string;
  type: "screenshot" | "dom-snapshot" | "playwright-trace" | "visual-comparison" | ArtifactKind;
  title: string;
  viewport: string;
  capturedAt: string;
  dimensions?: string;
  description?: string;
  imageUrl?: string;
  baselineImageUrl?: string;
  defectiveImageUrl?: string;
  diffImageUrl?: string;
  defectId?: string;
  jobId?: string;
  devicePixelRatio?: number;
  browser?: string;
  selector?: string;
  baselineLabel?: string;
  defectiveLabel?: string;
}

// ---------------------------------------------------------------------------
// 3. Validation Results Entities
// ---------------------------------------------------------------------------

export interface ValidationCheck {
  id: string;
  name: string;
  description?: string;
  status: CheckResultStatus;
  duration?: string;
  target?: string;
  assertionType?: string;
  actualValue?: string;
  expectedValue?: string;
  errorMessage?: string;
  evidenceRef?: string;
}

export interface JobValidationResult {
  status: ValidationStatus;
  startedAt?: string;
  completedAt?: string;
  duration?: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  skippedChecks?: number;
  failureSummary?: string;
  checks: ValidationCheck[];
}

// ---------------------------------------------------------------------------
// 4. Inspection Job Summary & Details
// ---------------------------------------------------------------------------

export interface InspectionJobSummary {
  id: string;
  application: string;
  targetRoute: string;
  timestamp: string;
  startedAt: string;
  status: BadgeStatus;
  defectsCount: number;
  validationStatus: ValidationStatus;
  duration: string;
  viewport: string;
  defectSummary?: string;
}

export interface InspectionJob extends InspectionJobSummary {
  defects?: DefectFinding[];
  evidence?: InspectionEvidence[];
  validation?: JobValidationResult;
  backendJobId?: string;
  repository?: string;
  commitSha?: string;
  repairBranch?: string;
  pullRequest?: GitHubPullRequest;
}

// ---------------------------------------------------------------------------
// 5. Status Translation & Bidirectional Mapping Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a backend job state machine status into the frontend BadgeStatus
 */
export function backendJobStatusToBadgeStatus(backendStatus: BackendJobStatus): BadgeStatus {
  switch (backendStatus) {
    case "queued":
      return "pending";
    case "inspecting":
    case "analyzing":
    case "applying_patch":
    case "validating":
      return "running";
    case "completed":
    case "pr_created":
      return "passed";
    case "failed":
      return "failed";
    case "repair_proposed":
    case "needs_review":
    default:
      return "needs-review";
  }
}

/**
 * Maps a backend AI finding into a frontend DefectFinding
 */
export function adaptAIFindingToDefect(ai: AIFinding): DefectFinding {
  return {
    id: ai.finding_id,
    title: `${formatCategoryName(ai.defect_category)} Discrepancy`,
    category: ai.defect_category,
    severity: ai.requires_human_review ? "high" : "medium",
    affectedComponent: ai.target_component || "Unknown Component",
    status: ai.requires_human_review ? "under-review" : "open",
    description: ai.description,
    selector: ai.target_selector,
    evidenceRef: ai.evidence_reference,
    jobId: ai.job_id,
    aiConfidence: ai.confidence,
    aiSuggestedNextStep: ai.suggested_next_step,
  };
}

function formatCategoryName(category: string): string {
  return category
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// 6. Lightweight Runtime Type Guards (Zero Dependencies)
// ---------------------------------------------------------------------------

export function isBackendJobResponse(val: unknown): val is BackendJobResponse {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.job_id === "string" &&
    typeof obj.website_url === "string" &&
    typeof obj.status === "string" &&
    Array.isArray(obj.artifacts)
  );
}

export function isDefectFinding(val: unknown): val is DefectFinding {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.title === "string" &&
    typeof obj.severity === "string" &&
    typeof obj.status === "string"
  );
}

export function isInspectionEvidence(val: unknown): val is InspectionEvidence {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.type === "string" &&
    typeof obj.viewport === "string"
  );
}

export function isJobValidationResult(val: unknown): val is JobValidationResult {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.status === "string" &&
    typeof obj.totalChecks === "number" &&
    Array.isArray(obj.checks)
  );
}
