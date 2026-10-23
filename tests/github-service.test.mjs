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
  sanitizeRefSlug,
  validateBranchName,
  buildRepairBranchName,
  validateCommitMessage,
  ValidationGateError,
  ProtectedBranchError,
  InsufficientPermissionsError,
  RepositoryNotAllowedError,
  ArchivedRepositoryError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubAuthenticationError,
  sanitizeDetails,
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

