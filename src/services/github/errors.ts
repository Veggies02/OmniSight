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
  | "RATE_LIMIT_EXCEEDED"
  | "NETWORK_ERROR"
  | "API_ERROR";

export class GitHubIntegrationError extends Error {
  public readonly kind: GitHubErrorKind;
  public readonly status: number;
  public readonly endpoint?: string;
  public readonly details?: unknown;

  constructor(params: {
    message: string;
    kind: GitHubErrorKind;
    status?: number;
    endpoint?: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "GitHubIntegrationError";
    this.kind = params.kind;
    this.status = params.status ?? 0;
    this.endpoint = params.endpoint;
    this.details = sanitizeDetails(params.details);
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

/**
 * Strips GitHub PATs, OAuth bearer tokens, and secrets from error details
 */
export function sanitizeDetails(details: unknown): unknown {
  if (!details || typeof details !== "object") return details;

  try {
    const serialized = JSON.stringify(details);
    const cleaned = serialized.replace(
      /"([^"]*?(?:token|bearer|password|secret|authorization|key)[^"]*?)"\s*:\s*"[^"]*"/gi,
      '"$1": "[REDACTED]"'
    ).replace(
      /gh[pousr]_[A-Za-z0-9_]{16,255}/g,
      "[REDACTED_GITHUB_TOKEN]"
    ).replace(
      /github_pat_[A-Za-z0-9_]{22,255}/g,
      "[REDACTED_GITHUB_PAT]"
    );
    return JSON.parse(cleaned);
  } catch {
    return "[Unserializable Error Payload]";
  }
}
