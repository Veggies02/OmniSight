/**
 * OmniSight Repair Safety & Validation Gate Enforcement
 *
 * Implements strict guardrails:
 * - Never push or write to protected base branches (main, master, prod, etc.)
 * - Never create automated repair branches or commits without explicit validation passage
 * - Validate git branch names and commit messages to prevent shell injection or illegal refs
 * - Restrict operations to configured target repository allowlist
 * - Verify that the identity has write permission before attempting mutations
 * - Restrict file change paths to safe project directories and reject path traversal/unexpected binary extensions
 */

import type { ValidationGateStatus, FileChange } from "./types.ts";
import {
  ValidationGateError,
  ProtectedBranchError,
  InsufficientPermissionsError,
  RepositoryNotAllowedError,
  ArchivedRepositoryError,
  UnsafeFilePathError,
  EmptyRepairDiffError,
} from "./errors.ts";

/**
 * Branches that are protected from automated repair commits and writes
 */
export const PROTECTED_BRANCH_NAMES: readonly string[] = [
  "main",
  "master",
  "develop",
  "dev",
  "production",
  "prod",
  "release",
  "staging",
] as const;

/**
 * Checks if a given branch name is considered a protected branch
 */
export function isProtectedBranch(branch: string): boolean {
  if (!branch || typeof branch !== "string") return false;
  const clean = branch.trim().toLowerCase().replace(/^refs\/heads\//, "");

  if (PROTECTED_BRANCH_NAMES.includes(clean)) {
    return true;
  }

  // Also protect release/* or prod/* prefixes
  if (clean.startsWith("release/") || clean.startsWith("prod/") || clean.startsWith("release-")) {
    return true;
  }

  return false;
}

/**
 * Asserts that a target branch is safe to write to (not a protected branch).
 * Throws ProtectedBranchError if branch is protected.
 */
export function assertNotProtectedBranch(branch: string): void {
  if (isProtectedBranch(branch)) {
    throw new ProtectedBranchError(
      branch,
      `Safety violation: Automated repairs may not write directly to protected branch "${branch}". Must create an isolated repair branch.`
    );
  }
}

/**
 * Asserts that the requested target repository is permitted by the configured allowlist.
 * If allowedRepos is configured, repoFullName must be in the list (case-insensitive).
 */
export function assertTargetRepoAllowed(
  repoFullName: string,
  allowedRepos?: readonly string[]
): void {
  if (!repoFullName || typeof repoFullName !== "string") {
    throw new RepositoryNotAllowedError("undefined", allowedRepos);
  }

  // If no allowlist is configured, allow any valid owner/repo
  if (!allowedRepos || allowedRepos.length === 0) {
    return;
  }

  const cleanTarget = repoFullName.trim().toLowerCase();
  const isMatch = allowedRepos.some((r) => r.trim().toLowerCase() === cleanTarget);

  if (!isMatch) {
    throw new RepositoryNotAllowedError(repoFullName, allowedRepos);
  }
}

/**
 * Asserts that the target repository is not archived.
 */
export function assertRepoNotArchived(isArchived: boolean, repoFullName: string): void {
  if (isArchived) {
    throw new ArchivedRepositoryError(repoFullName);
  }
}

/**
 * Asserts that the authenticated identity has write permissions on the repository.
 */
export function assertWritePermission(canWrite: boolean, repoFullName: string): void {
  if (!canWrite) {
    throw new InsufficientPermissionsError(repoFullName, "write");
  }
}

/**
 * Asserts that automated validation has explicitly PASSED with zero failures.
 * Throws ValidationGateError if validation is incomplete, pending, failed, or unverified.
 */
export function assertValidationPassed(validation: ValidationGateStatus | undefined | null): void {
  if (!validation) {
    throw new ValidationGateError(
      "Validation Gate Blocked: Missing validation results. Explicit automated verification is required before staging a repair branch or commit."
    );
  }

  if (validation.status !== "passed") {
    throw new ValidationGateError(
      `Validation Gate Blocked: Current validation status is "${validation.status}". Automated repair branches and commits require status to be explicitly "passed".`,
      validation
    );
  }

  if (validation.failedChecks > 0) {
    throw new ValidationGateError(
      `Validation Gate Blocked: ${validation.failedChecks} check(s) failed during post-patch verification. Patches with test regressions cannot be committed.`,
      validation
    );
  }

  if (validation.totalChecks < 1) {
    throw new ValidationGateError(
      "Validation Gate Blocked: Zero automated validation checks were executed. At least 1 assertion check must pass before committing.",
      validation
    );
  }
}

/**
 * Allowed file extensions for automated repairs (code, styles, configs, tests).
 * Binary executables, images, or archive formats are strictly forbidden.
 */
export const ALLOWED_FILE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".css",
  ".scss",
  ".json",
  ".html",
  ".md",
] as const;

/**
 * Disallowed directory names where automated repairs may never write.
 */
export const FORBIDDEN_DIRECTORIES: readonly string[] = [
  ".git",
  ".github",
  "node_modules",
  "dist",
  "build",
  ".vscode",
  ".idea",
] as const;

/**
 * Validates that an individual file change path is safe, normalized,
 * within permitted project directories, and does not contain path traversal.
 */
