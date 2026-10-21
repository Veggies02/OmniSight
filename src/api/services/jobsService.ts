/**
 * OmniSight Jobs Service
 *
 * Implements confirmed backend operations for inspection jobs:
 * - GET  /jobs (list jobs with status, limit, offset filters)
 * - GET  /jobs/{job_id} (fetch job details, inspection summary & artifacts)
 * - POST /jobs (trigger a new manual inspection run)
 * - GET  /health (backend health status check)
 */

import { apiClient, OmniSightApiClient, type RequestOptions } from "../client.ts";
import type {
  BackendJobResponse,
  BackendJobListResponse,
  BackendJobStatus,
  JobCreateRequest,
} from "../../types/contracts.ts";
import { isBackendJobResponse } from "../../types/dashboard.ts";
import { ApiError } from "../client.ts";

export class JobsService {
  private client: OmniSightApiClient;

  constructor(client: OmniSightApiClient = apiClient) {
    this.client = client;
  }

  /**
   * Checks backend health
   * GET /health
   */
  public async getHealth(options?: RequestOptions): Promise<{ status: string }> {
    return this.client.get<{ status: string }>("health", options);
  }

  /**
   * Retrieves a paginated list of inspection jobs
   * GET /jobs?status=...&limit=...&offset=...
   */
  public async listJobs(
    params?: {
      status?: BackendJobStatus;
      limit?: number;
      offset?: number;
    },
    options?: RequestOptions
  ): Promise<BackendJobListResponse> {
    return this.client.get<BackendJobListResponse>("jobs", {
      ...options,
      params: {
        status: params?.status,
        limit: params?.limit,
        offset: params?.offset,
      },
    });
  }

  /**
   * Fetches details of a specific inspection job
   * GET /jobs/{job_id}
   */
  public async getJob(jobId: string, options?: RequestOptions): Promise<BackendJobResponse> {
    const cleanId = encodeURIComponent(jobId.replace(/^#/, "").trim());
    const data = await this.client.get<unknown>(`jobs/${cleanId}`, options);

    if (!isBackendJobResponse(data)) {
      throw new ApiError({
        message: `Backend returned invalid job response structure for #${jobId}`,
        kind: "VALIDATION_ERROR",
        endpoint: `jobs/${cleanId}`,
        details: data,
      });
    }

    return data;
  }

  /**
   * Submits a new inspection job request
   * POST /jobs
   */
  public async createJob(
    payload: JobCreateRequest,
    options?: RequestOptions
  ): Promise<BackendJobResponse> {
    const data = await this.client.post<unknown>("jobs", payload, options);

    if (!isBackendJobResponse(data)) {
      throw new ApiError({
        message: "Backend returned invalid job creation response structure",
        kind: "VALIDATION_ERROR",
        endpoint: "jobs",
        details: data,
      });
    }

    return data;
  }
}

export const jobsService = new JobsService();
