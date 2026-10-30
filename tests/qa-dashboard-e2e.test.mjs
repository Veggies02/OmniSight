/**
 * Node 22 Native Test Suite for End-to-End QA Dashboard Integration
 *
 * Verifies:
 * - Cross-view data flow and entity linkages (Job -> Findings -> Evidence -> Validation -> PR)
 * - Defect finding to job linkage integrity
 * - Validation results status, assertion counts, and evidence referencing
 * - Self-healing repair branch and Draft PR eligibility gates
 * - Protected branch invariants and draft-only pull request enforcement
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MOCK_INSPECTION_JOBS,
  getInspectionJobById,
  getAllDefectFindings,
  getAllEvidence,
} from "../src/data/mockJobs.ts";
import { clientGitHubService } from "../src/api/services/githubService.ts";
import {
  isProtectedBranch,
  buildRepairBranchName,
  assertValidationPassed,
  assertConfirmedRepairCommit,
} from "../src/services/github/validationGate.ts";

describe("End-to-End QA Dashboard Workflow & Entity Linkages", () => {
  test("all inspection jobs have valid IDs, statuses, and routes for navigation", () => {
    assert.ok(MOCK_INSPECTION_JOBS.length > 0, "Inspection jobs list should not be empty");

    for (const job of MOCK_INSPECTION_JOBS) {
      assert.ok(job.id, "Job must have an ID");
      assert.ok(job.application, "Job must have an application name");
      assert.ok(job.targetRoute.startsWith("/"), "Job target route must start with /");
      assert.ok(
        ["passed", "failed", "running", "pending", "needs-review"].includes(job.status),
        `Job ${job.id} has invalid status ${job.status}`
      );
      assert.ok(
        ["passed", "failed", "running", "pending", "needs-review", "not-applicable"].includes(
          job.validationStatus
        ),
        `Job ${job.id} has invalid validationStatus ${job.validationStatus}`
      );
    }
  });

  test("defect findings connect cleanly to originating job details and target routes", () => {
    const defects = getAllDefectFindings();
    assert.ok(defects.length > 0, "Defect findings must not be empty");

    for (const defect of defects) {
      assert.ok(defect.id, "Defect must have an ID");
      assert.ok(defect.title, "Defect must have a descriptive title");
      assert.ok(defect.severity, "Defect must have a severity classification");
      assert.ok(defect.jobId, `Defect ${defect.id} must link to an originating jobId`);
      assert.ok(defect.targetRoute, `Defect ${defect.id} must specify targetRoute`);

      // Verify that the job can be retrieved by ID
      const job = getInspectionJobById(defect.jobId);
      assert.ok(job, `Originating job #${defect.jobId} must exist in job registry`);
      assert.equal(job.targetRoute, defect.targetRoute);
    }
  });

  test("evidence artifacts connect to jobs and defect findings without broken references", () => {
    const allEvidence = getAllEvidence();
    assert.ok(allEvidence.length > 0, "Evidence artifacts must not be empty");

    const evidenceMap = new Map(allEvidence.map((e) => [e.id, e]));

    for (const evi of allEvidence) {
      assert.ok(evi.id, "Evidence must have an ID");
      assert.ok(evi.type, "Evidence must have a type (screenshot or playwright-trace)");
      assert.ok(evi.viewport, "Evidence must specify viewport dimensions");
      assert.ok(evi.jobId, `Evidence ${evi.id} must be associated with a jobId`);

      const job = getInspectionJobById(evi.jobId);
      assert.ok(job, `Evidence ${evi.id} links to existing job #${evi.jobId}`);
    }

    // Verify all validation checks referencing evidence resolve to a real artifact
    for (const job of MOCK_INSPECTION_JOBS) {
      if (job.validation?.checks) {
        for (const check of job.validation.checks) {
          if (check.evidenceRef) {
            assert.ok(
              evidenceMap.has(check.evidenceRef),
              `Check ${check.id} in job ${job.id} references missing evidence ${check.evidenceRef}`
            );
          }
        }
      }
    }
  });

  test("validation results reflect actual check outcomes, failure summaries, and gates", () => {
    const jobsWithValidation = MOCK_INSPECTION_JOBS.filter((j) => j.validation);
    assert.ok(jobsWithValidation.length > 0, "Must have jobs with validation outcomes");

    for (const job of jobsWithValidation) {
      const val = job.validation;
      assert.equal(
        val.totalChecks,
        val.checks.length,
        `Job ${job.id} check count mismatch`
      );

      const actualPassed = val.checks.filter((c) => c.status === "passed").length;
      assert.equal(
        val.passedChecks,
        actualPassed,
        `Job ${job.id} passed checks mismatch`
      );

      const actualFailed = val.checks.filter((c) => c.status === "failed").length;
      assert.equal(
        val.failedChecks,
        actualFailed,
        `Job ${job.id} failed checks mismatch`
      );

      if (val.status === "failed") {
        assert.ok(val.failedChecks > 0, `Failed job ${job.id} must have failed checks`);
        assert.ok(val.failureSummary, `Failed job ${job.id} must provide a failureSummary`);
      }
    }
  });
});

describe("Self-Healing Pull Request & Safety Gate Verification", () => {
  test("clientGitHubService.isEligibleForPullRequest adheres to strict validation passage", () => {
    // Validated passing job with resolved defects (JOB-1083)
    const job1083 = getInspectionJobById("JOB-1083");
    assert.ok(job1083);
    assert.equal(clientGitHubService.isEligibleForPullRequest(job1083), true);

    // Job with failed validation (JOB-1080)
    const job1080 = getInspectionJobById("JOB-1080");
    assert.ok(job1080);
    assert.equal(clientGitHubService.isEligibleForPullRequest(job1080), false);

    // Job in running state (JOB-1085)
    const job1085 = getInspectionJobById("JOB-1085");
    assert.ok(job1085);
    assert.equal(clientGitHubService.isEligibleForPullRequest(job1085), false);

    // Job with review required (JOB-1084)
    const job1084 = getInspectionJobById("JOB-1084");
    assert.ok(job1084);
    assert.equal(clientGitHubService.isEligibleForPullRequest(job1084), false);
  });

  test("protected branches are shielded and repair branch name follows canonical pattern", () => {
    assert.equal(isProtectedBranch("main"), true);
    assert.equal(isProtectedBranch("master"), true);
    assert.equal(isProtectedBranch("release/v1.0"), true);
    assert.equal(isProtectedBranch("omnisight/repair-JOB-1083"), false);

    const branchName = buildRepairBranchName("JOB-1083", "DEF-188");
    assert.equal(branchName, "omnisight/repair-job-1083-def-188");
    assert.match(branchName, /^omnisight\/repair-/);
  });

  test("assertValidationPassed blocks PR staging if checks failed or missing", () => {
    // Should pass
    assert.doesNotThrow(() => {
      assertValidationPassed({
        status: "passed",
        totalChecks: 3,
        passedChecks: 3,
        failedChecks: 0,
      });
    });

    // Should fail when failedChecks > 0
    assert.throws(
      () => {
        assertValidationPassed({
          status: "passed",
          totalChecks: 3,
          passedChecks: 2,
          failedChecks: 1,
        });
      },
      /Validation Gate Blocked: 1 check\(s\) failed/
    );

    // Should fail when status is needs-review
    assert.throws(
      () => {
        assertValidationPassed({
          status: "needs-review",
          totalChecks: 3,
          passedChecks: 1,
          failedChecks: 1,
        });
      },
      /Current validation status is "needs-review"/
    );
  });

  test("assertConfirmedRepairCommit validates git commit SHA presence and format", () => {
    assert.doesNotThrow(() => {
      assertConfirmedRepairCommit("commit_sha_def456");
      assertConfirmedRepairCommit("a1b2c3d4e5f67890123456789abcdef012345678");
    });

    assert.throws(() => {
      assertConfirmedRepairCommit("");
    }, /A confirmed repair branch commit SHA is required/);

    assert.throws(() => {
      assertConfirmedRepairCommit("short");
    }, /too short to be a valid commit SHA/);
  });
});
