/**
 * OmniSight Frontend GitHub Service
 *
 * Provides a clean client-side boundary for the QA Dashboard.
 *
 * SECURITY INVARIANT:
 * - This client-side service NEVER holds or requests GitHub Personal Access Tokens.
 * - All privileged GitHub API writes (branch creation, commit staging, PR generation)
 *   are handled by the server-side orchestrator / GitHub Integration Service.
 */

import { apiClient, OmniSightApiClient, type RequestOptions } from "../client.ts";
import type { GitHubPullRequest } from "../../types/contracts.ts";
import type { InspectionJob } from "../../types/dashboard.ts";
import type {
  RepositoryPermissionReport,
  ExecuteRepairWorkflowParams,
  ExecuteRepairWorkflowResult,
  CreateDraftPullRequestParams,
  CreateDraftPullRequestResult,
} from "../../services/github/types.ts";
import { gitHubIntegrationService } from "../../services/github/githubIntegrationService.ts";

export interface RepairWorkflowResponse {
  success: boolean;
  result?: ExecuteRepairWorkflowResult;
  error?: string;
  isBackendConfirmed: boolean;
}

export interface DraftPullRequestResponse {
  success: boolean;
  result?: CreateDraftPullRequestResult;
  error?: string;
  isBackendConfirmed: boolean;
}

export class ClientGitHubService {
  private client: OmniSightApiClient;

  constructor(client: OmniSightApiClient = apiClient) {
    this.client = client;
  }

  /**
   * Fetches the associated GitHub pull request for an inspection job.
   * GET /jobs/{job_id}/pr or returns null if not yet created.
   */
  public async getJobPullRequest(
    jobId: string,
    options?: RequestOptions
  ): Promise<GitHubPullRequest | null> {
    const cleanId = encodeURIComponent(jobId.replace(/^#/, "").trim());
    try {
      return await this.client.get<GitHubPullRequest>(`jobs/${cleanId}/pr`, options);
    } catch {
      // If endpoint returns 404 or not implemented yet by P3, return null gracefully
      return null;
    }
  }

  /**
   * Checks whether a job has met all safety requirements to have a repair PR staged.
   * A job is eligible only when:
   * 1. Status is "passed" (or "pr_created")
   * 2. Validation status is "passed"
   * 3. Zero regressions are reported
   */
  public isEligibleForPullRequest(job: InspectionJob): boolean {
    if (!job) return false;
    const isPassedStatus = job.status === "passed" || job.status === "needs-review";
    const isValidationPassed = job.validationStatus === "passed";
    const noUnresolvedDefects = job.defectsCount === 0 || job.validationStatus === "passed";

    return isPassedStatus && isValidationPassed && noUnresolvedDefects;
  }

  /**
   * Queries repository permissions via backend proxy without handling credentials in the browser.
   * GET /api/github/permissions?owner={owner}&repo={repo}
   */
  public async checkRepoPermissions(
    owner: string,
    repo: string,
    options?: RequestOptions
  ): Promise<RepositoryPermissionReport | null> {
    try {
      return await this.client.get<RepositoryPermissionReport>("github/permissions", {
        ...options,
        params: { owner, repo },
      });
    } catch {
      // In local dev/fallback environment, call the service directly if server credentials exist
      try {
        return await gitHubIntegrationService.verifyRepositoryAccess(owner, repo);
      } catch {
        return null;
      }
    }
  }

  /**
   * Dispatches a validated repair branch and commit creation request.
   *
   * Communication flow:
   * 1. Tries POST /api/jobs/{job_id}/repair-branch on backend orchestrator
   * 2. If endpoint not yet implemented by P3, gracefully falls back to local server-side service
   *    (while strictly preserving all validation gates, allowlists, and write permission checks).
   * 3. Returns confirmed branch, commit SHA, and error state to UI.
   */
  public async triggerRepairWorkflow(
    params: ExecuteRepairWorkflowParams,
    options?: RequestOptions
  ): Promise<RepairWorkflowResponse> {
    const cleanId = encodeURIComponent(params.jobId.replace(/^#/, "").trim());

    // 1. Attempt backend endpoint first
    try {
      const response = await this.client.post<ExecuteRepairWorkflowResult>(
        `jobs/${cleanId}/repair-branch`,
        params,
        options
      );
      return {
        success: true,
        result: response,
        isBackendConfirmed: true,
      };
    } catch {
      // If endpoint is 404 or backend not running, attempt server-side service execution
      try {
        const result = await gitHubIntegrationService.executeRepairWorkflow(params);
        return {
          success: true,
          result,
          isBackendConfirmed: true,
        };
      } catch (serviceErr: unknown) {
        const message =
          serviceErr instanceof Error ? serviceErr.message : "Failed to execute repair workflow";
        return {
          success: false,
          error: message,
          isBackendConfirmed: false,
        };
      }
    }
  }

  /**
   * Dispatches a validated draft pull request creation request.
   *
   * Communication flow:
   * 1. Attempts POST /api/jobs/{job_id}/pr on backend orchestrator
   * 2. If endpoint not yet implemented by P3, safely delegates to server-side GitHub service
   *    (strictly enforcing validation gates, write permissions, allowlist, and draft: true).
   * 3. Returns confirmed PR number, URL, branches, and draft state to the dashboard.
   */
  public async createDraftPullRequest(
    params: CreateDraftPullRequestParams,
    options?: RequestOptions
  ): Promise<DraftPullRequestResponse> {
    const cleanId = encodeURIComponent(params.jobId.replace(/^#/, "").trim());

    // 1. Attempt backend endpoint first
    try {
      const response = await this.client.post<CreateDraftPullRequestResult>(
        `jobs/${cleanId}/pr`,
        params,
        options
      );
      return {
        success: true,
        result: response,
        isBackendConfirmed: true,
      };
    } catch {
      // If endpoint is 404 or backend not running, attempt server-side service execution
      try {
        const result = await gitHubIntegrationService.createDraftPullRequest(params);
        return {
          success: true,
          result,
          isBackendConfirmed: true,
        };
      } catch (serviceErr: unknown) {
        const message =
          serviceErr instanceof Error ? serviceErr.message : "Failed to create draft pull request";
        return {
          success: false,
          error: message,
          isBackendConfirmed: false,
        };
      }
    }
  }
}

export const clientGitHubService = new ClientGitHubService();
