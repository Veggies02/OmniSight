/**
 * Backend Repair API Client and Types
 *
 * Connects the OmniSight frontend review interface to Shilpa's FastAPI backend
 * endpoints (implemented on origin/integration/backend-repair-e2e at commit 287f606):
 * - POST /jobs/{job_id}/proposal
 * - POST /jobs/{job_id}/approval
 * - POST /jobs/{job_id}/repair
 * - GET  /jobs/{job_id}
 */

import type { ReviewProposalItem } from "../types/review-types";

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

export type BackendJobStage =
  | "queued"
  | "inspecting"
  | "analyzing"
  | "awaiting_approval"
  | "repairing"
  | "verifying"
  | (string & {});

export interface BackendRepairApproval {
  reviewed_by: string;
  reviewed_at: string;
}

export interface BackendRepairResult {
  outcome: "passed" | "failed" | "rejected" | "error";
  passed?: boolean;
  job_id?: string;
  message?: string;
  exit_code?: number;
  final_state?: string;
  failure_reason?: string;
  approved?: boolean;
  build_passed?: boolean;
  test_passed?: boolean;
  visual_passed?: boolean;
  patch_id?: string;
  proposal_id?: string;
  cleanup?: Record<string, any>;
  proposal_path?: string;
  report_path?: string;
  duration_seconds?: number;
  stdout_tail?: string;
  stderr_tail?: string;
  branch?: string;
  commit_sha?: string;
}

export interface BackendArtifactRef {
  artifact_id: string;
  job_id?: string;
  kind: "screenshot" | "dom_snapshot" | "trace" | "log" | "other" | (string & {});
  uri: string;
  description: string;
  mock: boolean;
  created_at: string;
}

export interface BackendPullRequestResponse {
  pr_number: number;
  pr_url: string;
  title: string;
  head_branch: string;
  base_branch: string;
  head_commit_sha?: string;
  status: string; // "draft" | "open"
  is_draft: boolean;
  merged: boolean;
  created_at: string;
  repository: string;
  existing: boolean;
  author?: string;
  job_id?: string;
}

export interface BackendPullRequestCreateRequest {
  title?: string;
  body?: string;
  base_branch?: string;
  head_branch?: string;
  draft?: boolean;
  repository?: string;
  labels?: string[];
}

// ============================================================================
// Multi-Scenario V2 Types (agreed with Backend V2 contract)
// ============================================================================

export type ScenarioReviewStatus = "pending_review" | "approved" | "rejected";

export type ScenarioRepairState =
  | "not_started"
  | "running"
  | "passed"
  | "failed"
  | "rejected"
  | "unsupported"
  | "error";

export type ScenarioPRStatus = "not_started" | "created" | "failed";

export type ScenarioOutcome =
  | "all_passed"
  | "partial"
  | "all_failed"
  | "all_rejected"
  | "no_repairs_needed";

export interface ScenarioSummary {
  total: number;
  pending_review: number;
  approved: number;
  repairing: number;
  passed: number;
  failed: number;
  rejected: number;
  unsupported: number;
  prs_created: number;
}

export interface ScenarioDiagnosis {
  provider: string;
  model: string;
  status: string;
  primaryDefectCategory?: string;
  reportedConfidence?: number;
  [key: string]: any;
}

export interface ScenarioProposal {
  schemaVersion?: string;
  proposalId?: string;
  scenarioId?: string;
  defectCategory?: string;
  suspectedRootCause?: string;
  expectedVisualImprovement?: string;
  proposedCorrection?: Record<string, any>;
  requiredValidationTests?: string[];
  [key: string]: any;
}

export interface ScenarioApproval {
  reviewed_by: string;
  reviewed_at: string;
}

export interface ScenarioRepairResult {
  outcome: "passed" | "failed" | "rejected" | "unsupported" | "error" | (string & {});
  passed?: boolean;
  job_id?: string;
  message?: string;
  exit_code?: number;
  final_state?: string;
  failure_reason?: string;
  approved?: boolean;
  build_passed?: boolean;
  test_passed?: boolean;
  visual_passed?: boolean;
  patch_id?: string;
  proposal_id?: string;
  cleanup?: Record<string, any>;
  proposal_path?: string;
  report_path?: string;
  duration_seconds?: number;
  stdout_tail?: string;
  stderr_tail?: string;
  branch?: string;
  commit_sha?: string;
  [key: string]: any;
}

export interface ScenarioPullRequest {
  pr_number: number;
  url?: string;
  pr_url?: string;
  title?: string;
  state?: string;
  status?: string;
  draft?: boolean;
  is_draft?: boolean;
  head_branch: string;
  head_commit_sha?: string;
  base_branch: string;
  repository: string;
  existing?: boolean;
  created_at?: string;
  [key: string]: any;
}

export interface ScenarioResponse {
  scenario_id: string;
  defect_category: string;
  is_mock: boolean;
  diagnosis: ScenarioDiagnosis;
  proposal: ScenarioProposal | Record<string, any>;
  review_status: ScenarioReviewStatus;
  approval: ScenarioApproval | null;
  repair_state: ScenarioRepairState;
  repair_job_id: string;
  repair: ScenarioRepairResult | null;
  pr_status: ScenarioPRStatus;
  pull_request: ScenarioPullRequest | null;
}

