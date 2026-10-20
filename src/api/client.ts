/**
 * Typed API Client for OmniSight Backend
 *
 * Implements typed HTTP communication matching backend/api.py:
 * - GET  /api/health
 * - GET  /api/jobs (with query params: status, limit, offset)
 * - POST /api/jobs
 * - GET  /api/jobs/{job_id}
 * - GET  /api/jobs/{job_id}/artifacts
 *
 * No external dependencies required (uses native fetch & TypeScript type guards).
 */

import type {
  BackendJobResponse,
  BackendJobListResponse,
  BackendArtifactRef,
  BackendJobStatus,
  JobCreateRequest,
} from "../types/contracts";
import { isBackendJobResponse } from "../types/dashboard";

export interface ApiClientConfig {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

export class ApiError extends Error {
  public status: number;
  public details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export class OmniSightApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl =
      config.baseUrl ||
      (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) ||
      "/api";
    this.defaultHeaders = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...config.defaultHeaders,
    };
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
    const headers = { ...this.defaultHeaders, ...(options.headers as Record<string, string>) };

    try {
      const response = await fetch(url, { ...options, headers });

      if (!response.ok) {
        let errorDetail: unknown;
        try {
          errorDetail = await response.json();
        } catch {
          errorDetail = await response.text();
        }
        throw new ApiError(
          `API request to ${endpoint} failed with HTTP ${response.status}`,
          response.status,
          errorDetail
        );
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        err instanceof Error ? err.message : "Network request failed",
        0,
        err
      );
    }
  }

  /**
   * GET /api/health
   */
  public async getHealth(): Promise<{ status: string }> {
    return this.request<{ status: string }>("health");
  }

  /**
   * GET /api/jobs
   */
  public async listJobs(params?: {
    status?: BackendJobStatus;
    limit?: number;
    offset?: number;
  }): Promise<BackendJobListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append("status", params.status);
    if (params?.limit !== undefined) searchParams.append("limit", params.limit.toString());
    if (params?.offset !== undefined) searchParams.append("offset", params.offset.toString());

    const qs = searchParams.toString();
    const endpoint = qs ? `jobs?${qs}` : "jobs";
    return this.request<BackendJobListResponse>(endpoint);
  }

  /**
   * GET /api/jobs/{job_id}
   */
  public async getJob(jobId: string): Promise<BackendJobResponse> {
    const cleanId = encodeURIComponent(jobId.replace(/^#/, ""));
    const data = await this.request<unknown>(`jobs/${cleanId}`);

    if (!isBackendJobResponse(data)) {
      throw new ApiError(`Invalid job response shape received for #${jobId}`, 500, data);
    }
    return data;
  }

  /**
   * GET /api/jobs/{job_id}/artifacts
   */
  public async getJobArtifacts(jobId: string): Promise<BackendArtifactRef[]> {
    const cleanId = encodeURIComponent(jobId.replace(/^#/, ""));
    return this.request<BackendArtifactRef[]>(`jobs/${cleanId}/artifacts`);
  }

  /**
   * POST /api/jobs
   */
  public async createJob(payload: JobCreateRequest): Promise<BackendJobResponse> {
    return this.request<BackendJobResponse>("jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

// Singleton default client instance
export const apiClient = new OmniSightApiClient();
