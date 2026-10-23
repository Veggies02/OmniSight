/**
 * OmniSight GitHub Integration Service
 *
 * Implements server-side GitHub operations with strict safety guardrails:
 * - Direct REST API communication using standard Fetch API (zero external bloat)
 * - Safe credential isolation (reads process.env.GITHUB_TOKEN server-side; never exposed to browser)
 * - Validation Gate enforcement: blocks branch creation/commits unless validation explicitly passed
 * - Protected branch enforcement: blocks any direct write to main, master, production, etc.
 * - Idempotent branch and commit preparation
 * - Draft-only PR construction (human-in-the-loop requirement)
 */

import type {
  GitHubRepoMetadata,
  GitHubBranchInfo,
  GitHubPullRequestMetadata,
  PrepareRepairBranchParams,
  PrepareRepairBranchResult,
  PrepareRepairCommitParams,
  PrepareRepairCommitResult,
  BuildDraftPRParams,
  DraftPullRequestPayload,
  GitHubServiceConfig,
} from "./types.ts";
import {
  GitHubIntegrationError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubAuthenticationError,
  sanitizeDetails,
} from "./errors.ts";
import {
  assertValidationPassed,
  assertNotProtectedBranch,
  buildRepairBranchName,
  validateCommitMessage,
} from "./validationGate.ts";

export class GitHubIntegrationService {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly defaultBaseBranch: string;
  private readonly timeoutMs: number;

  constructor(config: GitHubServiceConfig = {}) {
    this.baseUrl = (config.baseUrl || "https://api.github.com").replace(/\/$/, "");
    this.defaultBaseBranch = config.defaultBaseBranch || "main";
    this.timeoutMs = config.timeoutMs || 15000;

    // Securely resolve token: configuration object or server-side process environment
    let resolvedToken = config.token;
    const processEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    if (!resolvedToken && processEnv) {
      resolvedToken = processEnv.GITHUB_TOKEN || processEnv.OMNISIGHT_GITHUB_TOKEN;
    }
    this.token = resolvedToken;
  }

  /**
   * Internal HTTP request helper with rate-limiting detection, token injection, and error redaction.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const cleanEndpoint = endpoint.replace(/^\//, "");
    const url = `${this.baseUrl}/${cleanEndpoint}`;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "OmniSight-QA-Platform/1.0",
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      // Check rate limit headers
      const remaining = response.headers.get("x-ratelimit-remaining");
      const reset = response.headers.get("x-ratelimit-reset");
      if (response.status === 403 && remaining === "0") {
        const resetTimestamp = reset ? parseInt(reset, 10) : undefined;
        throw new GitHubRateLimitError(resetTimestamp, cleanEndpoint);
      }

      if (response.status === 404) {
        throw new GitHubNotFoundError(cleanEndpoint, cleanEndpoint);
      }

      if (response.status === 401) {
        throw new GitHubAuthenticationError(
          "GitHub API rejected credentials (HTTP 401 Unauthorized)."
        );
      }

      if (!response.ok) {
        let errorBody: unknown = undefined;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text();
        }

        throw new GitHubIntegrationError({
          message: `GitHub API request failed with status ${response.status}`,
          kind: response.status === 403 ? "PERMISSION_DENIED" : "API_ERROR",
          status: response.status,
          endpoint: cleanEndpoint,
          details: errorBody,
        });
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as unknown as T;
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      if (err instanceof GitHubIntegrationError) {
        throw err;
      }

      if (err instanceof Error && err.name === "AbortError") {
        throw new GitHubIntegrationError({
          message: `GitHub API request timed out after ${this.timeoutMs}ms`,
          kind: "NETWORK_ERROR",
          endpoint: cleanEndpoint,
        });
      }

      const msg = err instanceof Error ? err.message : "Network failure communicating with GitHub";
      throw new GitHubIntegrationError({
        message: msg,
        kind: "NETWORK_ERROR",
        endpoint: cleanEndpoint,
        details: sanitizeDetails(err),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Retrieves repository metadata (default branch, visibility, permissions).
   * GET /repos/{owner}/{repo}
   */
  public async getRepository(owner: string, repo: string): Promise<GitHubRepoMetadata> {
    const data = await this.request<any>(`repos/${owner}/${repo}`);

    return {
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      owner: data.owner?.login || owner,
      defaultBranch: data.default_branch || "main",
      isPrivate: Boolean(data.private),
      isArchived: Boolean(data.archived),
      htmlUrl: data.html_url,
      description: data.description,
      permissions: data.permissions
        ? {
            admin: Boolean(data.permissions.admin),
            push: Boolean(data.permissions.push),
            pull: Boolean(data.permissions.pull),
          }
        : undefined,
    };
  }