export interface CreateScenarioPullRequestPayload {
  title?: string;
  body?: string;
  base_branch?: string;
}

export interface BackendJobResponse {
  job_id: string;
  website_url: string;
  status: BackendJobStatus | (string & {});
  stage: BackendJobStage;
  source: "manual" | "ci_webhook" | (string & {});
  repository?: string;
  commit_sha?: string;
  created_at: string;
  updated_at: string;
  inspection?: Record<string, any>;
  proposal?: Record<string, any>;
  approval?: BackendRepairApproval;
  repair?: BackendRepairResult;
  pull_request?: BackendPullRequestResponse;
  error?: string;
  artifacts: BackendArtifactRef[];
  // v2 multi-scenario additions (per CONTRACT_V2_DRAFT.md)
  summary?: ScenarioSummary;
  outcome?: ScenarioOutcome | null;
  scenarios?: ScenarioResponse[];
}

export class BackendRepairError extends Error {
  public readonly status?: number;
  public readonly details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "BackendRepairError";
    this.status = status;
    this.details = details;
  }
}

export interface BackendRepairClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  /**
   * Optional hook for injecting authorization headers when running behind a
   * trusted server proxy or secure session gateway.
   * Privileged backend operator tokens must NEVER be stored in browser storage
   * (sessionStorage / localStorage) or Vite environment variables.
   */
  getAuthHeader?: () => Record<string, string>;
}

