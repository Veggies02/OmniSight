/**
 * OmniSight GitHub Integration Service Types & Safety Contracts
 *
 * Defines contracts for server-side GitHub operations, validation gates,
 * pull request metadata, and repository state queries.
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

export interface GitHubServiceConfig {
  token?: string; // Server-side GITHUB_TOKEN or OMNISIGHT_GITHUB_TOKEN
  baseUrl?: string; // Default: https://api.github.com
  defaultBaseBranch?: string; // Default: main
  timeoutMs?: number;
}
