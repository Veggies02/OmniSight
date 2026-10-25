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

export interface BackendRepairApproval {
  reviewed_by: string;
  reviewed_at: string;
}

export interface BackendRepairResult {
  outcome: "passed" | "failed" | "rejected" | "error";
  passed: boolean;
  job_id: string;
  message: string;
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
}

export interface BackendArtifactRef {
  artifact_id: string;
  job_id?: string;
  kind: "screenshot" | "dom_snapshot" | "trace" | "log" | "other";
  uri: string;
  description: string;
  mock: boolean;
  created_at: string;
}

export interface BackendJobResponse {
  job_id: string;
  website_url: string;
  status: BackendJobStatus;
  stage?: string;
  source: "manual" | "ci_webhook";
  repository?: string;
  commit_sha?: string;
  created_at: string;
  updated_at: string;
  inspection?: Record<string, any>;
  proposal?: Record<string, any>;
  approval?: BackendRepairApproval;
  repair?: BackendRepairResult;
  error?: string;
  artifacts: BackendArtifactRef[];
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
  getOperatorToken?: () => string | null;
}

export class BackendRepairClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly getOperatorToken: () => string | null;

  constructor(config: BackendRepairClientConfig = {}) {
    const envBase =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
        ? (import.meta.env.VITE_API_BASE_URL as string)
        : "";

    this.baseUrl = (config.baseUrl ?? envBase).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.getOperatorToken =
      config.getOperatorToken ??
      (() => {
        if (typeof window === "undefined") return null;
        try {
          return window.sessionStorage.getItem("omnisight:operator-token");
        } catch {
          return null;
        }
      });
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

    if (options.requireAuth) {
      const token = this.getOperatorToken();
      if (token) {
        headers["X-Operator-Token"] = token;
      }
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
}

export const backendRepairClient = new BackendRepairClient();
