/**
 * OmniSight Backend & AI Engine API Contracts
 *
 * Directly mirrors the Pydantic schemas established in:
 * - Person 3 (Backend Orchestrator): backend/job_schemas.py & backend/api.py
 * - Person 2 (AI Engine): ai-engine/schemas.py
 *
 * Maintained by Person 4 (GitHub Integration & QA Dashboard).
 */

// ---------------------------------------------------------------------------
// 1. Backend Job State Machine & Statuses (backend/job_schemas.py)
// ---------------------------------------------------------------------------

export type BackendJobStatus =
  | "queued"
  | "inspecting"
  | "analyzing"
  | "repair_proposed"
  | "applying_patch"
  | "validating"
  | "pr_created"
  | "needs_review"
  | "completed"
  | "failed";

export const ALL_BACKEND_JOB_STATUSES: readonly BackendJobStatus[] = [
  "queued",
  "inspecting",
  "analyzing",
  "repair_proposed",
  "applying_patch",
  "validating",
  "pr_created",
  "needs_review",
  "completed",
  "failed",
] as const;

// ---------------------------------------------------------------------------
// 2. Artifact References (backend/job_schemas.py)
// ---------------------------------------------------------------------------

export type ArtifactKind = "screenshot" | "dom_snapshot" | "trace" | "log" | "other";

export interface BackendArtifactDraft {
  kind: ArtifactKind;
  uri: string;
  description?: string;
  mock?: boolean;
}

export interface BackendArtifactRef extends BackendArtifactDraft {
  artifact_id: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// 3. Inspection Run Metadata (backend/job_schemas.py)
// ---------------------------------------------------------------------------

export interface BackendInspectionSummary {
  mode: "mock" | "playwright";
  executed: boolean;
  message: string;
  run_id?: string;
  exit_code?: number;
  duration_seconds?: number;
  scenarios_captured?: number;
  total_scenarios?: number;
  stdout_tail?: string;
  stderr_tail?: string;
}

// ---------------------------------------------------------------------------
// 4. Job Request & Response Payloads (backend/api.py & backend/job_schemas.py)
// ---------------------------------------------------------------------------

export interface JobCreateRequest {
  website_url: string;
  target_url?: string; // accepted alias
}

export interface BackendJobResponse {
  job_id: string;
  website_url: string;
  status: BackendJobStatus;
  source: "manual" | "ci_webhook";
  repository?: string;
  commit_sha?: string;
  created_at: string;
  updated_at: string;
  inspection?: BackendInspectionSummary;
  error?: string;
  artifacts: BackendArtifactRef[];
}

export interface BackendJobListResponse {
  items: BackendJobResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface CIWebhookRequest {
  event_type: string; // e.g. "build_success"
  website_url: string;
  repository: string; // "owner/name"
  commit_sha: string;
}

export interface BrowserResultNote {
  type: string;
  executed: boolean;
  message: string;
}

export interface CIWebhookResponse {
  message: string;
  job_id: string;
  website_url: string;
  repository: string;
  commit_sha: string;
  status: BackendJobStatus;
  browser_result: BrowserResultNote;
}

// ---------------------------------------------------------------------------
// 5. AI Engine Analysis & Findings (ai-engine/schemas.py)
// ---------------------------------------------------------------------------

export type DefectCategoryTaxonomy =
  | "mobile_button_clipping"
  | "overlapping_text"
  | "hidden_control"
  | "incorrect_spacing"
  | "modal_overflow"
  | "other"
  | "none";

export interface ViewportConfig {
  width: number;
  height: number;
  is_mobile: boolean;
  device_scale_factor: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EvidenceContext {
  job_id: string;
  screenshot_path: string;
  url: string;
  route?: string;
  viewport?: ViewportConfig;
  dom_snippet?: string;
  step_name?: string;
  timestamp?: string;
}

export interface AIFinding {
  finding_id: string;
  job_id: string;
  defect_category: DefectCategoryTaxonomy;
  description: string;
  evidence_reference: string;
  target_selector?: string;
  target_component?: string;
  confidence: number; // 0.0 to 1.0
  uncertainty_notes?: string;
  requires_human_review: boolean;
  suggested_next_step?: string;
  bounding_box?: BoundingBox;
  created_at: string;
}

export interface AnalysisResponse {
  job_id: string;
  has_defect: boolean;
  findings: AIFinding[];
  analysis_latency_ms?: number;
  raw_model_response?: string;
}

// ---------------------------------------------------------------------------
// 6. Repair Patch Proposals & Git/PR Contracts (ai-engine/schemas.py)
// ---------------------------------------------------------------------------

export interface CodeChange {
  file_path: string;
  description: string;
  unified_diff: string;
}

export interface ValidationChecklist {
  steps: string[];
  expected_outcome: string;
  viewports?: ViewportConfig[];
  selectors_to_check?: string[];
}

export interface PatchProposal {
  finding_id?: string;
  category: DefectCategoryTaxonomy;
  summary: string;
  changes: CodeChange[];
  validation: ValidationChecklist;
  confidence: number;
  requires_human_review: boolean;
}

export interface GitHubPullRequest {
  id: string;
  number: number;
  title: string;
  branch: string;
  baseBranch: string;
  repository: string;
  status: "open" | "closed" | "merged" | "draft";
  url: string;
  createdAt: string;
  updatedAt: string;
  jobId: string;
  findingIds: string[];
  headCommitSha?: string;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
}