export function validateRepairFilePath(filePath: string): string {
  if (!filePath || typeof filePath !== "string") {
    throw new UnsafeFilePathError(String(filePath), "File path must be a non-empty string.");
  }

  const normalized = filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");

  if (normalized.length === 0) {
    throw new UnsafeFilePathError(filePath, "File path cannot be empty or root.");
  }

  // Reject path traversal
  if (normalized.includes("..") || normalized.includes("./")) {
    throw new UnsafeFilePathError(filePath, "Path traversal sequence ('..' or './') is forbidden.");
  }

  // Reject null bytes or control characters
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      throw new UnsafeFilePathError(filePath, "Path contains illegal control characters.");
    }
  }

  // Check top-level directory against forbidden directories
  const segments = normalized.split("/");
  const rootDir = segments[0]?.toLowerCase();
  if (rootDir && FORBIDDEN_DIRECTORIES.includes(rootDir as any)) {
    throw new UnsafeFilePathError(
      filePath,
      `Modifications inside protected directory "${rootDir}" are forbidden.`
    );
  }

  // Check file extension
  const hasAllowedExt = ALLOWED_FILE_EXTENSIONS.some((ext) =>
    normalized.toLowerCase().endsWith(ext)
  );

  if (!hasAllowedExt) {
    throw new UnsafeFilePathError(
      filePath,
      `File extension not permitted. Automated repairs only permit source code and style modifications (${ALLOWED_FILE_EXTENSIONS.join(", ")}).`
    );
  }

  return normalized;
}

/**
 * Validates a batch of file changes for a repair commit.
 * Enforces non-empty set, safe paths, and non-empty file contents.
 */
export function validateRepairFileChanges(changes: FileChange[]): FileChange[] {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new EmptyRepairDiffError("Cannot create repair commit with empty file changes list.");
  }

  const seenPaths = new Set<string>();
  const validatedChanges: FileChange[] = [];

  for (const change of changes) {
    if (!change || typeof change !== "object") {
      throw new UnsafeFilePathError("unknown", "File change record must be an object.");
    }

    const safePath = validateRepairFilePath(change.path);

    if (seenPaths.has(safePath)) {
      throw new UnsafeFilePathError(change.path, "Duplicate file path in repair changes batch.");
    }
    seenPaths.add(safePath);

    if (typeof change.content !== "string") {
      throw new UnsafeFilePathError(change.path, "File content must be a string.");
    }

    validatedChanges.push({
      path: safePath,
      content: change.content,
      mode: change.mode || "100644",
    });
  }

  return validatedChanges;
}

/**
 * Sanitizes an arbitrary string into a safe, valid git ref component (job ID, finding ID)
 */
export function sanitizeRefSlug(input: string): string {
  if (!input || typeof input !== "string") return "unknown";
  return input
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Validates that a branch name strictly conforms to git ref naming conventions
 * and contains no shell metacharacters or path traversal indicators.
 */
export function validateBranchName(branchName: string): boolean {
  if (!branchName || typeof branchName !== "string") return false;
  const b = branchName.trim();

  // Length limits
  if (b.length < 3 || b.length > 200) return false;

  // Cannot start or end with a slash or dash
  if (b.startsWith("/") || b.endsWith("/") || b.startsWith("-") || b.endsWith("-")) return false;

  // Cannot contain ".." (path traversal) or "//"
  if (b.includes("..") || b.includes("//")) return false;

  // Cannot end with ".lock"
  if (b.endsWith(".lock")) return false;

  // Allowed characters: alphanumeric, dash, underscore, forward slash
  const validPattern = /^[a-zA-Z0-9_\-/]+$/;
  if (!validPattern.test(b)) return false;

  // Must not contain git control characters (~, ^, :, ?, *, [, \, @{)
  const forbiddenChars = /[~^:?*[\\@]/;
  if (forbiddenChars.test(b)) return false;

  return true;
}

/**
 * Builds the canonical, validated repair branch name for a given job and finding.
 * Format: omnisight/repair-{jobId}-{findingId}
 */
export function buildRepairBranchName(jobId: string, findingId: string, suffix?: string): string {
  const cleanJob = sanitizeRefSlug(jobId) || "job";
  const cleanFinding = sanitizeRefSlug(findingId) || "fnd";
  const cleanSuffix = suffix ? `-${sanitizeRefSlug(suffix)}` : "";

  const branchName = `omnisight/repair-${cleanJob}-${cleanFinding}${cleanSuffix}`;

  if (!validateBranchName(branchName)) {
    throw new Error(`Generated repair branch name "${branchName}" is invalid.`);
  }

  // Safety check: ensure it is not protected
  assertNotProtectedBranch(branchName);

  return branchName;
}

/**
 * Validates and sanitizes a commit message.
 */
export function validateCommitMessage(message: string): string {
  if (!message || typeof message !== "string") {
    throw new Error("Commit message must be a non-empty string.");
  }

  const trimmed = message.trim();
  if (trimmed.length < 10) {
    throw new Error("Commit message must be at least 10 characters long.");
  }

  if (trimmed.length > 2000) {
    throw new Error("Commit message exceeds maximum permitted length (2000 characters).");
  }

  // Clean illegal null or control characters while preserving valid newlines and tabs
  const sanitized = Array.from(trimmed)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join("");

  return sanitized;
}