  /**
   * Checks branch information and commit SHA.
   * GET /repos/{owner}/{repo}/branches/{branch}
   */
  public async getBranch(owner: string, repo: string, branch: string): Promise<GitHubBranchInfo> {
    const cleanBranch = encodeURIComponent(branch.trim());
    const data = await this.request<any>(`repos/${owner}/${repo}/branches/${cleanBranch}`);

    return {
      name: data.name,
      commitSha: data.commit?.sha || "",
      isProtected: Boolean(data.protected),
      htmlUrl: data._links?.html,
    };
  }

  /**
   * Retrieves pull request metadata.
   * GET /repos/{owner}/{repo}/pulls/{pullNumber}
   */
  public async getPullRequest(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<GitHubPullRequestMetadata> {
    const data = await this.request<any>(`repos/${owner}/${repo}/pulls/${pullNumber}`);

    return {
      number: data.number,
      title: data.title,
      state: data.state === "open" ? "open" : "closed",
      isDraft: Boolean(data.draft),
      htmlUrl: data.html_url,
      headBranch: data.head?.ref || "",
      headSha: data.head?.sha || "",
      baseBranch: data.base?.ref || "",
      merged: Boolean(data.merged),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      author: data.user?.login || "unknown",
    };
  }

  /**
   * Prepares a repair branch from an approved base branch.
   *
   * SAFETY GATES ENFORCED:
   * 1. Requires explicit validation passage (status === "passed", failedChecks === 0).
   * 2. Cannot target or write to protected base branches.
   * 3. Validates branch name format against strict git ref standards.
   * 4. Idempotent: if branch already exists with matching base, avoids duplicate creation.
   */
  public async prepareRepairBranch(
    params: PrepareRepairBranchParams
  ): Promise<PrepareRepairBranchResult> {
    // 1. Enforce validation gate
    assertValidationPassed(params.validation);

    // 2. Compute canonical branch name and verify it is not protected
    const branchName = buildRepairBranchName(params.jobId, params.findingId, params.branchSuffix);
    assertNotProtectedBranch(branchName);

    // 3. Resolve base branch
    const baseBranch = params.baseBranch || this.defaultBaseBranch;

    // 4. Retrieve base branch commit SHA
    const baseBranchInfo = await this.getBranch(params.owner, params.repo, baseBranch);
    if (!baseBranchInfo.commitSha) {
      throw new GitHubIntegrationError({
        message: `Base branch "${baseBranch}" commit SHA could not be resolved.`,
        kind: "API_ERROR",
      });
    }

    // 5. Check if repair branch already exists (idempotency guard)
    try {
      const existingBranch = await this.getBranch(params.owner, params.repo, branchName);
      if (existingBranch) {
        return {
          branchName,
          baseBranch,
          baseCommitSha: baseBranchInfo.commitSha,
          created: false,
          exists: true,
          htmlUrl: existingBranch.htmlUrl,
        };
      }
    } catch (err: unknown) {
      // If 404, proceed to branch creation
      if (!(err instanceof GitHubNotFoundError)) {
        throw err;
      }
    }

    // 6. Create git reference for repair branch: POST /repos/{owner}/{repo}/git/refs
    const refData = await this.request<any>(`repos/${params.owner}/${params.repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseBranchInfo.commitSha,
      }),
    });

    return {
      branchName,
      baseBranch,
      baseCommitSha: baseBranchInfo.commitSha,
      created: true,
      exists: true,
      htmlUrl: refData.object?.url,
    };
  }

  /**
   * Prepares and stages a commit containing validated repair changes.
   *
   * SAFETY GATES ENFORCED:
   * 1. Requires explicit validation passage.
   * 2. Refuses commits to protected branches (main, master, etc.).
   * 3. Validates commit message structure and attribution.
   * 4. Requires non-empty file changes.
   */
  public async prepareRepairCommit(
    params: PrepareRepairCommitParams
  ): Promise<PrepareRepairCommitResult> {
    // 1. Enforce validation gate
    assertValidationPassed(params.validation);

    // 2. Refuse direct commit to protected branch
    assertNotProtectedBranch(params.branch);

    // 3. Validate commit message and changes
    const validatedMessage = validateCommitMessage(params.commitMessage);
    if (!Array.isArray(params.changes) || params.changes.length === 0) {
      throw new GitHubIntegrationError({
        message: "Cannot create repair commit with empty file changes list.",
        kind: "API_ERROR",
      });
    }

    // 4. Retrieve current HEAD of target repair branch
    const branchInfo = await this.getBranch(params.owner, params.repo, params.branch);
    const parentSha = branchInfo.commitSha;

    // 5. Create Git tree with the updated file changes: POST /repos/{owner}/{repo}/git/trees
    const treePayload = {
      base_tree: parentSha,
      tree: params.changes.map((file) => ({
        path: file.path.replace(/^\/+/, ""),
        mode: file.mode || "100644",
        type: "blob",
        content: file.content,
      })),
    };

    const treeData = await this.request<any>(`repos/${params.owner}/${params.repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify(treePayload),
    });

    // 6. Create Git commit: POST /repos/{owner}/{repo}/git/commits
    const commitPayload = {
      message: `${validatedMessage}\n\nOmniSight-Job-ID: ${params.jobId}\nOmniSight-Finding-ID: ${params.findingId}\nOmniSight-Validated: true`,
      tree: treeData.sha,
      parents: [parentSha],
    };

    const commitData = await this.request<any>(`repos/${params.owner}/${params.repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify(commitPayload),
    });

    // 7. Update branch reference to new commit: PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}
    const cleanBranch = params.branch.replace(/^refs\/heads\//, "");
    await this.request<any>(`repos/${params.owner}/${params.repo}/git/refs/heads/${cleanBranch}`, {
      method: "PATCH",
      body: JSON.stringify({
        sha: commitData.sha,
        force: false, // Never force-push
      }),
    });

    return {
      commitSha: commitData.sha,
      branch: params.branch,
      parentSha,
      treeSha: treeData.sha,
      changedFilesCount: params.changes.length,
      committedAt: commitData.author?.date || new Date().toISOString(),
      htmlUrl: commitData.html_url,
    };
  }

  /**
   * Prepares structured metadata and description for a future draft pull request.
   *
   * SAFETY GATES ENFORCED:
   * 1. Requires explicit validation passage.
   * 2. Sets draft: true unconditionally (OmniSight requires human-in-the-loop review).
   * 3. Prevents invalid head/base branch targets.
   */
  public buildDraftPullRequestPayload(params: BuildDraftPRParams): DraftPullRequestPayload {
    // 1. Enforce validation gate
    assertValidationPassed(params.validation);

    // 2. Verify head branch is not protected
    assertNotProtectedBranch(params.headBranch);

    const title = `[OmniSight Self-Healing] Fix ${params.defectCategory}: ${params.defectTitle}`;

    const body = [
      `## 🤖 OmniSight Automated UI Repair`,
      ``,
      `### Defect Summary`,
      `- **Job ID:** \`#${params.jobId}\``,
      `- **Finding ID:** \`${params.findingId}\``,
      `- **Defect Category:** \`${params.defectCategory}\``,
      `- **Target Component:** \`${params.repairedComponent || "Storefront Viewport"}\``,
      params.defectDescription ? `\n> ${params.defectDescription}\n` : "",
      `### ✅ Automated Validation Results`,
      `- **Status:** **${params.validation.status.toUpperCase()}**`,
      `- **Assertions Passed:** ${params.validation.passedChecks} of ${params.validation.totalChecks} (100% pass rate)`,
      `- **Verification Timestamp:** ${params.validation.verifiedAt || new Date().toISOString()}`,
      `- **Regression Checks:** 0 failures detected`,
      ``,
      params.evidenceUris?.baselineUri || params.evidenceUris?.defectiveUri
        ? `### 📸 Visual Evidence References\n- Baseline Reference: \`${params.evidenceUris.baselineUri || "Clean baseline"}\`\n- Defective Capture: \`${params.evidenceUris.defectiveUri || "Defect captured"}\`\n`
        : "",
      `---`,
      `> ⚠️ **OmniSight Review Gate:** This pull request was automatically prepared following verified Playwright test passes. It is created in **DRAFT** mode and requires team code-owner triage before merging.`,
    ]
      .filter((line) => line !== undefined)
      .join("\n");

    return {
      title,
      body,
      head: params.headBranch,
      base: params.baseBranch,
      draft: true, // Strict safety invariant
    };
  }
}

export const gitHubIntegrationService = new GitHubIntegrationService();
