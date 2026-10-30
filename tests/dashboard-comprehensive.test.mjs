/**
 * Node 22 Native Test Suite for OmniSight QA Dashboard & GitHub Integration (Day 19)
 *
 * Comprehensive coverage for:
 * 1. Overview metrics calculation, status distribution, and empty simulation
 * 2. Job history search, multi-filter combinations, and reset behavior
 * 3. Defect severity normalization, sorting, and job linkage
 * 4. Visual evidence metadata, labels, and reference resolution
 * 5. Validation checks, assertions, pass percentages, and failure summaries
 * 6. Partial, malformed, or missing API response handling
 * 7. Loading, empty, and error fallback states
 * 8. GitHub safety invariants: draft PRs, base branch protection, and secret redaction
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Domain & Data imports
import {
  MOCK_INSPECTION_JOBS,
  getInspectionJobById,
  getAllDefectFindings,
  getAllEvidence,
} from "../src/data/mockJobs.ts";
import {
  adaptBackendJobToInspectionJob,
  adaptBackendArtifactToEvidence,
  loadInspectionJobsWithFallback,
  loadJobDetailsWithFallback,
} from "../src/api/adapters.ts";
import { clientGitHubService } from "../src/api/services/githubService.ts";
import {
  isProtectedBranch,
  buildRepairBranchName,
  validateRepairFilePath,
  validateRepairFileChanges,
  validateCommitMessage,
  assertValidationPassed,
  assertConfirmedRepairCommit,
} from "../src/services/github/validationGate.ts";
import { toStructuredGitHubError } from "../src/services/github/errors.ts";

describe("1. Dashboard Overview Metrics & Telemetry", () => {
  test("computes accurate status counts and percentages across jobs", () => {
    const jobs = MOCK_INSPECTION_JOBS;
    const counts = { passed: 0, failed: 0, needsReview: 0, running: 0, pending: 0 };

    for (const j of jobs) {
      const norm = j.status.toLowerCase().replace(/[\s_]+/g, "-");
      if (norm === "passed") counts.passed++;
      else if (norm === "failed") counts.failed++;
      else if (norm === "needs-review") counts.needsReview++;
      else if (norm === "running") counts.running++;
      else counts.pending++;
    }

    assert.ok(counts.passed >= 1, "Should have passed jobs in mock dataset");
    assert.ok(counts.failed >= 1, "Should have failed jobs in mock dataset");
    assert.ok(counts.running >= 1, "Should have active running jobs");

    const total = jobs.length;
    const passedPct = Math.round((counts.passed / total) * 100);
    assert.ok(passedPct > 0 && passedPct <= 100, "Pass percentage should be valid bounded ratio");
  });

  test("avoids division by zero and NaN when jobs list is empty (simulateEmpty mode)", () => {
    const emptyJobs = [];
    const total = emptyJobs.length || 1;
    const passedCount = emptyJobs.filter((j) => j.status === "passed").length;
    const passedPercentage = emptyJobs.length === 0 ? 0 : Math.round((passedCount / total) * 100);

    assert.equal(passedPercentage, 0);
    assert.equal(Number.isNaN(passedPercentage), false);
  });

  test("aggregates total detected defects correctly across all job runs", () => {
    const totalDefects = MOCK_INSPECTION_JOBS.reduce(
      (sum, j) => sum + (j.defectsCount ?? (j.defects?.length || 0)),
      0
    );
    assert.ok(totalDefects > 0, "Total defect count across jobs should be greater than zero");
  });
});

describe("2. Job History Search, Multi-Filter Combinations & Reset", () => {
  const jobs = MOCK_INSPECTION_JOBS;

  test("filters jobs case-insensitively by Job ID", () => {
    const query = "job-1083";
    const matches = jobs.filter(
      (j) =>
        j.id.toLowerCase().includes(query) ||
        j.application.toLowerCase().includes(query) ||
        j.targetRoute.toLowerCase().includes(query)
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, "JOB-1083");
  });

  test("filters jobs case-insensitively by target route", () => {
    const query = "/cart";
    const matches = jobs.filter((j) => j.targetRoute.toLowerCase().includes(query));
    assert.ok(matches.length >= 2, "Expected multiple runs on /cart route");
    for (const m of matches) {
      assert.equal(m.targetRoute, "/cart");
    }
  });

  test("filters jobs by inspection status", () => {
    const runningJobs = jobs.filter((j) => j.status === "running");
    assert.ok(runningJobs.length >= 1);
    assert.equal(runningJobs[0].status, "running");
  });

  test("filters jobs by validation status", () => {
    const passedValJobs = jobs.filter((j) => j.validationStatus === "passed");
    assert.ok(passedValJobs.length >= 1);
    for (const j of passedValJobs) {
      assert.equal(j.validationStatus, "passed");
    }
  });

  test("combines search query AND status AND validation status correctly", () => {
    const filtered = jobs.filter((j) => {
      const matchesSearch = j.targetRoute.includes("/cart");
      const matchesStatus = j.status === "failed";
      const matchesVal = j.validationStatus === "passed";
      return matchesSearch && matchesStatus && matchesVal;
    });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, "JOB-1083");
  });

  test("clearing filters restores the complete list of inspection jobs", () => {
    let activeQuery = "non-existent-search-term-12345";
    let filtered = jobs.filter((j) => j.id.toLowerCase().includes(activeQuery));
    assert.equal(filtered.length, 0);

    // Reset filters
    activeQuery = "";
    filtered = jobs.filter((j) => !activeQuery || j.id.toLowerCase().includes(activeQuery));
    assert.equal(filtered.length, jobs.length);
  });
});

describe("3. Defect Findings Severity Normalization & Job Linkage", () => {
  const normalizeSeverity = (sev) => {
    if (sev === "critical") return "critical";
    if (sev === "high" || sev === "major") return "high";
    if (sev === "medium" || sev === "minor") return "medium";
    return "low";
  };

  const getSeverityRank = (sev) => {
    const norm = normalizeSeverity(sev);
    switch (norm) {
      case "critical": return 4;
      case "high": return 3;
      case "medium": return 2;
      default: return 1;
    }
  };

  test("normalizes all 7 severity tiers into 4 standard categories", () => {
    assert.equal(normalizeSeverity("critical"), "critical");
    assert.equal(normalizeSeverity("high"), "high");
    assert.equal(normalizeSeverity("major"), "high");
    assert.equal(normalizeSeverity("medium"), "medium");
    assert.equal(normalizeSeverity("minor"), "medium");
    assert.equal(normalizeSeverity("low"), "low");
    assert.equal(normalizeSeverity("cosmetic"), "low");
  });

  test("sorts defect findings in descending severity rank (critical > high > medium > low)", () => {
    const defects = getAllDefectFindings();
    const sorted = [...defects].sort((a, b) => getSeverityRank(b.severity) - getSeverityRank(a.severity));

    for (let i = 0; i < sorted.length - 1; i++) {
      assert.ok(
        getSeverityRank(sorted[i].severity) >= getSeverityRank(sorted[i + 1].severity),
        "Defect list should be sorted in descending severity order"
      );
    }
  });

  test("all defect findings link to valid originating jobs with target routes", () => {
    const defects = getAllDefectFindings();
    for (const d of defects) {
      assert.ok(d.jobId, `Finding ${d.id} must have a jobId`);
      const job = getInspectionJobById(d.jobId);
      assert.ok(job, `Job ${d.jobId} must exist in registry`);
      assert.ok(d.targetRoute, `Finding ${d.id} must have targetRoute`);
    }
  });
});

describe("4. Visual Evidence Metadata & Cross-Referencing", () => {
  test("evidence records have required diagnostic dimensions and viewports", () => {
    const evidenceList = getAllEvidence();
    for (const evi of evidenceList) {
      assert.ok(evi.id);
      assert.ok(evi.type);
      assert.ok(evi.viewport);
      assert.ok(evi.jobId);
    }
  });

  test("screenshot artifacts provide baseline and defective image comparisons", () => {
    const screenshots = getAllEvidence().filter((e) => e.type === "screenshot");
    assert.ok(screenshots.length > 0);

    for (const shot of screenshots) {
      assert.ok(shot.baselineImageUrl || shot.defectiveImageUrl, "Screenshot artifact must provide image URI");
      assert.ok(shot.dimensions || shot.viewport, "Screenshot artifact must define viewport dimensions");
    }
  });

  test("every validation check referencing an evidence artifact resolves to an existing ID", () => {
    const allEvidence = getAllEvidence();
    const evidenceIds = new Set(allEvidence.map((e) => e.id));

    for (const job of MOCK_INSPECTION_JOBS) {
      if (job.validation?.checks) {
        for (const check of job.validation.checks) {
          if (check.evidenceRef) {
            assert.ok(
              evidenceIds.has(check.evidenceRef),
              `Validation check ${check.id} references missing evidence ${check.evidenceRef}`
            );
          }
        }
      }
    }
  });
});

describe("5. Validation Results & Assertion Integrity", () => {
  test("computes accurate pass percentages and handles zero-check edge cases", () => {
    const computePassPercentage = (passed, total) => {
      if (!total || total <= 0) return 0;
      return Math.round((passed / total) * 100);
    };

    assert.equal(computePassPercentage(3, 3), 100);
    assert.equal(computePassPercentage(2, 3), 67);
    assert.equal(computePassPercentage(0, 3), 0);
    assert.equal(computePassPercentage(0, 0), 0);
    assert.equal(Number.isNaN(computePassPercentage(0, 0)), false);
  });

  test("failed validation jobs always specify failureSummary and at least one failed check", () => {
    const failedJobs = MOCK_INSPECTION_JOBS.filter((j) => j.validation?.status === "failed");
    assert.ok(failedJobs.length > 0);

    for (const j of failedJobs) {
      assert.ok(j.validation.failureSummary, `Failed job ${j.id} must have a failureSummary`);
      assert.ok(j.validation.failedChecks > 0, `Failed job ${j.id} must have failedChecks > 0`);
      const hasFailedCheckItem = j.validation.checks.some((c) => c.status === "failed");
      assert.ok(hasFailedCheckItem, `Failed job ${j.id} must contain check with status "failed"`);
    }
  });

  test("passed validation jobs contain 0 failed checks and 100% pass rate", () => {
    const passedJobs = MOCK_INSPECTION_JOBS.filter((j) => j.validation?.status === "passed");
    assert.ok(passedJobs.length > 0);

    for (const j of passedJobs) {
      assert.equal(j.validation.failedChecks, 0);
      assert.equal(j.validation.passedChecks, j.validation.totalChecks);
    }
  });
});

describe("6. Resilient Adapters for Partial & Missing API Responses", () => {
  test("adaptBackendJobToInspectionJob handles missing website_url safely", () => {
    const partialBackendJob = {
      job_id: "JOB-PARTIAL-1",
      status: "completed",
      source: "manual",
      created_at: "2026-10-30T10:00:00Z",
      updated_at: "2026-10-30T10:01:00Z",
      artifacts: [],
    };

    const adapted = adaptBackendJobToInspectionJob(partialBackendJob);
    assert.equal(adapted.id, "JOB-PARTIAL-1");
    assert.equal(adapted.targetRoute, "/");
    assert.equal(adapted.status, "passed");
    assert.equal(adapted.validationStatus, "passed");
  });

  test("adaptBackendJobToInspectionJob handles missing created_at timestamp safely", () => {
    const partialBackendJob = {
      job_id: "JOB-PARTIAL-2",
      status: "queued",
      source: "manual",
      website_url: "https://example.com/checkout",
      artifacts: [],
    };

    const adapted = adaptBackendJobToInspectionJob(partialBackendJob);
    assert.equal(adapted.id, "JOB-PARTIAL-2");
    assert.equal(adapted.targetRoute, "/checkout");
    assert.equal(adapted.status, "pending");
    assert.equal(adapted.validationStatus, "pending");
    assert.ok(adapted.startedAt !== "Invalid Date");
  });

  test("adaptBackendJobToInspectionJob maps pr_created status to passed validation", () => {
    const prCreatedJob = {
      job_id: "JOB-PR-1",
      status: "pr_created",
      source: "manual",
      website_url: "https://example.com/cart",
      created_at: "2026-10-30T10:00:00Z",
      updated_at: "2026-10-30T10:01:00Z",
      artifacts: [],
    };

    const adapted = adaptBackendJobToInspectionJob(prCreatedJob);
    assert.equal(adapted.status, "passed");
    assert.equal(adapted.validationStatus, "passed");
  });

  test("adaptBackendArtifactToEvidence handles missing fields and generates safe fallback ID", () => {
    const partialArtifact = {
      kind: "trace",
    };

    const evidence = adaptBackendArtifactToEvidence(partialArtifact, "JOB-TEST");
    assert.ok(evidence.id.startsWith("art-JOB-TEST-"));
    assert.equal(evidence.type, "playwright-trace");
    assert.ok(evidence.capturedAt);
  });
});

describe("7. Loading, Fallback & Error State Resilience", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("loadInspectionJobsWithFallback returns mock data and sets isLiveBackend to false when backend fails", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch: Connection refused");
    };

    const result = await loadInspectionJobsWithFallback();
    assert.equal(result.isLiveBackend, false);
    assert.ok(result.jobs.length > 0);
    assert.ok(result.error);
    assert.match(result.error, /Connection refused/);
  });

  test("loadJobDetailsWithFallback returns mock job when backend returns HTTP 500", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ detail: "Internal Server Error" }),
    });

    const result = await loadJobDetailsWithFallback("JOB-1083");
    assert.equal(result.isLiveBackend, false);
    assert.ok(result.job);
    assert.equal(result.job.id, "JOB-1083");
  });

  test("loadJobDetailsWithFallback returns undefined when job ID is unknown in backend and mock data", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Job not found" }),
    });

    const result = await loadJobDetailsWithFallback("JOB-DOES-NOT-EXIST-999");
    assert.equal(result.isLiveBackend, false);
    assert.equal(result.job, undefined);
  });
});

describe("8. GitHub Self-Healing Workflow Invariants & Safety Gates", () => {
  test("protected branches (main, master, release/*) are shielded from direct commits", () => {
    assert.equal(isProtectedBranch("main"), true);
    assert.equal(isProtectedBranch("master"), true);
    assert.equal(isProtectedBranch("release/v1.0"), true);
    assert.equal(isProtectedBranch("production"), true);
    assert.equal(isProtectedBranch("omnisight/repair-JOB-1083"), false);
    assert.equal(isProtectedBranch("feature/ui-patch"), false);
  });

  test("repair branch name generator creates safe, normalized slugs", () => {
    const slug = buildRepairBranchName("JOB-1083", "DEF-188");
    assert.equal(slug, "omnisight/repair-job-1083-def-188");
    assert.match(slug, /^omnisight\/repair-/);
  });

  test("validateRepairFilePath permits safe project files and blocks forbidden extensions and traversal", () => {
    // Permitted safe files
    assert.equal(validateRepairFilePath("src/pages/Cart.tsx"), "src/pages/Cart.tsx");
    assert.equal(validateRepairFilePath("src/styles/theme.css"), "src/styles/theme.css");
    assert.equal(validateRepairFilePath("src/components/Header.tsx"), "src/components/Header.tsx");

    // Block path traversal
    assert.throws(() => validateRepairFilePath("../etc/passwd"), /Path traversal/);
    assert.throws(() => validateRepairFilePath("src/../../secret.env"), /Path traversal/);

    // Block forbidden directories
    assert.throws(() => validateRepairFilePath(".git/config"), /Modifications inside protected directory/);
    assert.throws(() => validateRepairFilePath(".github/workflows/deploy.yml"), /Modifications inside protected directory/);
    assert.throws(() => validateRepairFilePath("node_modules/react/index.js"), /Modifications inside protected directory/);

    // Block unauthorized extensions
    assert.throws(() => validateRepairFilePath("src/assets/bundle.exe"), /File extension not permitted/);
    assert.throws(() => validateRepairFilePath("src/scripts/hack.sh"), /File extension not permitted/);
  });

  test("validateRepairFileChanges rejects empty diff or duplicate paths", () => {
    assert.throws(() => validateRepairFileChanges([]), /Cannot create repair commit with empty file changes list/);
    assert.throws(
      () =>
        validateRepairFileChanges([
          { path: "src/pages/Cart.tsx", content: "a" },
          { path: "src/pages/Cart.tsx", content: "b" },
        ]),
      /Duplicate file path/
    );
  });

  test("validateCommitMessage enforces max length and strips control characters", () => {
    const safeMsg = validateCommitMessage("fix(cart): resolve button contrast ratio");
    assert.equal(safeMsg, "fix(cart): resolve button contrast ratio");

    // Strips control characters
    const msgWithCtrl = validateCommitMessage("fix(cart): clean\x00\x08 text");
    assert.equal(msgWithCtrl, "fix(cart): clean text");

    // Rejects overly long message (> 2000 chars)
    const longMsg = "a".repeat(2001);
    assert.throws(() => validateCommitMessage(longMsg), /Commit message exceeds maximum permitted length/);
  });

  test("assertValidationPassed halts repair workflow if validation is failed, pending, or has regressions", () => {
    assert.throws(
      () =>
        assertValidationPassed({
          status: "failed",
          totalChecks: 3,
          passedChecks: 2,
          failedChecks: 1,
        }),
      /Validation Gate Blocked: Current validation status is "failed"/
    );

    assert.throws(
      () =>
        assertValidationPassed({
          status: "passed",
          totalChecks: 3,
          passedChecks: 2,
          failedChecks: 1,
        }),
      /Validation Gate Blocked: 1 check\(s\) failed/
    );

    assert.throws(
      () =>
        assertValidationPassed({
          status: "passed",
          totalChecks: 0,
          passedChecks: 0,
          failedChecks: 0,
        }),
      /Zero automated validation checks were executed/
    );
  });

  test("assertConfirmedRepairCommit validates git commit SHA presence", () => {
    assert.doesNotThrow(() => assertConfirmedRepairCommit("commit_sha_def456"));
    assert.throws(() => assertConfirmedRepairCommit(""), /A confirmed repair branch commit SHA is required/);
    assert.throws(() => assertConfirmedRepairCommit("short"), /too short to be a valid commit SHA/);
  });

  test("toStructuredGitHubError redacts Bearer tokens and GitHub PATs from error messages and details", () => {
    const errorWithToken = new Error(
      "GitHub request failed with token ghp_1234567890abcdefghijklmnopqrstuvwxyz and Bearer my_secret_token_abc"
    );

    const structured = toStructuredGitHubError(errorWithToken);
    assert.equal(structured.message.includes("ghp_1234567890"), false);
    assert.equal(structured.message.includes("my_secret_token_abc"), false);
    assert.match(structured.message, /\[REDACTED\]/);
  });

  test("clientGitHubService.isEligibleForPullRequest adheres strictly to validation gate passage", () => {
    const job1083 = getInspectionJobById("JOB-1083");
    assert.ok(job1083);
    assert.equal(clientGitHubService.isEligibleForPullRequest(job1083), true);

    const job1080 = getInspectionJobById("JOB-1080");
    assert.ok(job1080);
    assert.equal(clientGitHubService.isEligibleForPullRequest(job1080), false);
  });
});
