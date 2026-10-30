/**
 * OmniSight GitHub Integration Structured Errors & Redaction Utilities
 */

export type GitHubErrorKind =
  | "VALIDATION_GATE_ERROR"
  | "PROTECTED_BRANCH_ERROR"
  | "NOT_FOUND"
  | "AUTHENTICATION_ERROR"
  | "PERMISSION_DENIED"
  | "INSUFFICIENT_PERMISSIONS"
  | "REPO_NOT_ALLOWED"
  | "REPO_ARCHIVED"
  | "UNSAFE_FILE_PATH"
  | "EMPTY_REPAIR_DIFF"
  | "MISSING_REPAIR_COMMIT"
  | "BRANCH_MISMATCH"
  | "DUPLICATE_PULL_REQUEST"
  | "RATE_LIMIT_EXCEEDED"
  | "TIMEOUT"
  | "SERVICE_UNAVAILABLE"
  | "CONFLICT"
  | "OUTCOME_UNKNOWN"
  | "NETWORK_ERROR"
  | "API_ERROR";

export type GitHubErrorCode =
  | "AUTH_FAILED"
  | "PERMISSION_DENIED"
  | "RESOURCE_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PROTECTED_BRANCH"
  | "CONFLICT"
  | "UNSAFE_PATH"
  | "EMPTY_DIFF"
  | "MISSING_COMMIT"
  | "BRANCH_MISMATCH"
  | "REPO_NOT_ALLOWED"
  | "REPO_ARCHIVED"
  | "OUTCOME_UNKNOWN"
  | "UNKNOWN_ERROR";

export interface StructuredGitHubError {
  code: GitHubErrorCode;
  message: string;
  isRetryable: boolean;
  retryAfterMs?: number;
  help: string;
  status: number;
  timestamp: string;
  outcome?: "failed" | "unknown";
  endpoint?: string;
  details?: unknown;
}

export function isKindRetryable(kind: GitHubErrorKind, status?: number): boolean {
  if (kind === "RATE_LIMIT_EXCEEDED" || kind === "TIMEOUT" || kind === "SERVICE_UNAVAILABLE") {
    return true;
  }
  if (kind === "NETWORK_ERROR") {
    return true;
  }
  if (status && (status === 429 || status === 502 || status === 503 || status === 504)) {
    return true;
  }
  return false;
}

export function mapKindToCode(kind: GitHubErrorKind, status?: number): GitHubErrorCode {
  switch (kind) {
    case "AUTHENTICATION_ERROR":
      return "AUTH_FAILED";
    case "PERMISSION_DENIED":
    case "INSUFFICIENT_PERMISSIONS":
      return "PERMISSION_DENIED";
    case "NOT_FOUND":
      return "RESOURCE_NOT_FOUND";
    case "VALIDATION_GATE_ERROR":
      return "VALIDATION_FAILED";
    case "PROTECTED_BRANCH_ERROR":
      return "PROTECTED_BRANCH";
    case "RATE_LIMIT_EXCEEDED":
      return "RATE_LIMITED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "SERVICE_UNAVAILABLE":
      return "SERVICE_UNAVAILABLE";
    case "CONFLICT":
    case "DUPLICATE_PULL_REQUEST":
      return "CONFLICT";
    case "UNSAFE_FILE_PATH":
      return "UNSAFE_PATH";
    case "EMPTY_REPAIR_DIFF":
      return "EMPTY_DIFF";
    case "MISSING_REPAIR_COMMIT":
      return "MISSING_COMMIT";
    case "BRANCH_MISMATCH":
      return "BRANCH_MISMATCH";
    case "REPO_NOT_ALLOWED":
      return "REPO_NOT_ALLOWED";
    case "REPO_ARCHIVED":
      return "REPO_ARCHIVED";
    case "OUTCOME_UNKNOWN":
      return "OUTCOME_UNKNOWN";
    case "NETWORK_ERROR":
      return "NETWORK_ERROR";
    case "API_ERROR":
      if (status === 401) return "AUTH_FAILED";
      if (status === 403) return "PERMISSION_DENIED";
      if (status === 404) return "RESOURCE_NOT_FOUND";
      if (status === 409) return "CONFLICT";
      if (status === 429) return "RATE_LIMITED";
      if (status === 502 || status === 503) return "SERVICE_UNAVAILABLE";
      if (status === 504) return "TIMEOUT";
      return "UNKNOWN_ERROR";
    default:
      return "UNKNOWN_ERROR";
  }
}

