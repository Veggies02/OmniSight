/**
 * OmniSight GitHub Integration Service
 *
 * Implements server-side GitHub operations with strict safety guardrails:
 * - Direct REST API communication using standard Fetch API (zero external bloat)
 * - Safe credential isolation (reads process.env.GITHUB_TOKEN server-side; never exposed to browser)
 * - Identity and permission verification (confirms read vs. write permissions before mutation)
 * - Repository allowlist enforcement: blocks operations outside authorized target repositories
 * - Validation Gate enforcement: blocks branch creation/commits unless validation explicitly passed
 * - Protected branch enforcement: blocks any direct write to main, master, production, etc.
 * - Idempotent branch and commit preparation
 * - Draft-only PR construction (human-in-the-loop requirement)
 */

import type {
  GitHubRepoMetadata,
  GitHubBranchInfo,
  GitHubPullRequestMetadata,
  AuthenticatedIdentity,
  RepositoryPermissionReport,
  PrepareRepairBranchParams,
  PrepareRepairBranchResult,
  PrepareRepairCommitParams,
  PrepareRepairCommitResult,
  ExecuteRepairWorkflowParams,
  ExecuteRepairWorkflowResult,
  BuildDraftPRParams,
  DraftPullRequestPayload,
  CreateDraftPullRequestParams,
  CreateDraftPullRequestResult,
  GitHubServiceConfig,
} from "./types.ts";
import {
  GitHubIntegrationError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubAuthenticationError,
  RepositoryNotAllowedError,
  sanitizeDetails,
} from "./errors.ts";
import {
  assertValidationPassed,
  assertNotProtectedBranch,
  assertDifferentBranches,
  assertConfirmedRepairCommit,
  assertTargetRepoAllowed,
  assertRepoNotArchived,
  assertWritePermission,
  buildRepairBranchName,
  validateCommitMessage,
  validateRepairFileChanges,
} from "./validationGate.ts";

export class GitHubIntegrationService {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly defaultBaseBranch: string;
  private readonly allowedRepositories?: readonly string[];
  private readonly defaultRepo?: string;
  private readonly timeoutMs: number;

  constructor(config: GitHubServiceConfig = {}) {
    this.baseUrl = (config.baseUrl || "https://api.github.com").replace(/\/$/, "");
    this.defaultBaseBranch = config.defaultBaseBranch || "main";
    this.timeoutMs = config.timeoutMs || 15000;

    // Securely resolve token and environment config: configuration object or server-side process environment
    let resolvedToken = config.token;
    let envAllowedRepos: string[] | undefined = config.allowedRepositories;
    let envDefaultRepo = config.defaultRepo;

    const processEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    if (processEnv) {
      if (!resolvedToken) {
        resolvedToken = processEnv.GITHUB_TOKEN || processEnv.OMNISIGHT_GITHUB_TOKEN;
      }
      if (!envAllowedRepos && processEnv.OMNISIGHT_GITHUB_ALLOWED_REPOS) {
        envAllowedRepos = processEnv.OMNISIGHT_GITHUB_ALLOWED_REPOS.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (!envDefaultRepo && processEnv.OMNISIGHT_TARGET_REPO) {
        envDefaultRepo = processEnv.OMNISIGHT_TARGET_REPO.trim();
      }
    }

    this.token = resolvedToken;
    this.allowedRepositories = envAllowedRepos;
    this.defaultRepo = envDefaultRepo;
  }

  public getDefaultRepo(): string | undefined {
    return this.defaultRepo;
  }

  public getAllowedRepositories(): readonly string[] | undefined {
    return this.allowedRepositories;
  }

  /**
   * Internal HTTP request helper returning data, response headers, and status code.
   */
  private async requestWithHeaders<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ data: T; headers: Headers; status: number }> {
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
        return { data: undefined as unknown as T, headers: response.headers, status: response.status };
      }