export class BackendRepairClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly getAuthHeader?: () => Record<string, string>;

  constructor(config: BackendRepairClientConfig = {}) {
    const envBase =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
        ? (import.meta.env.VITE_API_BASE_URL as string)
        : "";

    this.baseUrl = (config.baseUrl ?? envBase).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.getAuthHeader = config.getAuthHeader;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit & { timeoutMs?: number; requireAuth?: boolean } = {}
  ): Promise<T> {
    const cleanEndpoint = endpoint.replace(/^\/+/, "");
    const url = this.baseUrl ? `${this.baseUrl}/${cleanEndpoint}` : `/${cleanEndpoint}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    if (options.requireAuth && this.getAuthHeader) {
      const authHeaders = this.getAuthHeader();
      Object.assign(headers, authHeaders);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        let errDetails: unknown;
        try {
          errDetails = await response.json();
        } catch {
          errDetails = await response.text();
        }

        const msg =
          typeof errDetails === "object" && errDetails !== null && "detail" in errDetails
            ? String((errDetails as { detail: unknown }).detail)
            : `Backend request to ${cleanEndpoint} failed with HTTP ${response.status}`;

        throw new BackendRepairError(msg, response.status, errDetails);
      }

      if (response.status === 204) {
        return null as unknown as T;
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof BackendRepairError) {
        throw err;
      }
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new BackendRepairError(`Request to ${cleanEndpoint} timed out`, 408);
      }
      throw new BackendRepairError(
        err instanceof Error ? err.message : "Network request failed",
        0,
        err
      );
    }
  }

  /**
   * Health check to detect if FastAPI backend is online
   */
  public async getHealth(): Promise<{ status: string }> {
    return this.request<{ status: string }>("health");
  }

  /**
   * Retrieve current job details, status, stage, artifacts, and repair results
   * GET /jobs/{job_id}
   */
  public async getJob(jobId: string): Promise<BackendJobResponse> {
    return this.request<BackendJobResponse>(`jobs/${encodeURIComponent(jobId)}`);
  }

  /**
   * Attach proposal to job for review
   * POST /jobs/{job_id}/proposal
   */
  public async attachProposal(
    jobId: string,
    proposal: ReviewProposalItem
  ): Promise<BackendJobResponse> {
    return this.request<BackendJobResponse>(`jobs/${encodeURIComponent(jobId)}/proposal`, {
      method: "POST",
      body: JSON.stringify({ proposal }),
      requireAuth: true,
    });
  }

  /**
   * Record human review approval in backend
   * POST /jobs/{job_id}/approval
   */
  public async recordApproval(
    jobId: string,
    reviewedBy: string
  ): Promise<BackendJobResponse> {
    return this.request<BackendJobResponse>(`jobs/${encodeURIComponent(jobId)}/approval`, {
      method: "POST",
      body: JSON.stringify({ reviewed_by: reviewedBy }),
      requireAuth: true,
    });
  }

  /**
   * Request repair execution from backend
   * POST /jobs/{job_id}/repair
   */
  public async executeRepair(jobId: string): Promise<BackendJobResponse> {
    return this.request<BackendJobResponse>(`jobs/${encodeURIComponent(jobId)}/repair`, {
      method: "POST",
      requireAuth: true,
    });
  }

  /**
   * Request server-side Draft Pull Request creation for an approved, verified repair
   * POST /jobs/{job_id}/pr
   */
  public async createPullRequest(
    jobId: string,
    request?: BackendPullRequestCreateRequest
  ): Promise<BackendPullRequestResponse> {
    return this.request<BackendPullRequestResponse>(`jobs/${encodeURIComponent(jobId)}/pr`, {
      method: "POST",
      body: request ? JSON.stringify(request) : undefined,
      requireAuth: true,
    });
  }

  /**
   * Fetch created Pull Request metadata for a repair job
   * GET /jobs/{job_id}/pr
   */
  public async getPullRequest(jobId: string): Promise<BackendPullRequestResponse | null> {
    try {
      return await this.request<BackendPullRequestResponse>(`jobs/${encodeURIComponent(jobId)}/pr`);
    } catch (err: unknown) {
      if (err instanceof BackendRepairError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  // ============================================================================
  // Multi-Scenario V2 API Methods (agreed with Backend V2 contract)
  // ============================================================================

  /**
   * Retrieve list of scenarios for a job (v2)
   * GET /jobs/{job_id}/scenarios
   */
  public async getJobScenarios(jobId: string): Promise<ScenarioResponse[]> {
    const raw = await this.request<ScenarioResponse[] | { scenarios: ScenarioResponse[] }>(
      `jobs/${encodeURIComponent(jobId)}/scenarios`
    );
    if (Array.isArray(raw)) {
      return raw;
    }
    if (raw && typeof raw === "object" && Array.isArray((raw as any).scenarios)) {
      return (raw as any).scenarios;
    }
    return [];
  }

  /**
   * Retrieve a single scenario for a job (v2)
   * GET /jobs/{job_id}/scenarios/{scenario_id}
   */
  public async getScenario(jobId: string, scenarioId: string): Promise<ScenarioResponse> {
    return this.request<ScenarioResponse>(
      `jobs/${encodeURIComponent(jobId)}/scenarios/${encodeURIComponent(scenarioId)}`
    );
  }

  /**
   * Record human review approval for a specific scenario (v2)
   * POST /jobs/{job_id}/scenarios/{scenario_id}/approval
   */
  public async approveScenario(
    jobId: string,
    scenarioId: string,
    reviewedBy: string = "reviewer"
  ): Promise<ScenarioResponse> {
    return this.request<ScenarioResponse>(
      `jobs/${encodeURIComponent(jobId)}/scenarios/${encodeURIComponent(scenarioId)}/approval`,
      {
        method: "POST",
        body: JSON.stringify({ reviewed_by: reviewedBy }),
        requireAuth: true,
      }
    );
  }

  /**
   * Record human review rejection for a specific scenario (v2)
   * POST /jobs/{job_id}/scenarios/{scenario_id}/rejection
   */
  public async rejectScenario(
    jobId: string,
    scenarioId: string,
    reviewedBy: string = "reviewer",
    reason?: string
  ): Promise<ScenarioResponse> {
    const body: { reviewed_by: string; reason?: string } = { reviewed_by: reviewedBy };
    if (reason !== undefined) {
      body.reason = reason;
    }
    return this.request<ScenarioResponse>(
      `jobs/${encodeURIComponent(jobId)}/scenarios/${encodeURIComponent(scenarioId)}/rejection`,
      {
        method: "POST",
        body: JSON.stringify(body),
        requireAuth: true,
      }
    );
  }

  /**
   * Request repair execution for a specific scenario (v2)
   * POST /jobs/{job_id}/scenarios/{scenario_id}/repair
   */
  public async executeScenarioRepair(
    jobId: string,
    scenarioId: string
  ): Promise<BackendJobResponse | ScenarioResponse> {
    return this.request<BackendJobResponse | ScenarioResponse>(
      `jobs/${encodeURIComponent(jobId)}/scenarios/${encodeURIComponent(scenarioId)}/repair`,
      {
        method: "POST",
        requireAuth: true,
      }
    );
  }

  /**
   * Request server-side Draft Pull Request creation for an approved, verified scenario (v2)
   * POST /jobs/{job_id}/scenarios/{scenario_id}/pr
   */
  public async createScenarioPullRequest(
    jobId: string,
    scenarioId: string,
    request?: CreateScenarioPullRequestPayload | BackendPullRequestCreateRequest
  ): Promise<ScenarioResponse | ScenarioPullRequest> {
    return this.request<ScenarioResponse | ScenarioPullRequest>(
      `jobs/${encodeURIComponent(jobId)}/scenarios/${encodeURIComponent(scenarioId)}/pr`,
      {
        method: "POST",
        body: request ? JSON.stringify(request) : undefined,
        requireAuth: true,
      }
    );
  }

  /**
   * Fetch created Pull Request metadata for a specific scenario (v2)
   * GET /jobs/{job_id}/scenarios/{scenario_id}/pr
   */
  public async getScenarioPullRequest(
    jobId: string,
    scenarioId: string
  ): Promise<ScenarioPullRequest | null> {
    try {
      return await this.request<ScenarioPullRequest>(
        `jobs/${encodeURIComponent(jobId)}/scenarios/${encodeURIComponent(scenarioId)}/pr`
      );
    } catch (err: unknown) {
      if (err instanceof BackendRepairError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }
}

export const backendRepairClient = new BackendRepairClient();