export function getDefaultHelp(code: GitHubErrorCode): string {
  switch (code) {
    case "AUTH_FAILED":
      return "Verify server-side GITHUB_TOKEN or OMNISIGHT_GITHUB_TOKEN configuration. Ensure token is valid and unexpired.";
    case "PERMISSION_DENIED":
      return "The authenticated GitHub identity lacks write access. Ensure the fine-grained token has Repository 'Contents: Read and write' and 'Pull requests: Read and write' permissions.";
    case "RESOURCE_NOT_FOUND":
      return "The repository or branch ref was not found. Confirm the repository spelling and verify the branch exists.";
    case "VALIDATION_FAILED":
      return "Automated validation gate blocked the operation. Ensure all Playwright assertions pass with zero failures before proceeding.";
    case "RATE_LIMITED":
      return "GitHub API rate limit exceeded. Wait for the reset window before re-attempting.";
    case "SERVICE_UNAVAILABLE":
      return "GitHub API is temporarily experiencing high load. This failure is transient and safe to retry with backoff.";
    case "TIMEOUT":
      return "The request timed out. For read operations, retry after a delay. For write operations, state must be verified on GitHub first.";
    case "NETWORK_ERROR":
      return "A network error interrupted the GitHub connection. Check connectivity and retry.";
    case "PROTECTED_BRANCH":
      return "Automated operations cannot write directly to protected base branches (main, master). All self-healing must use dedicated repair branches.";
    case "CONFLICT":
      return "A branch or draft pull request already exists for this repair job. The existing branch or PR will be safely reused.";
    case "UNSAFE_PATH":
      return "File modification path was rejected. Paths must be relative within approved project source directories without traversal sequences.";
    case "EMPTY_DIFF":
      return "No valid file modifications were provided for the repair commit.";
    case "MISSING_COMMIT":
      return "A confirmed repair branch commit SHA is required before opening a draft pull request.";
    case "BRANCH_MISMATCH":
      return "The source repair branch cannot be identical to the base branch.";
    case "REPO_NOT_ALLOWED":
      return "The target repository is not in OMNISIGHT_GITHUB_ALLOWED_REPOS. Verify target repository settings.";
    case "REPO_ARCHIVED":
      return "The target repository is archived on GitHub and read-only. Unarchive it to allow self-healing mutations.";
    case "OUTCOME_UNKNOWN":
      return "A write operation timed out before confirmation was received. Inspect GitHub directly before re-submitting to prevent duplicate mutations.";
    case "UNKNOWN_ERROR":
    default:
      return "An unexpected error occurred during the GitHub operation. Review the error message and check network connectivity.";
  }
}

export class GitHubIntegrationError extends Error {
  public readonly kind: GitHubErrorKind;
  public readonly code: GitHubErrorCode;
  public readonly status: number;
  public readonly isRetryable: boolean;
  public readonly retryAfterMs?: number;
  public readonly help: string;
  public readonly outcome: "failed" | "unknown";
  public readonly endpoint?: string;
  public readonly details?: unknown;

