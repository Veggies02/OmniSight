import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";

/**
 * Strict allowlist of source files eligible for inspection, localization, and repair proposals.
 * Reject all arbitrary files, lockfiles, configs, secrets, build outputs, and parent directories.
 */
export const SOURCE_FILE_ALLOWLIST: readonly string[] = Object.freeze([
  "src/index.css",
  "src/components/ProductCard.tsx",
  "src/components/Navbar.tsx",
  "src/components/Footer.tsx",
  "src/pages/Home.tsx",
  "src/pages/Products.tsx",
  "src/pages/ProductDetails.tsx",
  "src/pages/Cart.tsx",
  "src/pages/Checkout.tsx",
  "src/pages/NotFound.tsx",
  "src/App.tsx",
  "src/main.tsx",
]);

export interface PathValidationResult {
  valid: boolean;
  error?: string;
  normalizedRelativePath?: string;
  absolutePath?: string;
}

/**
 * Validates and safely resolves a relative project path against strict security rules.
 */
export function validateAndResolveSourcePath(inputPath: string, projectRoot: string = process.cwd()): PathValidationResult {
  if (!inputPath || typeof inputPath !== "string") {
    return { valid: false, error: "Input path must be a non-empty string." };
  }

  const trimmed = inputPath.trim();

  // Reject absolute paths
  if (path.isAbsolute(trimmed)) {
    return { valid: false, error: `Absolute paths are strictly forbidden: '${trimmed}'.` };
  }

  // Reject path traversal tokens
  if (trimmed.includes("..") || trimmed.includes("\0")) {
    return { valid: false, error: `Path traversal or null bytes detected: '${trimmed}'.` };
  }

  // Normalize relative path with forward slashes
  const normalizedRel = path.normalize(trimmed).replace(/\\/g, "/");

  // Enforce allowlist membership
  if (!SOURCE_FILE_ALLOWLIST.includes(normalizedRel)) {
    return {
      valid: false,
      error: `Path '${normalizedRel}' is not in the source allowlist. Only approved UI components and styles may be inspected.`,
    };
  }

  // Resolve absolute path and ensure it stays inside project root
  const resolvedAbsolute = path.resolve(projectRoot, normalizedRel);
  const resolvedProjectRoot = path.resolve(projectRoot);

  if (!resolvedAbsolute.startsWith(resolvedProjectRoot)) {
    return { valid: false, error: `Path traverses outside project boundary: '${trimmed}'.` };
  }

  // Ensure file exists and is a regular file
  if (!fs.existsSync(resolvedAbsolute) || !fs.statSync(resolvedAbsolute).isFile()) {
    return { valid: false, error: `Allowed source file does not exist on disk: '${normalizedRel}'.` };
  }

  return {
    valid: true,
    normalizedRelativePath: normalizedRel,
    absolutePath: resolvedAbsolute,
  };
}

/**
 * Computes SHA-256 hash of a file's content.
 */
export function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Verifies that a recorded SHA-256 file hash still matches current disk state.
 * Returns true if fresh, false if stale.
 */
export function verifySourceHashFreshness(filePath: string, recordedHash: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const currentHash = computeFileHash(filePath);
  return currentHash === recordedHash;
}