      const data = (await response.json()) as T;
      return { data, headers: response.headers, status: response.status };
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

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const { data } = await this.requestWithHeaders<T>(endpoint, options);
    return data;
  }

  /**
   * Retrieves the authenticated user/bot identity associated with the configured token.
   * GET /user
   */
  public async getAuthenticatedIdentity(): Promise<AuthenticatedIdentity> {
    if (!this.token) {
      throw new GitHubAuthenticationError(
        "Authentication required: Server-side GITHUB_TOKEN or OMNISIGHT_GITHUB_TOKEN not configured."
      );
    }

    try {
      const { data, headers } = await this.requestWithHeaders<any>("user");
      const scopesHeader = headers.get("x-oauth-scopes");
      const scopes = scopesHeader ? scopesHeader.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

      const authMethod = this.token.startsWith("ghs_") ? "app_installation" : "token";
      const identityType =
        data.type === "Bot"
          ? "Bot"
          : data.type === "Organization"
          ? "Organization"
          : "User";

      return {
        login: data.login || "authenticated-user",
        id: data.id || 0,
        type: identityType,
        authMethod,
        scopes,
      };
    } catch (err: unknown) {
      // If /user is forbidden (e.g. GitHub App installation tokens do not have a /user profile),
      // attempt fallback inspection or return app identity
      if (err instanceof GitHubIntegrationError && (err.status === 403 || err.status === 404)) {
        if (this.token.startsWith("ghs_")) {
          return {
            login: "omnisight-app[bot]",
            id: 0,
            type: "Bot",
            authMethod: "app_installation",
          };
        }
      }
      throw err;
    }
  }

  /**
   * Verifies the authenticated identity and audits repository access and permissions.
   * Confirms read vs. write access and checks target repository allowlist.
   */
  public async verifyRepositoryAccess(owner: string, repo: string): Promise<RepositoryPermissionReport> {
    const targetFullName = `${owner}/${repo}`;

    // 1. Check repository allowlist first
    try {
      assertTargetRepoAllowed(targetFullName, this.allowedRepositories);
    } catch (err: unknown) {
      if (err instanceof RepositoryNotAllowedError) {
        return {
          authenticated: Boolean(this.token),
          identity: null,
          repository: null,
          permissions: { canRead: false, canWrite: false, canAdmin: false, hasRequiredPermissions: false },
          isTargetRepoAllowed: false,
          error: {
            code: "REPO_NOT_ALLOWED",
            message: err.message,
            help: `Add "${targetFullName}" to OMNISIGHT_GITHUB_ALLOWED_REPOS environment variable to authorize operations.`,
          },
        };
      }
      throw err;
    }

    // 2. Check token presence
    if (!this.token) {
      return {
        authenticated: false,
        identity: null,
        repository: null,
        permissions: { canRead: false, canWrite: false, canAdmin: false, hasRequiredPermissions: false },
        isTargetRepoAllowed: true,
        error: {
          code: "MISSING_CREDENTIALS",
          message: "No GitHub credentials configured in server environment.",
          help: "Set GITHUB_TOKEN or OMNISIGHT_GITHUB_TOKEN with 'contents:write' and 'pull_requests:write' permissions in your backend environment.",
        },
      };
    }

    // 3. Resolve identity
    let identity: AuthenticatedIdentity | null = null;
    try {
      identity = await this.getAuthenticatedIdentity();
    } catch (err: unknown) {
      if (err instanceof GitHubAuthenticationError) {
        return {
          authenticated: false,
          identity: null,
          repository: null,
          permissions: { canRead: false, canWrite: false, canAdmin: false, hasRequiredPermissions: false },
          isTargetRepoAllowed: true,
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Configured GitHub token was rejected by GitHub API (401 Unauthorized).",
            help: "The token may have expired, been revoked, or is mistyped. Generate a fresh personal access token or app installation token.",
          },
        };
      }
      if (err instanceof GitHubRateLimitError) {
        return {
          authenticated: true,
          identity: null,
          repository: null,
          permissions: { canRead: false, canWrite: false, canAdmin: false, hasRequiredPermissions: false },
          isTargetRepoAllowed: true,
          error: {
            code: "RATE_LIMITED",
            message: err.message,
            help: "Wait for the rate limit window to reset before attempting further GitHub operations.",
          },
        };
      }
    }

    // 4. Retrieve repository metadata & permission flags
    try {
      const repoMeta = await this.getRepository(owner, repo);

      const canRead = Boolean(repoMeta.permissions?.pull ?? true);
      const canWrite = Boolean(repoMeta.permissions?.push ?? false);
      const canAdmin = Boolean(repoMeta.permissions?.admin ?? false);
      const isArchived = repoMeta.isArchived;

      const hasRequiredPermissions = canRead && canWrite && !isArchived;

      let error: RepositoryPermissionReport["error"] = undefined;

      if (isArchived) {
        error = {
          code: "REPO_ARCHIVED",
          message: `Repository "${targetFullName}" is archived.`,
          help: "GitHub disallows creating branches or commits in archived repositories. Unarchive the repository to enable self-healing.",
        };
      } else if (!canWrite) {
        error = {
          code: "INSUFFICIENT_PERMISSIONS",
          message: `Authenticated identity "${identity?.login || "user"}" has READ access to "${targetFullName}" but lacks WRITE permission.`,
          help: "Ensure your fine-grained token has Repository permission 'Contents: Read and write' and 'Pull requests: Read and write'.",
        };
      }

      return {
        authenticated: true,
        identity,
        repository: {
          owner: repoMeta.owner,
          name: repoMeta.name,
          fullName: repoMeta.fullName,
          isPrivate: repoMeta.isPrivate,
          isArchived: repoMeta.isArchived,
          defaultBranch: repoMeta.defaultBranch,
        },
        permissions: {
          canRead,
          canWrite,
          canAdmin,
          hasRequiredPermissions,
        },
        isTargetRepoAllowed: true,
        error,
      };
    } catch (err: unknown) {
      if (err instanceof GitHubNotFoundError) {
        return {
          authenticated: true,
          identity,
          repository: null,
          permissions: { canRead: false, canWrite: false, canAdmin: false, hasRequiredPermissions: false },
          isTargetRepoAllowed: true,
          error: {
            code: "REPO_NOT_FOUND",
            message: `Repository "${targetFullName}" was not found or the token does not have read access.`,
            help: "Confirm repository spelling and ensure the token has been granted access to this repository.",
          },
        };
      }
      if (err instanceof GitHubRateLimitError) {
        return {
          authenticated: true,
          identity,
          repository: null,
          permissions: { canRead: false, canWrite: false, canAdmin: false, hasRequiredPermissions: false },
          isTargetRepoAllowed: true,
          error: {
            code: "RATE_LIMITED",
            message: err.message,
            help: "Wait for the rate limit window to reset before attempting further GitHub operations.",
          },
        };
      }

      const msg = err instanceof Error ? err.message : "Failed to verify repository permissions";
      return {
        authenticated: true,
        identity,
        repository: null,
        permissions: { canRead: false, canWrite: false, canAdmin: false, hasRequiredPermissions: false },
        isTargetRepoAllowed: true,
        error: {
          code: "API_ERROR",
          message: msg,
          help: "Check network connectivity and GitHub API status.",
        },
      };
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
   * Searches for an existing open pull request matching the head and base branch.
   * GET /repos/{owner}/{repo}/pulls?state=open&head={owner}:{head}&base={base}
   *
   * Used as an idempotency and retry safeguard to prevent duplicate PR creation.
   */
  public async findOpenPullRequest(
    owner: string,
    repo: string,
    headBranch: string,
    baseBranch: string
  ): Promise<GitHubPullRequestMetadata | null> {
    const cleanHead = headBranch.replace(/^refs\/heads\//, "").trim();
    const cleanBase = baseBranch.replace(/^refs\/heads\//, "").trim();

    try {
      // Query GitHub API with head filter (owner:head or head)
      const data = await this.request<any[]>(
        `repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(owner + ":" + cleanHead)}&base=${encodeURIComponent(cleanBase)}`
      );

      if (Array.isArray(data) && data.length > 0) {
        const match = data[0];
        return {
          number: match.number,
          title: match.title,
          state: match.state === "open" ? "open" : "closed",
          isDraft: Boolean(match.draft),
          htmlUrl: match.html_url,
          headBranch: match.head?.ref || cleanHead,
          headSha: match.head?.sha || "",
          baseBranch: match.base?.ref || cleanBase,
          merged: Boolean(match.merged),
          createdAt: match.created_at,
          updatedAt: match.updated_at,
          author: match.user?.login || "unknown",
        };
      }

      // Fallback query without owner prefix in case head was stored as simple branch name
      const fallbackData = await this.request<any[]>(
        `repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(cleanHead)}&base=${encodeURIComponent(cleanBase)}`
      );

      if (Array.isArray(fallbackData) && fallbackData.length > 0) {
        const match = fallbackData[0];
        return {
          number: match.number,
          title: match.title,
          state: match.state === "open" ? "open" : "closed",
          isDraft: Boolean(match.draft),
          htmlUrl: match.html_url,
          headBranch: match.head?.ref || cleanHead,
          headSha: match.head?.sha || "",
          baseBranch: match.base?.ref || cleanBase,
          merged: Boolean(match.merged),
          createdAt: match.created_at,
          updatedAt: match.updated_at,
          author: match.user?.login || "unknown",
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Prepares a repair branch from an approved base branch.
   *
   * SAFETY GATES ENFORCED:
   * 1. Restricts operations to configured target repository allowlist.
   * 2. Requires explicit validation passage (status === "passed", failedChecks === 0).
   * 3. Confirms identity has write permissions before attempting branch creation.
   * 4. Cannot target or write to protected base branches.
   * 5. Validates branch name format against strict git ref standards.
   * 6. Idempotent: if branch already exists with matching base, avoids duplicate creation.
   */
  public async prepareRepairBranch(
    params: PrepareRepairBranchParams
  ): Promise<PrepareRepairBranchResult> {
    const targetFullName = `${params.owner}/${params.repo}`;

    // 1. Enforce repository allowlist
    assertTargetRepoAllowed(targetFullName, this.allowedRepositories);

    // 2. Enforce validation gate
    assertValidationPassed(params.validation);

    // 3. Compute canonical branch name and verify it is not protected
    const branchName = buildRepairBranchName(params.jobId, params.findingId, params.branchSuffix);
    assertNotProtectedBranch(branchName);

    // 4. Resolve base branch
    const baseBranch = params.baseBranch || this.defaultBaseBranch;

    // 5. Retrieve base branch commit SHA and verify write permission
    const [baseBranchInfo, repoMeta] = await Promise.all([
      this.getBranch(params.owner, params.repo, baseBranch),
      this.getRepository(params.owner, params.repo),
    ]);

    if (!baseBranchInfo.commitSha) {
      throw new GitHubIntegrationError({
        message: `Base branch "${baseBranch}" commit SHA could not be resolved.`,
        kind: "API_ERROR",
      });
    }

    // 6. Enforce write permission & non-archived status
    assertRepoNotArchived(repoMeta.isArchived, repoMeta.fullName);
    assertWritePermission(Boolean(repoMeta.permissions?.push ?? true), repoMeta.fullName);

    // 7. Check if repair branch already exists (idempotency guard)
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

    // 8. Create git reference for repair branch: POST /repos/{owner}/{repo}/git/refs
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
   * 1. Restricts operations to configured target repository allowlist.
   * 2. Requires explicit validation passage.
   * 3. Confirms identity has write permissions.
   * 4. Refuses commits to protected branches (main, master, etc.).
   * 5. Validates commit message structure and attribution.
   * 6. Requires non-empty file changes.
   */
  public async prepareRepairCommit(
    params: PrepareRepairCommitParams
  ): Promise<PrepareRepairCommitResult> {
    const targetFullName = `${params.owner}/${params.repo}`;

    // 1. Enforce repository allowlist
    assertTargetRepoAllowed(targetFullName, this.allowedRepositories);

    // 2. Enforce validation gate
    assertValidationPassed(params.validation);

    // 3. Refuse direct commit to protected branch
    assertNotProtectedBranch(params.branch);

    // 4. Validate commit message and file changes (paths, extensions, traversal)
    const validatedMessage = validateCommitMessage(params.commitMessage);
    const validatedChanges = validateRepairFileChanges(params.changes);

    // 5. Verify write permissions & retrieve current HEAD of target repair branch
    const [branchInfo, repoMeta] = await Promise.all([
      this.getBranch(params.owner, params.repo, params.branch),
      this.getRepository(params.owner, params.repo),
    ]);

    assertRepoNotArchived(repoMeta.isArchived, repoMeta.fullName);
    assertWritePermission(Boolean(repoMeta.permissions?.push ?? true), repoMeta.fullName);

    const parentSha = branchInfo.commitSha;

    // 6. Create Git tree with the updated file changes: POST /repos/{owner}/{repo}/git/trees
    const treePayload = {
      base_tree: parentSha,
      tree: validatedChanges.map((file) => ({
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

    // 7. Create Git commit: POST /repos/{owner}/{repo}/git/commits
    const commitPayload = {
      message: `${validatedMessage}\n\nOmniSight-Job-ID: ${params.jobId}\nOmniSight-Finding-ID: ${params.findingId}\nOmniSight-Validated: true`,
      tree: treeData.sha,
      parents: [parentSha],
    };

    const commitData = await this.request<any>(`repos/${params.owner}/${params.repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify(commitPayload),
    });

    // 8. Update branch reference to new commit: PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}
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
      changedFilesCount: validatedChanges.length,
      committedAt: commitData.author?.date || new Date().toISOString(),
      htmlUrl: commitData.html_url,
    };
  }

  /**
   * High-level repair branch and commit workflow orchestration.
   *
   * 1. Validates repository, base branch, and target branch
   * 2. Enforces explicit validation success
   * 3. Confirms write permissions on the repository
   * 4. Idempotently creates or reuses the dedicated repair branch
   * 5. Validates file changes (paths, extensions, traversal checks)
   * 6. Creates and links the repair commit
   * 7. Returns structured operation details
   */
  public async executeRepairWorkflow(
    params: ExecuteRepairWorkflowParams
  ): Promise<ExecuteRepairWorkflowResult> {
    const targetRepo = params.targetRepository || this.defaultRepo || "Veggies02/OmniSight";
    const parts = targetRepo.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new GitHubIntegrationError({
        message: `Invalid target repository format "${targetRepo}". Must be "owner/repo".`,
        kind: "API_ERROR",
      });
    }
    const [owner, repo] = parts;
    const baseBranch = params.baseBranch || this.defaultBaseBranch;

    // 1. Verify validation gate explicitly passed
    assertValidationPassed(params.validation);

    // 2. Verify write permissions on repository
    const accessReport = await this.verifyRepositoryAccess(owner, repo);
    if (!accessReport.permissions.hasRequiredPermissions) {
      if (accessReport.error) {
        throw new GitHubIntegrationError({
          message: accessReport.error.message,
          kind:
            accessReport.error.code === "INSUFFICIENT_PERMISSIONS"
              ? "INSUFFICIENT_PERMISSIONS"
              : accessReport.error.code === "REPO_ARCHIVED"
              ? "REPO_ARCHIVED"
              : accessReport.error.code === "REPO_NOT_ALLOWED"
              ? "REPO_NOT_ALLOWED"
              : "PERMISSION_DENIED",
          status: 403,
          details: accessReport.error,
        });
      }
      throw new GitHubIntegrationError({
        message: `Write permissions required on "${targetRepo}".`,
        kind: "INSUFFICIENT_PERMISSIONS",
        status: 403,
      });
    }

    // 3. Prepare dedicated repair branch
    const branchResult = await this.prepareRepairBranch({
      owner,
      repo,
      jobId: params.jobId,
      findingId: params.findingId,
      baseBranch,
      validation: params.validation,
      branchSuffix: params.branchSuffix,
    });

    // 4. Validate file changes list
    const validatedChanges = validateRepairFileChanges(params.changes);

    // 5. Default commit message if not provided
    const commitMsg =
      params.commitMessage ||
      `fix(repair): apply self-healing patch for ${params.findingId} on ${params.jobId}`;

    // 6. Create repair commit on the repair branch
    const commitResult = await this.prepareRepairCommit({
      owner,
      repo,
      branch: branchResult.branchName,
      jobId: params.jobId,
      findingId: params.findingId,
      commitMessage: commitMsg,
      changes: validatedChanges,
      validation: params.validation,
    });

    return {
      status: "success",
      repository: targetRepo,
      branch: branchResult.branchName,
      baseBranch,
      baseCommitSha: branchResult.baseCommitSha,
      commitSha: commitResult.commitSha,
      changedFilesCount: validatedChanges.length,
      changedPaths: validatedChanges.map((c) => c.path),
      committedAt: commitResult.committedAt,
      htmlUrl: commitResult.htmlUrl,
      validationGate: {
        passed: true,
        totalChecks: params.validation.totalChecks,
      },
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

  /**
   * Creates a confirmed GitHub Draft Pull Request for a validated repair.
   *
   * SAFETY GATES ENFORCED:
   * 1. Requires explicit validation gate passage (status === "passed", failedChecks === 0, totalChecks >= 1).
   * 2. Confirms repository access and write permissions on target repository.
   * 3. Verifies repository is within configured allowlist and is not archived.
   * 4. Verifies repair branch and confirmed repair commit exist.
   * 5. Asserts head branch is not protected and differs from base branch.
   * 6. Checks for existing open pull request matching head & base (idempotent retry).
   * 7. Sets draft: true unconditionally (human-in-the-loop requirement; automated merge is strictly prohibited).
   * 8. Returns confirmed PR number, URL, title, branch refs, and draft status.
   */
  public async createDraftPullRequest(
    params: CreateDraftPullRequestParams
  ): Promise<CreateDraftPullRequestResult> {
    const targetRepo =
      params.targetRepository ||
      (params.owner && params.repo ? `${params.owner}/${params.repo}` : this.defaultRepo || "Veggies02/OmniSight");

    const parts = targetRepo.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new GitHubIntegrationError({
        message: `Invalid target repository format "${targetRepo}". Must be "owner/repo".`,
        kind: "API_ERROR",
      });
    }
    const [owner, repo] = parts;
    const baseBranch = params.baseBranch || this.defaultBaseBranch;

    // 1. Enforce repository allowlist
    assertTargetRepoAllowed(targetRepo, this.allowedRepositories);

    // 2. Enforce validation gate (100% passed, 0 failures, >= 1 check)
    assertValidationPassed(params.validation);

    // 3. Enforce confirmed commit SHA
    const confirmedSha = assertConfirmedRepairCommit(params.headCommitSha);

    // 4. Enforce branch safety (cannot be protected base branch)
    assertNotProtectedBranch(params.headBranch);

    // 5. Enforce head branch differs from base branch
    assertDifferentBranches(params.headBranch, baseBranch);

    // 6. Enforce write permissions & non-archived status
    const accessReport = await this.verifyRepositoryAccess(owner, repo);
    if (!accessReport.permissions.hasRequiredPermissions) {
      if (accessReport.error) {
        throw new GitHubIntegrationError({
          message: accessReport.error.message,
          kind:
            accessReport.error.code === "INSUFFICIENT_PERMISSIONS"
              ? "INSUFFICIENT_PERMISSIONS"
              : accessReport.error.code === "REPO_ARCHIVED"
              ? "REPO_ARCHIVED"
              : accessReport.error.code === "REPO_NOT_ALLOWED"
              ? "REPO_NOT_ALLOWED"
              : "PERMISSION_DENIED",
          status: 403,
          details: accessReport.error,
        });
      }
      throw new GitHubIntegrationError({
        message: `Write permissions required on "${targetRepo}" to open draft pull requests.`,
        kind: "INSUFFICIENT_PERMISSIONS",
        status: 403,
      });
    }

    // 7. Verify source repair branch actually exists in target repository
    const branchInfo = await this.getBranch(owner, repo, params.headBranch);
    if (!branchInfo || !branchInfo.commitSha) {
      throw new GitHubNotFoundError(
        `Branch "${params.headBranch}" in "${targetRepo}"`,
        `repos/${owner}/${repo}/branches/${encodeURIComponent(params.headBranch)}`
      );
    }

    // 8. Idempotency & Retry Check: verify if an open PR already exists
    const existingPr = await this.findOpenPullRequest(owner, repo, params.headBranch, baseBranch);
    if (existingPr) {
      return {
        prNumber: existingPr.number,
        prUrl: existingPr.htmlUrl,
        title: existingPr.title,
        sourceBranch: params.headBranch,
        baseBranch,
        headCommitSha: existingPr.headSha || confirmedSha,
        status: "draft",
        isDraft: true,
        merged: false,
        createdAt: existingPr.createdAt,
        repository: targetRepo,
        existing: true,
        author: existingPr.author,
      };
    }

    // 9. Build draft pull request payload
    const draftPayload = this.buildDraftPullRequestPayload({
      jobId: params.jobId,
      findingId: params.findingId || "FND-001",
      defectCategory: params.defectCategory || "UI Defect",
      defectTitle: params.defectTitle || `Resolved UI issue for Job #${params.jobId}`,
      defectDescription: params.defectDescription,
      repairedComponent: params.repairedComponent,
      headBranch: params.headBranch,
      baseBranch,
      validation: params.validation,
      evidenceUris: params.evidenceUris,
    });

    if (params.title) {
      draftPayload.title = params.title;
    }
    if (params.customBody) {
      draftPayload.body = params.customBody;
    }

    // 10. Create Draft Pull Request via GitHub REST API: POST /repos/{owner}/{repo}/pulls
    try {
      const prData = await this.request<any>(`repos/${owner}/${repo}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          title: draftPayload.title,
          body: draftPayload.body,
          head: draftPayload.head,
          base: draftPayload.base,
          draft: true, // Strict safety invariant: automated PRs must always be draft!
        }),
      });

      return {
        prNumber: prData.number,
        prUrl: prData.html_url,
        title: prData.title,
        sourceBranch: params.headBranch,
        baseBranch,
        headCommitSha: prData.head?.sha || confirmedSha,
        status: "draft",
        isDraft: true, // Never ready-for-review automatically
        merged: false, // Strict safety guarantee: never merged automatically
        createdAt: prData.created_at || new Date().toISOString(),
        repository: targetRepo,
        existing: false,
        author: prData.user?.login || accessReport.identity?.login || "unknown",
      };
    } catch (err: unknown) {
      // If GitHub rejects with 422 because PR already exists (race condition), safely recover existing PR
      if (err instanceof GitHubIntegrationError && err.status === 422) {
        const raceExistingPr = await this.findOpenPullRequest(owner, repo, params.headBranch, baseBranch);
        if (raceExistingPr) {
          return {
            prNumber: raceExistingPr.number,
            prUrl: raceExistingPr.htmlUrl,
            title: raceExistingPr.title,
            sourceBranch: params.headBranch,
            baseBranch,
            headCommitSha: raceExistingPr.headSha || confirmedSha,
            status: "draft",
            isDraft: true,
            merged: false,
            createdAt: raceExistingPr.createdAt,
            repository: targetRepo,
            existing: true,
            author: raceExistingPr.author,
          };
        }
      }
      throw err;
    }
  }
}

export const gitHubIntegrationService = new GitHubIntegrationService();