  constructor(params: {
    message: string;
    kind: GitHubErrorKind;
    code?: GitHubErrorCode;
    status?: number;
    isRetryable?: boolean;
    retryAfterMs?: number;
    help?: string;
    outcome?: "failed" | "unknown";
    endpoint?: string;
    details?: unknown;
  }) {
    super(sanitizeMessage(params.message));
    this.name = "GitHubIntegrationError";
    this.kind = params.kind;
    this.status = params.status ?? 0;
    this.code = params.code || mapKindToCode(params.kind, this.status);
    this.isRetryable = params.isRetryable ?? isKindRetryable(params.kind, this.status);
    this.retryAfterMs = params.retryAfterMs;
    this.help = params.help || getDefaultHelp(this.code);
    this.outcome = params.outcome || "failed";
    this.endpoint = params.endpoint;
    this.details = sanitizeDetails(params.details);
  }

  public toStructuredError(): StructuredGitHubError {
    return {
      code: this.code,
      message: this.message,
      isRetryable: this.isRetryable,
      retryAfterMs: this.retryAfterMs,
      help: this.help,
      status: this.status,
      timestamp: new Date().toISOString(),
      outcome: this.outcome,
      endpoint: this.endpoint,
    };
  }
}

export class ValidationGateError extends GitHubIntegrationError {
  constructor(message: string, details?: unknown) {
    super({
      message,
      kind: "VALIDATION_GATE_ERROR",
      status: 400,
      details,
    });
    this.name = "ValidationGateError";
  }
}

export class ProtectedBranchError extends GitHubIntegrationError {
  public readonly branch: string;

  constructor(branch: string, message?: string) {
    super({
      message: message || `Operation rejected: "${branch}" is a protected base branch and cannot be directly targeted for automated repair writes.`,
      kind: "PROTECTED_BRANCH_ERROR",
      status: 403,
      details: { branch },
    });
    this.name = "ProtectedBranchError";
    this.branch = branch;
  }
}

export class InsufficientPermissionsError extends GitHubIntegrationError {
  public readonly requiredPermission: "read" | "write" | "admin";
  public readonly repository: string;

  constructor(repository: string, requiredPermission: "read" | "write" | "admin" = "write") {
    super({
      message: `Insufficient permissions on repository "${repository}". The authenticated GitHub identity lacks ${requiredPermission.toUpperCase()} permission required for this operation.`,
      kind: "INSUFFICIENT_PERMISSIONS",
      status: 403,
      details: { repository, requiredPermission },
    });
    this.name = "InsufficientPermissionsError";
    this.repository = repository;
    this.requiredPermission = requiredPermission;
  }
}

export class RepositoryNotAllowedError extends GitHubIntegrationError {
  public readonly repository: string;

  constructor(repository: string, allowedRepos?: readonly string[]) {
    super({
      message: `Repository "${repository}" is not in the approved target allowlist${allowedRepos && allowedRepos.length > 0 ? ` (allowed: ${allowedRepos.join(", ")})` : ""}. Automated repairs are restricted to configured repositories.`,
      kind: "REPO_NOT_ALLOWED",
      status: 403,
      details: { repository, allowedRepos },
    });
    this.name = "RepositoryNotAllowedError";
    this.repository = repository;
  }
}

export class ArchivedRepositoryError extends GitHubIntegrationError {
  public readonly repository: string;

  constructor(repository: string) {
    super({
      message: `Repository "${repository}" is archived. GitHub prevents creating branches or commits in archived repositories.`,
      kind: "REPO_ARCHIVED",
      status: 403,
      details: { repository },
    });
    this.name = "ArchivedRepositoryError";
    this.repository = repository;
  }
}

export class UnsafeFilePathError extends GitHubIntegrationError {
  public readonly filePath: string;
  public readonly reason: string;

  constructor(filePath: string, reason: string) {
    super({
      message: `Unsafe file change path rejected: "${filePath}". ${reason}`,
      kind: "UNSAFE_FILE_PATH",
      status: 400,
      details: { filePath, reason },
    });
    this.name = "UnsafeFilePathError";
    this.filePath = filePath;
    this.reason = reason;
  }
}

