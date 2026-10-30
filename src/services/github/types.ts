/**
 * OmniSight GitHub Integration Service Types & Safety Contracts
 *
 * Defines contracts for server-side GitHub operations, validation gates,
 * pull request metadata, identity verification, repository permissions,
 * and validated repair workflow orchestration.
 */

export interface GitHubRepoMetadata {
  id: number;
  name: string;
  fullName: string; // e.g. "octocat/hello-world"
  owner: string;
  defaultBranch: string;
  isPrivate: boolean;
  isArchived: boolean;
  htmlUrl: string;
  description?: string;
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export interface GitHubBranchInfo {
  name: string;
  commitSha: string;
  isProtected: boolean;
  htmlUrl?: string;
}

export interface GitHubPullRequestMetadata {
  number: number;
  title: string;
  state: "open" | "closed";
  isDraft: boolean;
  htmlUrl: string;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  merged: boolean;
  createdAt: string;
  updatedAt: string;
  author: string;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
}

export interface AuthenticatedIdentity {
  login: string;
  id: number;
  type: "User" | "Bot" | "Organization" | "Unknown";
  authMethod: "token" | "app_installation" | "none";
  scopes?: string[];
}

export interface RepositoryPermissions {
  canRead: boolean;
  canWrite: boolean;
  canAdmin: boolean;
  hasRequiredPermissions: boolean; // canRead && canWrite && !isArchived
}

export type PermissionErrorCode =
  | "MISSING_CREDENTIALS"
  | "INVALID_CREDENTIALS"
  | "REPO_NOT_FOUND"
  | "INSUFFICIENT_PERMISSIONS"
  | "REPO_ARCHIVED"
  | "REPO_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "API_ERROR";

export interface RepositoryPermissionReport {
  authenticated: boolean;
  identity: AuthenticatedIdentity | null;
  repository: {
    owner: string;
    name: string;
    fullName: string;
    isPrivate: boolean;
    isArchived: boolean;
    defaultBranch: string;
  } | null;
  permissions: RepositoryPermissions;
  isTargetRepoAllowed: boolean;
  error?: {
    code: PermissionErrorCode;
    message: string;
    help: string;
  };
}

export interface ValidationGateStatus {
  status: "passed" | "failed" | "running" | "pending" | "needs-review" | "not-applicable";
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  verifiedAt?: string;
  failureSummary?: string;
}

export interface PrepareRepairBranchParams {
  owner: string;
  repo: string;
  jobId: string;
  findingId: string;
  baseBranch?: string; // Default to repository's default branch or "main"
  validation: ValidationGateStatus;
  branchSuffix?: string;
}

export interface PrepareRepairBranchResult {
  branchName: string;
  baseBranch: string;
  baseCommitSha: string;
  created: boolean;
  exists: boolean;
  htmlUrl?: string;
}

export interface FileChange {
  path: string;
  content: string;
  mode?: "100644" | "100755";
}

export interface PrepareRepairCommitParams {
  owner: string;
  repo: string;
  branch: string;
  jobId: string;
  findingId: string;
  commitMessage: string;
  changes: FileChange[];
  validation: ValidationGateStatus;
}

export interface PrepareRepairCommitResult {
  commitSha: string;
  branch: string;
  parentSha: string;
  treeSha: string;
  changedFilesCount: number;
  committedAt: string;
  htmlUrl?: string;
}

/**
 * High-level orchestration contract for executing a complete repair workflow:
 * Validates gates -> checks write permissions -> creates/reuses branch -> commits approved changes
 */
export interface ExecuteRepairWorkflowParams {
  jobId: string;
  findingId: string;
  targetRepository?: string; // e.g. "Veggies02/OmniSight" (or defaults from config)
  baseBranch?: string; // e.g. "main"
  validation: ValidationGateStatus;
  changes: FileChange[];
  commitMessage?: string;
  branchSuffix?: string;
}

export interface ExecuteRepairWorkflowResult {
  status: "success" | "skipped_duplicate";
  repository: string;
  branch: string;
  baseBranch: string;
  baseCommitSha: string;
  commitSha: string;
  changedFilesCount: number;
  changedPaths: string[];
  committedAt: string;
  htmlUrl?: string;
  validationGate: {
    passed: true;
    totalChecks: number;
  };
}

export interface BuildDraftPRParams {
  jobId: string;
  findingId: string;
  defectCategory: string;
  defectTitle: string;
  defectDescription?: string;
  repairedComponent?: string;
  headBranch: string;
  baseBranch: string;
  validation: ValidationGateStatus;
  evidenceUris?: {
    baselineUri?: string;
    defectiveUri?: string;
  };
}

export interface DraftPullRequestPayload {
  title: string;
  body: string;
  head: string;
  base: string;
  draft: true; // Safety invariant: automated PRs must always be draft!
}

/**
 * Parameters for creating a confirmed GitHub draft pull request.
 */
export interface CreateDraftPullRequestParams {
  jobId: string;
  headBranch: string;
  headCommitSha?: string;
  findingId?: string;
  owner?: string;
  repo?: string;
  targetRepository?: string; // e.g. "Veggies02/OmniSight"
  baseBranch?: string; // Default: "main"
  validation: ValidationGateStatus;
  title?: string;
  defectCategory?: string;
  defectTitle?: string;
  defectDescription?: string;
  repairedComponent?: string;
  evidenceUris?: {
    baselineUri?: string;
    defectiveUri?: string;
  };
  customBody?: string;
}

/**
 * Confirmed result returned from the GitHub draft pull request workflow.
 */
export interface CreateDraftPullRequestResult {
  prNumber: number;
  prUrl: string;
  title: string;
  sourceBranch: string;
  baseBranch: string;
  headCommitSha?: string;
  status: "draft";
  isDraft: true; // Safety invariant
  merged: false; // Safety invariant: automated PRs are never merged
  createdAt: string;
  repository: string;
  existing: boolean; // True if an existing open PR was safely reused
  author: string;
}

export interface GitHubServiceConfig {
  token?: string; // Server-side GITHUB_TOKEN or OMNISIGHT_GITHUB_TOKEN
  baseUrl?: string; // Default: https://api.github.com
  defaultBaseBranch?: string; // Default: main
  allowedRepositories?: string[]; // Target repository allowlist (e.g. ["Veggies02/OmniSight"])
  defaultRepo?: string; // Default target repository in owner/repo format
  timeoutMs?: number;
  maxRetries?: number; // Maximum transient retries for idempotent read operations (default: 2)
  retryDelayMs?: number; // Base exponential backoff delay (default: 500ms)
}

export type { GitHubErrorCode, StructuredGitHubError } from "./errors.ts";
