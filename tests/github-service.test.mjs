/**
 * Node 22 Native Test Suite for OmniSight GitHub Integration Service
 *
 * Verifies:
 * - Branch naming validation and ref slug sanitization
 * - Protected branch rejection (main, master, prod)
 * - Validation gate enforcement (blocks unless validation explicitly passes)
 * - Draft PR payload construction (draft: true invariant)
 * - Mocked GitHub REST API calls (getRepository, getBranch, getPullRequest)
 * - Idempotent repair branch preparation
 * - Repair commit creation and ref updating
 * - Rate-limit and 404 error handling
 * - Credential and token sanitization
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Import modules under test
import {
  GitHubIntegrationService,
  isProtectedBranch,
  assertNotProtectedBranch,
  assertValidationPassed,
  assertTargetRepoAllowed,
  assertRepoNotArchived,
  assertWritePermission,
  assertDifferentBranches,
  assertConfirmedRepairCommit,
  sanitizeRefSlug,
  validateBranchName,
  buildRepairBranchName,
  validateCommitMessage,
  validateRepairFilePath,
  validateRepairFileChanges,
  ValidationGateError,
  ProtectedBranchError,
  InsufficientPermissionsError,
  RepositoryNotAllowedError,
  ArchivedRepositoryError,
  UnsafeFilePathError,
  EmptyRepairDiffError,
  BranchMismatchError,
  MissingRepairCommitError,
  DuplicatePullRequestError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubAuthenticationError,
  GitHubTimeoutError,
  GitHubServiceUnavailableError,
  GitHubUnknownOutcomeError,
  GitHubConflictError,
  sanitizeMessage,
  sanitizeDetails,
  toStructuredGitHubError,
} from "../src/services/github/index.ts";

describe("Validation Gate & Branch Safety Rules", () => {
  test("identifies protected branches and rejects direct writes", () => {
    assert.equal(isProtectedBranch("main"), true);
    assert.equal(isProtectedBranch("master"), true);
    assert.equal(isProtectedBranch("refs/heads/main"), true);
    assert.equal(isProtectedBranch("production"), true);
    assert.equal(isProtectedBranch("prod"), true);
    assert.equal(isProtectedBranch("release/v1.0"), true);
    assert.equal(isProtectedBranch("release-candidate"), true);
    assert.equal(isProtectedBranch("omnisight/repair-job-1"), false);
    assert.equal(isProtectedBranch("feature/cart-fix"), false);

    assert.throws(
      () => assertNotProtectedBranch("main"),
      (err) => err instanceof ProtectedBranchError && err.branch === "main"
    );
    assert.throws(
      () => assertNotProtectedBranch("master"),
      (err) => err instanceof ProtectedBranchError
    );
    // Non-protected branches pass assertion without throwing
    assert.doesNotThrow(() => assertNotProtectedBranch("omnisight/repair-job-1"));
  });

  test("assertRepoNotArchived and assertWritePermission enforce mutation safety", () => {
    assert.doesNotThrow(() => assertRepoNotArchived(false, "Veggies02/OmniSight"));
    assert.throws(
      () => assertRepoNotArchived(true, "Veggies02/OmniSight"),
      (err) => err instanceof ArchivedRepositoryError && err.repository === "Veggies02/OmniSight"
    );

    assert.doesNotThrow(() => assertWritePermission(true, "Veggies02/OmniSight"));
    assert.throws(
      () => assertWritePermission(false, "Veggies02/OmniSight"),
      (err) => err instanceof InsufficientPermissionsError && err.repository === "Veggies02/OmniSight"
    );
  });

  test("validates branch names against strict git ref standards", () => {
    // Valid branch names
    assert.equal(validateBranchName("omnisight/repair-job-1083"), true);
    assert.equal(validateBranchName("feature/self-healing-v2"), true);
    assert.equal(validateBranchName("fix_nav_overflow"), true);

    // Invalid branch names
    assert.equal(validateBranchName(""), false);
    assert.equal(validateBranchName("ab"), false); // too short
    assert.equal(validateBranchName("branch with spaces"), false);
    assert.equal(validateBranchName("branch..dotdot"), false); // path traversal
    assert.equal(validateBranchName("/leading-slash"), false);
    assert.equal(validateBranchName("trailing-slash/"), false);
    assert.equal(validateBranchName("-leading-dash"), false);
    assert.equal(validateBranchName("branch.lock"), false);
    assert.equal(validateBranchName("branch~1"), false);
    assert.equal(validateBranchName("branch^2"), false);
    assert.equal(validateBranchName("branch:colon"), false);
    assert.equal(validateBranchName("branch?question"), false);
  });

  test("buildRepairBranchName constructs canonical, safe repair branch slugs", () => {
    assert.equal(sanitizeRefSlug("#JOB-1083!"), "job-1083");
    assert.equal(sanitizeRefSlug(""), "unknown");

    const branch = buildRepairBranchName("JOB-1083", "FND-001");
    assert.equal(branch, "omnisight/repair-job-1083-fnd-001");

    const withSuffix = buildRepairBranchName("JOB-1083", "FND-001", "retry");
    assert.equal(withSuffix, "omnisight/repair-job-1083-fnd-001-retry");

    // Cleans illegal characters in job/finding IDs
    const cleaned = buildRepairBranchName("#JOB/1083!@#", "FND 002");
    assert.equal(cleaned, "omnisight/repair-job-1083-fnd-002");
  });

  test("validateCommitMessage enforces length and sanitizes control characters", () => {
    assert.throws(() => validateCommitMessage("short"), /at least 10 characters/);
    assert.throws(() => validateCommitMessage(""), /non-empty string/);

    const validMsg = "fix(storefront): correct checkout button overlap on mobile viewports";
    const result = validateCommitMessage(validMsg);
    assert.equal(result, validMsg);
  });

  test("assertValidationPassed strictly enforces verified passage", () => {
    // 1. Missing validation
    assert.throws(() => assertValidationPassed(null), ValidationGateError);
    assert.throws(() => assertValidationPassed(undefined), ValidationGateError);

    // 2. Failed validation status
    assert.throws(
      () =>
        assertValidationPassed({
          status: "failed",
          totalChecks: 3,
          passedChecks: 2,
          failedChecks: 1,
        }),
      (err) => err instanceof ValidationGateError && err.message.includes("failed")
    );

    // 3. Pending/Running validation status
    assert.throws(
      () =>
        assertValidationPassed({
          status: "running",
          totalChecks: 3,
          passedChecks: 1,
          failedChecks: 0,
        }),
      (err) => err instanceof ValidationGateError
    );

    // 4. Needs review status
    assert.throws(
      () =>
        assertValidationPassed({
          status: "needs-review",
          totalChecks: 3,
          passedChecks: 2,
          failedChecks: 1,
        }),
      (err) => err instanceof ValidationGateError
    );

    // 5. Zero checks executed
    assert.throws(
      () =>
        assertValidationPassed({
          status: "passed",
          totalChecks: 0,
          passedChecks: 0,
          failedChecks: 0,
        }),
      (err) => err instanceof ValidationGateError && err.message.includes("Zero automated validation")
    );

    // 6. Valid pass
    assert.doesNotThrow(() =>
      assertValidationPassed({
        status: "passed",
        totalChecks: 4,
        passedChecks: 4,
        failedChecks: 0,
      })
    );
  });
});

describe("GitHubIntegrationService API Operations (Mocked)", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("getRepository fetches and parses repo metadata", async () => {
    globalThis.fetch = async (url) => {
      assert.ok(url.toString().includes("repos/octocat/Hello-World"));
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 1296269,
          name: "Hello-World",
          full_name: "octocat/Hello-World",
          owner: { login: "octocat" },
          default_branch: "main",
          private: false,
          archived: false,
          html_url: "https://github.com/octocat/Hello-World",
          description: "My first repository",
          permissions: { admin: true, push: true, pull: true },
        }),
      };
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    const repo = await service.getRepository("octocat", "Hello-World");

    assert.equal(repo.name, "Hello-World");
    assert.equal(repo.defaultBranch, "main");
    assert.equal(repo.isPrivate, false);
    assert.equal(repo.permissions?.push, true);
  });

  test("getRepository throws GitHubNotFoundError when repo does not exist", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      headers: new Headers(),
      json: async () => ({ message: "Not Found" }),
    });

    const service = new GitHubIntegrationService();
    await assert.rejects(
      async () => service.getRepository("octocat", "Non-Existent"),
      (err) => err instanceof GitHubNotFoundError && err.status === 404
    );
  });

  test("getBranch fetches branch info and commit SHA", async () => {
    globalThis.fetch = async (url) => {
      assert.ok(url.toString().includes("repos/octocat/Hello-World/branches/main"));
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          name: "main",
          commit: { sha: "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d" },
          protected: true,
        }),
      };
    };

    const service = new GitHubIntegrationService();
    const branch = await service.getBranch("octocat", "Hello-World", "main");

    assert.equal(branch.name, "main");
    assert.equal(branch.commitSha, "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d");
    assert.equal(branch.isProtected, true);
  });

  test("prepareRepairBranch enforces validation gate before API calls", async () => {
    const service = new GitHubIntegrationService();

    await assert.rejects(
      async () =>
        service.prepareRepairBranch({
          owner: "octocat",
          repo: "Hello-World",
          jobId: "JOB-1083",
          findingId: "FND-001",
          validation: {
            status: "failed",
            totalChecks: 3,
            passedChecks: 1,
            failedChecks: 2,
          },
        }),
      (err) => err instanceof ValidationGateError
    );
  });

  test("prepareRepairBranch idempotently handles existing branch vs creating new ref", async () => {
    let refsCreated = 0;

    globalThis.fetch = async (url, options) => {
      const urlStr = url.toString();

      // Base branch main query
      if (urlStr.endsWith("/branches/main")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "main",
            commit: { sha: "base_sha_12345" },
            protected: true,
          }),
        };
      }

      // Repo metadata query (for permission & archive verification)
      if (urlStr.endsWith("/repos/octocat/Hello-World")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "Hello-World",
            full_name: "octocat/Hello-World",
            archived: false,
            permissions: { admin: true, push: true, pull: true },
          }),
        };
      }

      // Repair branch query (simulate 404 on first check, so it creates)
      if (urlStr.includes("/branches/omnisight%2Frepair-job-1083-fnd-001")) {
        return {
          ok: false,
          status: 404,
          headers: new Headers(),
          json: async () => ({ message: "Branch not found" }),
        };
      }

      // Create git ref
      if (urlStr.endsWith("/git/refs") && options.method === "POST") {
        refsCreated++;
        const body = JSON.parse(options.body);
        assert.equal(body.ref, "refs/heads/omnisight/repair-job-1083-fnd-001");
        assert.equal(body.sha, "base_sha_12345");
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({
            ref: body.ref,
            object: { sha: "base_sha_12345", url: "https://api.github.com/ref" },
          }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "fake_token" });
    const result = await service.prepareRepairBranch({
      owner: "octocat",
      repo: "Hello-World",
      jobId: "JOB-1083",
      findingId: "FND-001",
      validation: {
        status: "passed",
        totalChecks: 2,
        passedChecks: 2,
        failedChecks: 0,
      },
    });

    assert.equal(result.branchName, "omnisight/repair-job-1083-fnd-001");
    assert.equal(result.created, true);
    assert.equal(result.baseCommitSha, "base_sha_12345");
    assert.equal(refsCreated, 1);
  });

  test("prepareRepairCommit enforces validation gate and refuses commits to protected branch", async () => {
    const service = new GitHubIntegrationService();

    // 1. Validation gate check
    await assert.rejects(
      async () =>
        service.prepareRepairCommit({
          owner: "octocat",
          repo: "Hello-World",
          branch: "omnisight/repair-job-1",
          jobId: "JOB-1",
          findingId: "FND-1",
          commitMessage: "fix(css): adjust padding on mobile viewport",
          changes: [{ path: "src/style.css", content: ".box { padding: 8px; }" }],
          validation: {
            status: "running",
            totalChecks: 2,
            passedChecks: 0,
            failedChecks: 0,
          },
        }),
      ValidationGateError
    );

    // 2. Refuses direct commit to main branch
    await assert.rejects(
      async () =>
        service.prepareRepairCommit({
          owner: "octocat",
          repo: "Hello-World",
          branch: "main",
          jobId: "JOB-1",
          findingId: "FND-1",
          commitMessage: "fix(css): adjust padding on mobile viewport",
          changes: [{ path: "src/style.css", content: ".box { padding: 8px; }" }],
          validation: {
            status: "passed",
            totalChecks: 2,
            passedChecks: 2,
            failedChecks: 0,
          },
        }),
      ProtectedBranchError
    );
  });

  test("prepareRepairCommit creates git tree, commit, and updates ref", async () => {
    let treeCreated = false;
    let commitCreated = false;
    let refUpdated = false;

    globalThis.fetch = async (url, options) => {
      const urlStr = url.toString();

      // Branch HEAD query
      if (urlStr.includes("/branches/omnisight%2Frepair-job-1")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "omnisight/repair-job-1",
            commit: { sha: "parent_sha_999" },
          }),
        };
      }

      // Repo metadata query (for permission & archive verification)
      if (urlStr.endsWith("/repos/octocat/Hello-World")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "Hello-World",
            full_name: "octocat/Hello-World",
            archived: false,
            permissions: { admin: true, push: true, pull: true },
          }),
        };
      }

      // Create Tree
      if (urlStr.endsWith("/git/trees") && options.method === "POST") {
        treeCreated = true;
        const body = JSON.parse(options.body);
        assert.equal(body.base_tree, "parent_sha_999");
        assert.equal(body.tree.length, 1);
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({ sha: "new_tree_sha_888" }),
        };
      }

      // Create Commit
      if (urlStr.endsWith("/git/commits") && options.method === "POST") {
        commitCreated = true;
        const body = JSON.parse(options.body);
        assert.equal(body.tree, "new_tree_sha_888");
        assert.deepEqual(body.parents, ["parent_sha_999"]);
        assert.ok(body.message.includes("OmniSight-Job-ID: JOB-1"));
        assert.ok(body.message.includes("OmniSight-Validated: true"));
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({
            sha: "new_commit_sha_777",
            html_url: "https://github.com/octocat/Hello-World/commit/777",
          }),
        };
      }

      // Update Ref
      if (urlStr.includes("/git/refs/heads/omnisight/repair-job-1") && options.method === "PATCH") {
        refUpdated = true;
        const body = JSON.parse(options.body);
        assert.equal(body.sha, "new_commit_sha_777");
        assert.equal(body.force, false);
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ object: { sha: "new_commit_sha_777" } }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    const result = await service.prepareRepairCommit({
      owner: "octocat",
      repo: "Hello-World",
      branch: "omnisight/repair-job-1",
      jobId: "JOB-1",
      findingId: "FND-1",
      commitMessage: "fix(css): adjust padding on mobile viewport",
      changes: [{ path: "src/style.css", content: ".box { padding: 8px; }" }],
      validation: {
        status: "passed",
        totalChecks: 3,
        passedChecks: 3,
        failedChecks: 0,
      },
    });

    assert.equal(treeCreated, true);
    assert.equal(commitCreated, true);
    assert.equal(refUpdated, true);
    assert.equal(result.commitSha, "new_commit_sha_777");
    assert.equal(result.parentSha, "parent_sha_999");
  });

  test("buildDraftPullRequestPayload enforces draft: true and validation gates", () => {
    const service = new GitHubIntegrationService();

    // 1. Validation gate assertion
    assert.throws(
      () =>
        service.buildDraftPullRequestPayload({
          jobId: "JOB-1083",
          findingId: "FND-001",
          defectCategory: "mobile_button_clipping",
          defectTitle: "Checkout button clipped on 390px viewport",
          headBranch: "omnisight/repair-job-1083-fnd-001",
          baseBranch: "main",
          validation: {
            status: "failed",
            totalChecks: 3,
            passedChecks: 1,
            failedChecks: 2,
          },
        }),
      ValidationGateError
    );

    // 2. Successful draft PR payload
    const payload = service.buildDraftPullRequestPayload({
      jobId: "JOB-1083",
      findingId: "FND-001",
      defectCategory: "mobile_button_clipping",
      defectTitle: "Checkout button clipped on 390px viewport",
      defectDescription: "Padding overflow caused CTA to clip on iPhone 12",
      repairedComponent: "src/components/Checkout.tsx",
      headBranch: "omnisight/repair-job-1083-fnd-001",
      baseBranch: "main",
      validation: {
        status: "passed",
        totalChecks: 3,
        passedChecks: 3,
        failedChecks: 0,
        verifiedAt: "2026-10-24T00:00:00Z",
      },
      evidenceUris: {
        baselineUri: "/evidence/baseline.png",
        defectiveUri: "/evidence/defective.png",
      },
    });

    assert.equal(payload.draft, true); // STRICT SAFETY INVARIANT
    assert.equal(payload.base, "main");
    assert.equal(payload.head, "omnisight/repair-job-1083-fnd-001");
    assert.ok(payload.title.includes("mobile_button_clipping"));
    assert.ok(payload.body.includes("#JOB-1083"));
    assert.ok(payload.body.includes("100% pass rate"));
    assert.ok(payload.body.includes("DRAFT"));
  });

  test("handles GitHub rate limit response with reset timestamp", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      headers: new Headers({
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1730000000",
      }),
      json: async () => ({ message: "API rate limit exceeded" }),
    });

    const service = new GitHubIntegrationService();

    await assert.rejects(
      async () => service.getRepository("octocat", "Hello-World"),
      (err) => {
        assert.ok(err instanceof GitHubRateLimitError);
        assert.equal(err.status, 429);
        assert.ok(err.resetAt instanceof Date);
        return true;
      }
    );
  });

  test("handles 401 Unauthorized with structured GitHubAuthenticationError", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ message: "Bad credentials" }),
    });

    const service = new GitHubIntegrationService();

    await assert.rejects(
      async () => service.getRepository("octocat", "Hello-World"),
      (err) => err instanceof GitHubAuthenticationError && err.status === 401
    );
  });

  test("sanitizes details by redacting GitHub tokens and secrets", () => {
    const sensitive = {
      token: "ghp_1234567890abcdef1234567890abcdef",
      nested: {
        authorization: "Bearer ghp_secretToken12345",
        normalField: "public-value",
      },
    };

    const sanitized = sanitizeDetails(sensitive);
    const serialized = JSON.stringify(sanitized);

    assert.ok(!serialized.includes("ghp_1234567890abcdef"));
    assert.ok(!serialized.includes("ghp_secretToken12345"));
    assert.ok(serialized.includes("[REDACTED]"));
    assert.ok(serialized.includes("public-value"));
  });
});

describe("Authentication & Repository Permission Auditing", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("assertTargetRepoAllowed blocks repos not in allowlist", () => {
    const allowlist = ["Veggies02/OmniSight"];

    assert.doesNotThrow(() => assertTargetRepoAllowed("Veggies02/OmniSight", allowlist));
    assert.doesNotThrow(() => assertTargetRepoAllowed("veggies02/omnisight", allowlist)); // case insensitive

    assert.throws(
      () => assertTargetRepoAllowed("other-org/malicious-repo", allowlist),
      (err) => err instanceof RepositoryNotAllowedError && err.repository === "other-org/malicious-repo"
    );
  });

  test("verifyRepositoryAccess reports MISSING_CREDENTIALS when token is absent", async () => {
    const service = new GitHubIntegrationService({ token: undefined });
    const report = await service.verifyRepositoryAccess("Veggies02", "OmniSight");

    assert.equal(report.authenticated, false);
    assert.equal(report.permissions.canWrite, false);
    assert.equal(report.permissions.hasRequiredPermissions, false);
    assert.equal(report.error?.code, "MISSING_CREDENTIALS");
    assert.ok(report.error?.help.includes("GITHUB_TOKEN"));
  });

  test("verifyRepositoryAccess reports REPO_NOT_ALLOWED when target repo is outside allowlist", async () => {
    const service = new GitHubIntegrationService({
      token: "test_token",
      allowedRepositories: ["Veggies02/OmniSight"],
    });

    const report = await service.verifyRepositoryAccess("UnauthorizedOrg", "UnapprovedRepo");

    assert.equal(report.isTargetRepoAllowed, false);
    assert.equal(report.permissions.hasRequiredPermissions, false);
    assert.equal(report.error?.code, "REPO_NOT_ALLOWED");
  });

  test("verifyRepositoryAccess detects read-only token vs write token", async () => {
    globalThis.fetch = async (url) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "x-oauth-scopes": "repo:read" }),
          json: async () => ({ login: "qa-auditor", id: 101, type: "User" }),
        };
      }
      if (urlStr.includes("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 999,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            owner: { login: "Veggies02" },
            default_branch: "main",
            private: false,
            archived: false,
            permissions: { admin: false, push: false, pull: true }, // READ-ONLY!
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "read_only_token" });
    const report = await service.verifyRepositoryAccess("Veggies02", "OmniSight");

    assert.equal(report.authenticated, true);
    assert.equal(report.identity?.login, "qa-auditor");
    assert.equal(report.permissions.canRead, true);
    assert.equal(report.permissions.canWrite, false); // READ-ONLY DETECTED
    assert.equal(report.permissions.hasRequiredPermissions, false);
    assert.equal(report.error?.code, "INSUFFICIENT_PERMISSIONS");
  });

  test("verifyRepositoryAccess confirms full read and write access", async () => {
    globalThis.fetch = async (url) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "x-oauth-scopes": "repo" }),
          json: async () => ({ login: "omnisight-bot", id: 202, type: "Bot" }),
        };
      }
      if (urlStr.includes("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 999,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            owner: { login: "Veggies02" },
            default_branch: "main",
            private: false,
            archived: false,
            permissions: { admin: true, push: true, pull: true }, // FULL WRITE!
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "read_write_token" });
    const report = await service.verifyRepositoryAccess("Veggies02", "OmniSight");

    assert.equal(report.authenticated, true);
    assert.equal(report.identity?.login, "omnisight-bot");
    assert.equal(report.permissions.canRead, true);
    assert.equal(report.permissions.canWrite, true);
    assert.equal(report.permissions.hasRequiredPermissions, true);
    assert.equal(report.error, undefined);
  });

  test("verifyRepositoryAccess flags archived repositories and prevents mutations", async () => {
    globalThis.fetch = async (url) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ login: "developer", id: 303, type: "User" }),
        };
      }
      if (urlStr.includes("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 999,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            owner: { login: "Veggies02" },
            default_branch: "main",
            private: false,
            archived: true, // ARCHIVED!
            permissions: { admin: true, push: true, pull: true },
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    const report = await service.verifyRepositoryAccess("Veggies02", "OmniSight");

    assert.equal(report.repository?.isArchived, true);
    assert.equal(report.permissions.hasRequiredPermissions, false);
    assert.equal(report.error?.code, "REPO_ARCHIVED");
  });

  test("prepareRepairBranch rejects when token lacks write permission", async () => {
    globalThis.fetch = async (url) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/branches/main")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "main",
            commit: { sha: "base_sha_123" },
            protected: true,
          }),
        };
      }
      if (urlStr.includes("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            archived: false,
            permissions: { admin: false, push: false, pull: true }, // Lacks push!
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "read_only_token" });

    await assert.rejects(
      async () =>
        service.prepareRepairBranch({
          owner: "Veggies02",
          repo: "OmniSight",
          jobId: "JOB-1083",
          findingId: "FND-001",
          validation: {
            status: "passed",
            totalChecks: 2,
            passedChecks: 2,
            failedChecks: 0,
          },
        }),
      (err) => err instanceof InsufficientPermissionsError && err.status === 403
    );
  });
});

describe("Repair Branch & Commit Workflow Orchestration", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("validateRepairFilePath permits safe paths and blocks path traversal and forbidden dirs", () => {
    // Permitted paths
    assert.equal(validateRepairFilePath("src/pages/Cart.tsx"), "src/pages/Cart.tsx");
    assert.equal(validateRepairFilePath("src/components/Button.css"), "src/components/Button.css");
    assert.equal(validateRepairFilePath("package.json"), "package.json");

    // Path traversal
    assert.throws(
      () => validateRepairFilePath("../secret/passwords.ts"),
      (err) => err instanceof UnsafeFilePathError && err.reason.includes("Path traversal")
    );
    assert.throws(
      () => validateRepairFilePath("src/../../etc/passwd.ts"),
      UnsafeFilePathError
    );

    // Forbidden directories
    assert.throws(
      () => validateRepairFilePath(".git/config.json"),
      (err) => err instanceof UnsafeFilePathError && err.reason.includes("protected directory")
    );
    assert.throws(
      () => validateRepairFilePath("node_modules/react/index.js"),
      UnsafeFilePathError
    );

    // Disallowed extensions (e.g. binaries, images)
    assert.throws(
      () => validateRepairFilePath("src/assets/hero.png"),
      (err) => err instanceof UnsafeFilePathError && err.reason.includes("File extension not permitted")
    );
    assert.throws(
      () => validateRepairFilePath("bin/script.exe"),
      UnsafeFilePathError
    );
  });

  test("validateRepairFileChanges rejects empty diff or duplicate paths", () => {
    assert.throws(() => validateRepairFileChanges([]), EmptyRepairDiffError);

    assert.throws(
      () =>
        validateRepairFileChanges([
          { path: "src/style.css", content: "body { margin: 0; }" },
          { path: "src/style.css", content: "body { margin: 8px; }" },
        ]),
      (err) => err instanceof UnsafeFilePathError && err.reason.includes("Duplicate file path")
    );
  });

  test("executeRepairWorkflow halts immediately if validation status is not passed", async () => {
    const service = new GitHubIntegrationService({ token: "test_token" });

    await assert.rejects(
      async () =>
        service.executeRepairWorkflow({
          jobId: "JOB-1084",
          findingId: "DEF-201",
          targetRepository: "Veggies02/OmniSight",
          validation: {
            status: "failed",
            totalChecks: 3,
            passedChecks: 1,
            failedChecks: 2,
          },
          changes: [{ path: "src/pages/Checkout.tsx", content: "// fix" }],
        }),
      (err) => err instanceof ValidationGateError
    );
  });

  test("executeRepairWorkflow successfully orchestrates branch, commit, and verification", async () => {
    let branchCreated = false;
    let commitCreated = false;

    globalThis.fetch = async (url, options) => {
      const urlStr = url.toString();

      // Check current user identity
      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "x-oauth-scopes": "repo" }),
          json: async () => ({ login: "omnisight-bot", id: 100, type: "Bot" }),
        };
      }

      // Check repo metadata & permissions
      if (urlStr.includes("/repos/Veggies02/OmniSight") && !urlStr.includes("/branches") && !urlStr.includes("/git")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 12345,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            owner: { login: "Veggies02" },
            default_branch: "main",
            archived: false,
            permissions: { admin: true, push: true, pull: true },
          }),
        };
      }

      // Check main base branch
      if (urlStr.endsWith("/branches/main")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "main",
            commit: { sha: "base_sha_abc123" },
            protected: true,
          }),
        };
      }

      // Check repair branch (first check returns 404, triggers create)
      if (urlStr.includes("/branches/omnisight%2Frepair-job-1083-def-188")) {
        if (!branchCreated) {
          return {
            ok: false,
            status: 404,
            headers: new Headers(),
            json: async () => ({ message: "Branch not found" }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "omnisight/repair-job-1083-def-188",
            commit: { sha: "base_sha_abc123" },
          }),
        };
      }

      // Create branch git ref
      if (urlStr.endsWith("/git/refs") && options.method === "POST") {
        branchCreated = true;
        const body = JSON.parse(options.body);
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({
            ref: body.ref,
            object: { sha: "base_sha_abc123", url: "https://api.github.com/refs/1" },
          }),
        };
      }

      // Create tree
      if (urlStr.endsWith("/git/trees") && options.method === "POST") {
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({ sha: "tree_sha_xyz" }),
        };
      }

      // Create commit
      if (urlStr.endsWith("/git/commits") && options.method === "POST") {
        commitCreated = true;
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({
            sha: "commit_sha_def456",
            html_url: "https://github.com/Veggies02/OmniSight/commit/def456",
          }),
        };
      }

      // Update branch ref
      if (urlStr.includes("/git/refs/heads/omnisight/repair-job-1083-def-188") && options.method === "PATCH") {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ object: { sha: "commit_sha_def456" } }),
        };
      }

      throw new Error(`Unexpected fetch URL in test: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    const result = await service.executeRepairWorkflow({
      jobId: "JOB-1083",
      findingId: "DEF-188",
      targetRepository: "Veggies02/OmniSight",
      baseBranch: "main",
      validation: {
        status: "passed",
        totalChecks: 3,
        passedChecks: 3,
        failedChecks: 0,
      },
      changes: [
        {
          path: "src/pages/Cart.tsx",
          content: "// Repaired contrast ratio for checkout CTA",
        },
      ],
    });

    assert.equal(result.status, "success");
    assert.equal(result.branch, "omnisight/repair-job-1083-def-188");
    assert.equal(result.commitSha, "commit_sha_def456");
    assert.equal(result.changedFilesCount, 1);
    assert.equal(result.changedPaths[0], "src/pages/Cart.tsx");
    assert.equal(branchCreated, true);
    assert.equal(commitCreated, true);
  });
});

describe("GitHub Draft Pull Request Creation Workflow", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("assertDifferentBranches and assertConfirmedRepairCommit enforce PR preconditions", () => {
    // assertDifferentBranches
    assert.doesNotThrow(() => assertDifferentBranches("omnisight/repair-1", "main"));
    assert.throws(
      () => assertDifferentBranches("main", "main"),
      (err) => err instanceof BranchMismatchError
    );
    assert.throws(
      () => assertDifferentBranches("refs/heads/main", "main"),
      (err) => err instanceof BranchMismatchError
    );
    assert.throws(
      () => assertDifferentBranches("", "main"),
      (err) => err instanceof BranchMismatchError
    );

    // assertConfirmedRepairCommit
    assert.equal(assertConfirmedRepairCommit("commit_sha_1234567"), "commit_sha_1234567");
    assert.equal(assertConfirmedRepairCommit("abcdef0"), "abcdef0");
    assert.throws(
      () => assertConfirmedRepairCommit(""),
      (err) => err instanceof MissingRepairCommitError
    );
    assert.throws(
      () => assertConfirmedRepairCommit(undefined),
      (err) => err instanceof MissingRepairCommitError
    );
    assert.throws(
      () => assertConfirmedRepairCommit("not-a-sha!@#"),
      (err) => err instanceof MissingRepairCommitError
    );

    // DuplicatePullRequestError
    const dupErr = new DuplicatePullRequestError("omnisight/repair-1", "main", 42, "https://github.com/pr/42");
    assert.equal(dupErr.existingPrNumber, 42);
    assert.equal(dupErr.existingPrUrl, "https://github.com/pr/42");
    assert.equal(dupErr.status, 409);
  });

  test("successfully creates a draft pull request with verified validation and human-review gates", async () => {
    let prPostedBody = null;

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      // Verify repo access
      if (urlStr.endsWith("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 1234,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            default_branch: "main",
            archived: false,
            private: false,
            permissions: { admin: false, push: true, pull: true },
          }),
        };
      }

      // Identity check
      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "x-oauth-scopes": "repo" }),
          json: async () => ({ login: "omnisight-bot", id: 999, type: "User" }),
        };
      }

      // Check repair branch exists
      if (urlStr.includes("/branches/omnisight%2Frepair-job-1083-def-188")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "omnisight/repair-job-1083-def-188",
            commit: { sha: "commit_sha_def456" },
          }),
        };
      }

      // Check existing open PRs (returns empty array = none found)
      if (urlStr.includes("/pulls?state=open")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => [],
        };
      }

      // POST create PR
      if (urlStr.endsWith("/pulls") && options.method === "POST") {
        prPostedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({
            number: 42,
            html_url: "https://github.com/Veggies02/OmniSight/pull/42",
            title: prPostedBody.title,
            state: "open",
            draft: true,
            merged: false,
            created_at: "2026-10-30T10:00:00Z",
            head: { ref: "omnisight/repair-job-1083-def-188", sha: "commit_sha_def456" },
            base: { ref: "main", sha: "base_sha_abc123" },
            user: { login: "omnisight-bot" },
          }),
        };
      }

      throw new Error(`Unexpected fetch URL in test: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    const result = await service.createDraftPullRequest({
      jobId: "JOB-1083",
      findingId: "DEF-188",
      headBranch: "omnisight/repair-job-1083-def-188",
      headCommitSha: "commit_sha_def456",
      baseBranch: "main",
      targetRepository: "Veggies02/OmniSight",
      defectCategory: "Contrast",
      defectTitle: "Fix checkout CTA contrast",
      validation: {
        status: "passed",
        totalChecks: 3,
        passedChecks: 3,
        failedChecks: 0,
        verifiedAt: "2026-10-30T09:55:00Z",
      },
    });

    assert.equal(result.prNumber, 42);
    assert.equal(result.prUrl, "https://github.com/Veggies02/OmniSight/pull/42");
    assert.equal(result.sourceBranch, "omnisight/repair-job-1083-def-188");
    assert.equal(result.baseBranch, "main");
    assert.equal(result.status, "draft");
    assert.equal(result.isDraft, true);
    assert.equal(result.merged, false);
    assert.equal(result.existing, false);
    assert.equal(result.author, "omnisight-bot");

    // Invariant check on API request payload:
    assert.ok(prPostedBody);
    assert.equal(prPostedBody.draft, true); // Strict requirement: must always be draft
    assert.equal(prPostedBody.head, "omnisight/repair-job-1083-def-188");
    assert.equal(prPostedBody.base, "main");
    assert.ok(prPostedBody.title.includes("[OmniSight Self-Healing]"));
    assert.ok(prPostedBody.body.includes("OmniSight Automated UI Repair"));
    assert.ok(prPostedBody.body.includes("PASSED"));
    assert.ok(prPostedBody.body.includes("⚠️ **OmniSight Review Gate:**"));
  });

  test("halts immediately if validation failed, pending, missing, or has test regressions", async () => {
    const service = new GitHubIntegrationService({ token: "test_token" });

    // Missing validation
    await assert.rejects(
      async () =>
        service.createDraftPullRequest({
          jobId: "JOB-1083",
          headBranch: "omnisight/repair-job-1083",
          headCommitSha: "commit_sha_def456",
          validation: null,
        }),
      (err) => err instanceof ValidationGateError
    );

    // Failed validation
    await assert.rejects(
      async () =>
        service.createDraftPullRequest({
          jobId: "JOB-1083",
          headBranch: "omnisight/repair-job-1083",
          headCommitSha: "commit_sha_def456",
          validation: { status: "failed", totalChecks: 3, passedChecks: 2, failedChecks: 1 },
        }),
      (err) => err instanceof ValidationGateError
    );

    // Pending validation
    await assert.rejects(
      async () =>
        service.createDraftPullRequest({
          jobId: "JOB-1083",
          headBranch: "omnisight/repair-job-1083",
          headCommitSha: "commit_sha_def456",
          validation: { status: "pending", totalChecks: 3, passedChecks: 0, failedChecks: 0 },
        }),
      (err) => err instanceof ValidationGateError
    );

    // Zero checks executed
    await assert.rejects(
      async () =>
        service.createDraftPullRequest({
          jobId: "JOB-1083",
          headBranch: "omnisight/repair-job-1083",
          headCommitSha: "commit_sha_def456",
          validation: { status: "passed", totalChecks: 0, passedChecks: 0, failedChecks: 0 },
        }),
      (err) => err instanceof ValidationGateError
    );
  });

  test("rejects missing commit information, empty branch, or source branch identical to base", async () => {
    const service = new GitHubIntegrationService({ token: "test_token" });
    const passedValidation = { status: "passed", totalChecks: 2, passedChecks: 2, failedChecks: 0 };

    // Missing headCommitSha
    await assert.rejects(
      async () =>
        service.createDraftPullRequest({
          jobId: "JOB-1083",
          headBranch: "omnisight/repair-1",
          headCommitSha: "",
          validation: passedValidation,
        }),
      (err) => err instanceof MissingRepairCommitError
    );

    // Protected branch as source
    await assert.rejects(
      async () =>
        service.createDraftPullRequest({
          jobId: "JOB-1083",
          headBranch: "main",
          headCommitSha: "commit_sha_def456",
          baseBranch: "main",
          validation: passedValidation,
        }),
      (err) => err instanceof ProtectedBranchError
    );

    // Head branch equals base branch
    await assert.rejects(
      async () =>
        service.createDraftPullRequest({
          jobId: "JOB-1083",
          headBranch: "feature/cart-repair",
          baseBranch: "feature/cart-repair",
          headCommitSha: "commit_sha_def456",
          validation: passedValidation,
        }),
      (err) => err instanceof BranchMismatchError
    );
  });

  test("rejects PR creation when GitHub permissions are insufficient or repository is archived", async () => {
    // Insufficient permissions
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 1234,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            default_branch: "main",
            archived: false,
            permissions: { push: false, pull: true }, // Read-only
          }),
        };
      }
      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ login: "read-only-user", id: 101 }),
        };
      }
      throw new Error(`Unexpected fetch: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    await assert.rejects(
      async () =>
        service.createDraftPullRequest({
          jobId: "JOB-1083",
          headBranch: "omnisight/repair-job-1083",
          headCommitSha: "commit_sha_def456",
          validation: { status: "passed", totalChecks: 2, passedChecks: 2, failedChecks: 0 },
        }),
      (err) => err instanceof InsufficientPermissionsError || err.kind === "INSUFFICIENT_PERMISSIONS"
    );

    // Archived repository
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 1234,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            default_branch: "main",
            archived: true, // Archived repo
            permissions: { push: true, pull: true },
          }),
        };
      }
      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ login: "bot", id: 101 }),
        };
      }
      throw new Error(`Unexpected fetch: ${urlStr}`);
    };

    await assert.rejects(
      async () =>
        service.createDraftPullRequest({
          jobId: "JOB-1083",
          headBranch: "omnisight/repair-job-1083",
          headCommitSha: "commit_sha_def456",
          validation: { status: "passed", totalChecks: 2, passedChecks: 2, failedChecks: 0 },
        }),
      (err) => err instanceof ArchivedRepositoryError || err.kind === "REPO_ARCHIVED"
    );
  });

  test("detects existing open PR and reuses details safely without duplicate submission (idempotent retry)", async () => {
    let postCallAttempted = false;

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      if (urlStr.endsWith("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 1234,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            default_branch: "main",
            archived: false,
            permissions: { push: true, pull: true },
          }),
        };
      }

      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ login: "bot", id: 101 }),
        };
      }

      if (urlStr.includes("/branches/omnisight%2Frepair-job-1083")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "omnisight/repair-job-1083",
            commit: { sha: "commit_sha_def456" },
          }),
        };
      }

      // Existing open PR found!
      if (urlStr.includes("/pulls?state=open")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => [
            {
              number: 88,
              html_url: "https://github.com/Veggies02/OmniSight/pull/88",
              title: "[OmniSight Self-Healing] Fix Cart Contrast",
              state: "open",
              draft: true,
              merged: false,
              created_at: "2026-10-29T12:00:00Z",
              head: { ref: "omnisight/repair-job-1083", sha: "commit_sha_def456" },
              base: { ref: "main", sha: "base_sha_abc123" },
              user: { login: "omnisight-bot" },
            },
          ],
        };
      }

      if (urlStr.endsWith("/pulls") && options.method === "POST") {
        postCallAttempted = true;
        throw new Error("POST /pulls should NOT be called when existing PR is found!");
      }

      throw new Error(`Unexpected fetch: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    const result = await service.createDraftPullRequest({
      jobId: "JOB-1083",
      headBranch: "omnisight/repair-job-1083",
      headCommitSha: "commit_sha_def456",
      baseBranch: "main",
      validation: { status: "passed", totalChecks: 2, passedChecks: 2, failedChecks: 0 },
    });

    assert.equal(result.prNumber, 88);
    assert.equal(result.existing, true); // Reused!
    assert.equal(result.isDraft, true);
    assert.equal(result.merged, false);
    assert.equal(postCallAttempted, false); // No duplicate POST request sent
  });

  test("recovers gracefully when GitHub API returns 422 duplicate PR race condition", async () => {
    let checkCount = 0;

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      if (urlStr.endsWith("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 1234,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            default_branch: "main",
            archived: false,
            permissions: { push: true, pull: true },
          }),
        };
      }

      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ login: "bot", id: 101 }),
        };
      }

      if (urlStr.includes("/branches/omnisight%2Frepair-job-1083")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "omnisight/repair-job-1083",
            commit: { sha: "commit_sha_def456" },
          }),
        };
      }

      // Initial check returns empty array; second check (after 422) returns existing PR
      if (urlStr.includes("/pulls?state=open")) {
        checkCount++;
        if (checkCount === 1) {
          return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => [
            {
              number: 95,
              html_url: "https://github.com/Veggies02/OmniSight/pull/95",
              title: "[OmniSight Self-Healing] Concurrent PR",
              state: "open",
              draft: true,
              merged: false,
              created_at: "2026-10-30T11:00:00Z",
              head: { ref: "omnisight/repair-job-1083", sha: "commit_sha_def456" },
              base: { ref: "main", sha: "base_sha_abc123" },
              user: { login: "omnisight-bot" },
            },
          ],
        };
      }

      // POST /pulls fails with HTTP 422 Validation Failed (duplicate PR)
      if (urlStr.endsWith("/pulls") && options.method === "POST") {
        return {
          ok: false,
          status: 422,
          headers: new Headers(),
          json: async () => ({
            message: "Validation Failed",
            errors: [{ message: "A pull request already exists for Veggies02:omnisight/repair-job-1083." }],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    const result = await service.createDraftPullRequest({
      jobId: "JOB-1083",
      headBranch: "omnisight/repair-job-1083",
      headCommitSha: "commit_sha_def456",
      baseBranch: "main",
      validation: { status: "passed", totalChecks: 2, passedChecks: 2, failedChecks: 0 },
    });

    assert.equal(result.prNumber, 95);
    assert.equal(result.existing, true);
    assert.equal(result.isDraft, true);
    assert.equal(result.merged, false);
  });

  test("strictly guarantees draft PR invariant and ensures workflow never merges automatically", async () => {
    let mergeCalled = false;

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      if (urlStr.includes("/merge")) {
        mergeCalled = true;
        throw new Error("AUTOMATED MERGE VIOLATION: Merge endpoint was invoked!");
      }

      if (urlStr.endsWith("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 1234,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            default_branch: "main",
            archived: false,
            permissions: { push: true, pull: true },
          }),
        };
      }

      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ login: "bot", id: 101 }),
        };
      }

      if (urlStr.includes("/branches/omnisight%2Frepair-job-1083")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "omnisight/repair-job-1083",
            commit: { sha: "commit_sha_def456" },
          }),
        };
      }

      if (urlStr.includes("/pulls?state=open")) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      }

      if (urlStr.endsWith("/pulls") && options.method === "POST") {
        const body = JSON.parse(options.body);
        assert.equal(body.draft, true); // Verified draft: true
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({
            number: 104,
            html_url: "https://github.com/Veggies02/OmniSight/pull/104",
            title: body.title,
            state: "open",
            draft: true,
            merged: false,
            created_at: "2026-10-30T11:00:00Z",
            head: { ref: "omnisight/repair-job-1083", sha: "commit_sha_def456" },
            base: { ref: "main", sha: "base_sha_abc123" },
            user: { login: "omnisight-bot" },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    const result = await service.createDraftPullRequest({
      jobId: "JOB-1083",
      headBranch: "omnisight/repair-job-1083",
      headCommitSha: "commit_sha_def456",
      baseBranch: "main",
      validation: { status: "passed", totalChecks: 2, passedChecks: 2, failedChecks: 0 },
    });

    assert.equal(result.isDraft, true);
    assert.equal(result.merged, false);
    assert.equal(mergeCalled, false);
  });
});

describe("Hardened GitHub Workflow Error Handling, Retries & Safety", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("structured error classification and secret redaction for PATs, tokens, and headers", () => {
    // 1. Auth error classification
    const authErr = new GitHubAuthenticationError();
    const structAuth = authErr.toStructuredError();
    assert.equal(structAuth.code, "AUTH_FAILED");
    assert.equal(structAuth.status, 401);
    assert.equal(structAuth.isRetryable, false);
    assert.equal(structAuth.outcome, "failed");

    // 2. Permission error classification
    const permErr = new InsufficientPermissionsError("Veggies02/OmniSight", "write");
    const structPerm = permErr.toStructuredError();
    assert.equal(structPerm.code, "PERMISSION_DENIED");
    assert.equal(structPerm.status, 403);
    assert.equal(structPerm.isRetryable, false);

    // 3. Validation gate error classification
    const valErr = new ValidationGateError("Validation failed with 2 errors");
    const structVal = valErr.toStructuredError();
    assert.equal(structVal.code, "VALIDATION_FAILED");
    assert.equal(structVal.status, 400);
    assert.equal(structVal.isRetryable, false);

    // 4. Rate limit error classification
    const rateErr = new GitHubRateLimitError(1700000000, "repos/foo/bar");
    const structRate = rateErr.toStructuredError();
    assert.equal(structRate.code, "RATE_LIMITED");
    assert.equal(structRate.status, 429);
    assert.equal(structRate.isRetryable, true);

    // 5. Timeout and service unavailable classification
    const timeoutErr = new GitHubTimeoutError("repos/foo/bar", 5000);
    const structTimeout = timeoutErr.toStructuredError();
    assert.equal(structTimeout.code, "TIMEOUT");
    assert.equal(structTimeout.status, 504);
    assert.equal(structTimeout.isRetryable, true);

    const serviceErr = new GitHubServiceUnavailableError(503, "High load");
    const structService = serviceErr.toStructuredError();
    assert.equal(structService.code, "SERVICE_UNAVAILABLE");
    assert.equal(structService.status, 503);
    assert.equal(structService.isRetryable, true);

    // 6. Unknown outcome error classification
    const unknownErr = new GitHubUnknownOutcomeError("Create branch");
    const structUnknown = unknownErr.toStructuredError();
    assert.equal(structUnknown.code, "OUTCOME_UNKNOWN");
    assert.equal(structUnknown.status, 504);
    assert.equal(structUnknown.isRetryable, false);
    assert.equal(structUnknown.outcome, "unknown");

    // 7. Conflict error classification
    const conflictErr = new GitHubConflictError("Branch conflict");
    const structConflict = conflictErr.toStructuredError();
    assert.equal(structConflict.code, "CONFLICT");
    assert.equal(structConflict.status, 409);
    assert.equal(structConflict.isRetryable, false);

    // 8. Secret redaction in messages
    const rawMsg = "Error connecting with ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 and Bearer gho_mysecret123456";
    const cleanedMsg = sanitizeMessage(rawMsg);
    assert.ok(!cleanedMsg.includes("ghp_ABC"));
    assert.ok(!cleanedMsg.includes("gho_mysecret"));
    assert.ok(cleanedMsg.includes("[REDACTED_GITHUB_TOKEN]"));
    assert.ok(cleanedMsg.includes("Bearer [REDACTED]"));

    // 8. Secret redaction in details
    const rawDetails = {
      token: "ghp_1234567890abcdef1234567890abcdef",
      headers: {
        Authorization: "Bearer gho_9876543210fedcba9876543210fedcba",
      },
    };
    const cleanedDetails = sanitizeDetails(rawDetails);
    assert.ok(!JSON.stringify(cleanedDetails).includes("ghp_1234"));
    assert.ok(!JSON.stringify(cleanedDetails).includes("gho_9876"));

    // 9. Generic unknown error normalization
    const genericErr = toStructuredGitHubError(new Error("Database connection dropped"));
    assert.equal(genericErr.code, "UNKNOWN_ERROR");
    assert.equal(genericErr.status, 500);
    assert.equal(genericErr.isRetryable, false);
  });

  test("transient failure retry with bounded attempts on read operations (502/503)", async () => {
    let callCount = 0;

    globalThis.fetch = async (url) => {
      callCount++;
      const urlStr = String(url);

      if (urlStr.includes("/branches/main")) {
        // Fail twice with transient 503, succeed on 3rd attempt
        if (callCount < 3) {
          return {
            ok: false,
            status: 503,
            headers: new Headers(),
            json: async () => ({ message: "Service Unavailable" }),
          };
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "main",
            commit: { sha: "abc1234" },
            protected: true,
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({
      token: "test_token",
      maxRetries: 2,
      retryDelayMs: 5, // Fast retry for tests
    });

    const branch = await service.getBranch("Veggies02", "OmniSight", "main");
    assert.equal(branch.name, "main");
    assert.equal(branch.commitSha, "abc1234");
    assert.equal(callCount, 3); // 1 initial + 2 retries
  });

  test("transient retry limit is bounded and permanent errors (401, 403, 404) are never retried", async () => {
    let callCount = 0;

    // 1. Transient 503 exhausts all bounded retries
    globalThis.fetch = async () => {
      callCount++;
      return {
        ok: false,
        status: 503,
        headers: new Headers(),
        json: async () => ({ message: "Temporary failure" }),
      };
    };

    const service = new GitHubIntegrationService({
      token: "test_token",
      maxRetries: 2,
      retryDelayMs: 5,
    });

    await assert.rejects(
      async () => service.getBranch("Veggies02", "OmniSight", "main"),
      (err) => err instanceof GitHubServiceUnavailableError && err.status === 503
    );
    assert.equal(callCount, 3); // Exhausted maxRetries

    // 2. Permanent 401 error is never retried (exits on attempt 1)
    callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return {
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({ message: "Bad credentials" }),
      };
    };

    await assert.rejects(
      async () => service.getBranch("Veggies02", "OmniSight", "main"),
      (err) => err instanceof GitHubAuthenticationError && err.status === 401
    );
    assert.equal(callCount, 1); // Exactly 1 attempt

    // 3. Permanent 404 error is never retried (exits on attempt 1)
    callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return {
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({ message: "Not found" }),
      };
    };

    await assert.rejects(
      async () => service.getBranch("Veggies02", "OmniSight", "missing-branch"),
      (err) => err instanceof GitHubNotFoundError && err.status === 404
    );
    assert.equal(callCount, 1); // Exactly 1 attempt
  });

  test("write operation timeout verifies GitHub branch state before blindly repeating", async () => {
    let branchExistsOnGitHub = false;

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      if (urlStr.endsWith("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 1,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            default_branch: "main",
            archived: false,
            permissions: { push: true, pull: true },
          }),
        };
      }

      if (urlStr.includes("/branches/main")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ name: "main", commit: { sha: "base_commit_123" } }),
        };
      }

      // Check repair branch
      if (urlStr.includes("/branches/omnisight%2Frepair-job-999-fnd-1")) {
        if (!branchExistsOnGitHub) {
          return { ok: false, status: 404, headers: new Headers(), json: async () => ({ message: "Not found" }) };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            name: "omnisight/repair-job-999-fnd-1",
            commit: { sha: "base_commit_123" },
            _links: { html: "https://github.com/Veggies02/OmniSight/tree/omnisight/repair-job-999-fnd-1" },
          }),
        };
      }

      // POST create git ref times out on network socket, but GitHub created the ref!
      if (urlStr.endsWith("/git/refs") && options.method === "POST") {
        branchExistsOnGitHub = true;
        const abortErr = new Error("The operation was aborted");
        abortErr.name = "AbortError";
        throw abortErr;
      }

      throw new Error(`Unexpected fetch: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    const result = await service.prepareRepairBranch({
      owner: "Veggies02",
      repo: "OmniSight",
      jobId: "JOB-999",
      findingId: "FND-1",
      validation: { status: "passed", totalChecks: 1, passedChecks: 1, failedChecks: 0 },
    });

    // Successfully recovered without blind duplicate write
    assert.equal(result.branchName, "omnisight/repair-job-999-fnd-1");
    assert.equal(result.created, true);
    assert.equal(result.exists, true);
  });

  test("write operation timeout verifies GitHub draft PR state before blindly repeating", async () => {
    let prExistsOnGitHub = false;

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      if (urlStr.endsWith("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 1,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            default_branch: "main",
            archived: false,
            permissions: { push: true, pull: true },
          }),
        };
      }

      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ login: "bot", id: 101 }),
        };
      }

      if (urlStr.includes("/branches/omnisight%2Frepair-job-999")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ name: "omnisight/repair-job-999", commit: { sha: "commit_abc1234" } }),
        };
      }

      if (urlStr.includes("/pulls?state=open")) {
        if (!prExistsOnGitHub) {
          return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => [
            {
              number: 77,
              html_url: "https://github.com/Veggies02/OmniSight/pull/77",
              title: "[OmniSight Self-Healing] Recovered PR",
              state: "open",
              draft: true,
              merged: false,
              created_at: "2026-10-30T10:00:00Z",
              head: { ref: "omnisight/repair-job-999", sha: "commit_abc1234" },
              base: { ref: "main", sha: "base_sha" },
              user: { login: "omnisight-bot" },
            },
          ],
        };
      }

      // POST /pulls times out, but PR was created on GitHub!
      if (urlStr.endsWith("/pulls") && options.method === "POST") {
        prExistsOnGitHub = true;
        const abortErr = new Error("The operation was aborted");
        abortErr.name = "AbortError";
        throw abortErr;
      }

      throw new Error(`Unexpected fetch: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    const result = await service.createDraftPullRequest({
      jobId: "JOB-999",
      headBranch: "omnisight/repair-job-999",
      headCommitSha: "commit_abc1234",
      baseBranch: "main",
      validation: { status: "passed", totalChecks: 1, passedChecks: 1, failedChecks: 0 },
    });

    // Successfully recovered existing PR on timeout without duplicate submission
    assert.equal(result.prNumber, 77);
    assert.equal(result.existing, true);
    assert.equal(result.isDraft, true);
    assert.equal(result.merged, false);
  });

  test("write operation timeout with unconfirmable outcome throws GitHubUnknownOutcomeError with outcome='unknown'", async () => {
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      if (urlStr.endsWith("/repos/Veggies02/OmniSight")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: 1,
            name: "OmniSight",
            full_name: "Veggies02/OmniSight",
            default_branch: "main",
            archived: false,
            permissions: { push: true, pull: true },
          }),
        };
      }

      if (urlStr.endsWith("/user")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ login: "bot", id: 101 }),
        };
      }

      if (urlStr.includes("/branches/omnisight%2Frepair-job-999")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ name: "omnisight/repair-job-999", commit: { sha: "commit_abc1234" } }),
        };
      }

      // Initial check before write shows no PR
      if (urlStr.includes("/pulls?state=open") && !options.method) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      }

      // POST /pulls times out
      if (urlStr.endsWith("/pulls") && options.method === "POST") {
        const abortErr = new Error("The operation was aborted");
        abortErr.name = "AbortError";
        throw abortErr;
      }

      throw new Error(`Unexpected fetch: ${urlStr}`);
    };

    const service = new GitHubIntegrationService({ token: "test_token" });
    await assert.rejects(
      async () =>
        service.createDraftPullRequest({
          jobId: "JOB-999",
          headBranch: "omnisight/repair-job-999",
          headCommitSha: "commit_abc1234",
          baseBranch: "main",
          validation: { status: "passed", totalChecks: 1, passedChecks: 1, failedChecks: 0 },
        }),
      (err) =>
        err instanceof GitHubUnknownOutcomeError &&
        err.outcome === "unknown" &&
        err.isRetryable === false &&
        err.code === "OUTCOME_UNKNOWN"
    );
  });
});