export class EmptyRepairDiffError extends GitHubIntegrationError {
  constructor(message = "Repair workflow rejected: No approved file changes provided.") {
    super({
      message,
      kind: "EMPTY_REPAIR_DIFF",
      status: 400,
    });
    this.name = "EmptyRepairDiffError";
  }
}

export class MissingRepairCommitError extends GitHubIntegrationError {
  constructor(
    message = "Draft pull request rejected: A confirmed repair branch commit SHA is required before opening a pull request."
  ) {
    super({
      message,
      kind: "MISSING_REPAIR_COMMIT",
      status: 400,
    });
    this.name = "MissingRepairCommitError";
  }
}

export class BranchMismatchError extends GitHubIntegrationError {
  public readonly headBranch: string;
  public readonly baseBranch: string;

  constructor(
    headBranch: string,
    baseBranch: string,
    message?: string
  ) {
    super({
      message:
        message ||
        `Draft pull request rejected: Source repair branch "${headBranch}" cannot be identical to base branch "${baseBranch}".`,
      kind: "BRANCH_MISMATCH",
      status: 400,
      details: { headBranch, baseBranch },
    });
    this.name = "BranchMismatchError";
    this.headBranch = headBranch;
    this.baseBranch = baseBranch;
  }
}

export class DuplicatePullRequestError extends GitHubIntegrationError {
  public readonly existingPrNumber?: number;
  public readonly existingPrUrl?: string;

  constructor(
    headBranch: string,
    baseBranch: string,
    existingPrNumber?: number,
    existingPrUrl?: string
  ) {
    super({
      message: `A pull request from "${headBranch}" into "${baseBranch}" already exists${existingPrNumber ? ` (#${existingPrNumber})` : ""}.`,
      kind: "DUPLICATE_PULL_REQUEST",
      status: 409,
      details: { headBranch, baseBranch, existingPrNumber, existingPrUrl },
    });
    this.name = "DuplicatePullRequestError";
    this.existingPrNumber = existingPrNumber;
    this.existingPrUrl = existingPrUrl;
  }
}

export class GitHubNotFoundError extends GitHubIntegrationError {
  constructor(resource: string, endpoint?: string) {
    super({
      message: `GitHub resource not found: ${resource}`,
      kind: "NOT_FOUND",
      status: 404,
      endpoint,
    });
    this.name = "GitHubNotFoundError";
  }
}

export class GitHubRateLimitError extends GitHubIntegrationError {
  public readonly resetAt?: Date;

  constructor(resetTimestamp?: number, endpoint?: string) {
    const resetDate = resetTimestamp ? new Date(resetTimestamp * 1000) : undefined;
    super({
      message: `GitHub API rate limit exceeded.${resetDate ? ` Resets at ${resetDate.toISOString()}` : ""}`,
      kind: "RATE_LIMIT_EXCEEDED",
      status: 429,
      endpoint,
      details: { resetAt: resetDate?.toISOString() },
    });
    this.name = "GitHubRateLimitError";
    this.resetAt = resetDate;
  }
}

export class GitHubAuthenticationError extends GitHubIntegrationError {
  constructor(message: string = "GitHub authentication required. Server-side GITHUB_TOKEN not configured or invalid.") {
    super({
      message,
      kind: "AUTHENTICATION_ERROR",
      status: 401,
    });
    this.name = "GitHubAuthenticationError";
  }
}

export class GitHubTimeoutError extends GitHubIntegrationError {
  public readonly timeoutMs?: number;

