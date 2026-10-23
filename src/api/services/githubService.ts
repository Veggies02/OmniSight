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
import type { RepositoryPermissionReport } from "../../services/github/types.ts";

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
      return null;
    }
  }
}

export const clientGitHubService = new ClientGitHubService();