  constructor(endpoint?: string, timeoutMs?: number) {
    super({
      message: `GitHub API request timed out${timeoutMs ? ` after ${timeoutMs}ms` : ""}.${endpoint ? ` Endpoint: ${endpoint}` : ""}`,
      kind: "TIMEOUT",
      status: 504,
      endpoint,
      isRetryable: true,
      help: "The request timed out. For read operations, retry after a short delay. For write operations, state must be verified before repeating.",
    });
    this.name = "GitHubTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class GitHubServiceUnavailableError extends GitHubIntegrationError {
  constructor(status: number = 503, message?: string, endpoint?: string) {
    super({
      message: message || `GitHub service is temporarily unavailable (HTTP ${status}).`,
      kind: "SERVICE_UNAVAILABLE",
      status,
      endpoint,
      isRetryable: true,
      help: "GitHub API is experiencing high latency or temporary downtime. Retry with exponential backoff.",
    });
    this.name = "GitHubServiceUnavailableError";
  }
}

export class GitHubUnknownOutcomeError extends GitHubIntegrationError {
  public readonly operationName: string;

  constructor(operationName: string, message?: string, endpoint?: string) {
    super({
      message:
        message ||
        `Operation "${operationName}" timed out or was interrupted. Its completion outcome could not be verified on GitHub.`,
      kind: "OUTCOME_UNKNOWN",
      status: 504,
      endpoint,
      isRetryable: false,
      outcome: "unknown",
      help: "The mutation timed out before receiving a confirmation response. Check GitHub directly before re-submitting to prevent duplicate commits or pull requests.",
    });
    this.name = "GitHubUnknownOutcomeError";
    this.operationName = operationName;
  }
}

export class GitHubConflictError extends GitHubIntegrationError {
  constructor(message: string, details?: unknown, endpoint?: string) {
    super({
      message,
      kind: "CONFLICT",
      status: 409,
      endpoint,
      isRetryable: false,
      details,
      help: "A conflict occurred during this GitHub mutation. Verify that the branch or pull request does not already exist.",
    });
    this.name = "GitHubConflictError";
  }
}

/**
 * Sanitizes an error message by scrubbing GitHub tokens, Bearer tokens, and secrets
 */
export function sanitizeMessage(msg: string): string {
  if (!msg || typeof msg !== "string") return "Unknown error occurred";
  return msg
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "Bearer [REDACTED]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{16,255}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/github_pat_[A-Za-z0-9_]{22,255}/g, "[REDACTED_GITHUB_PAT]")
    .replace(/([?&](?:access_token|token|key|secret)=)[^&\s]+/gi, "$1[REDACTED]");
}

/**
 * Strips GitHub PATs, OAuth bearer tokens, and secrets from error details
 */
export function sanitizeDetails(details: unknown): unknown {
  if (!details || typeof details !== "object") return details;

  try {
    const serialized = JSON.stringify(details);
    const cleaned = serialized
      .replace(
        /"([^"]*?(?:token|bearer|password|secret|authorization|key)[^"]*?)"\s*:\s*"[^"]*"/gi,
        '"$1": "[REDACTED]"'
      )
      .replace(/gh[pousr]_[A-Za-z0-9_]{16,255}/g, "[REDACTED_GITHUB_TOKEN]")
      .replace(/github_pat_[A-Za-z0-9_]{22,255}/g, "[REDACTED_GITHUB_PAT]")
      .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "Bearer [REDACTED]");
    return JSON.parse(cleaned);
  } catch {
    return "[Unserializable Error Payload]";
  }
}

/**
 * Normalizes any error into a safe, structured GitHub error object
 */
export function toStructuredGitHubError(err: unknown): StructuredGitHubError {
  if (err instanceof GitHubIntegrationError) {
    return err.toStructuredError();
  }

  const rawMessage = err instanceof Error ? err.message : String(err || "Unknown error occurred");
  const cleanMessage = sanitizeMessage(rawMessage);

  return {
    code: "UNKNOWN_ERROR",
    message: cleanMessage,
    isRetryable: false,
    help: "Review the system log or retry the operation after checking network connectivity.",
    status: 500,
    timestamp: new Date().toISOString(),
    outcome: "failed",
  };
}
