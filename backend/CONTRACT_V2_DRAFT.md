# Backend contract v2 (agreed with Ajay on 2026-11-01, NOT implemented yet)

One capture job holds one proposal per defect scenario. Each scenario is approved, repaired and
turned into a Draft pull request independently. Nothing below exists in the backend yet; the endpoints in
`integration_guide.md` stay as they are, so the current dashboard client keeps working.

## Decisions

1. One capture job, many scenarios. The dashboard does NOT create a job per scenario.
2. The backend runs diagnosis and proposal generation itself after a successful capture:
   `npm run diagnose:evidence -- --run-id <run_id> --provider mock`, then
   `npm run repair:proposals -- --run-id <run_id>`. The frontend does not submit proposals in v2.
   Mock output is labelled (`is_mock: true`, `diagnosis.provider: "mock"`).
3. Approval is enforced per scenario. Approving one scenario never approves another.
4. A repair runs under a derived ID `<job_id>--<scenario_id>` (letters, digits, `-`, `_` only;
   scenario ids containing `--` are refused). It is deterministic, so one scenario is repaired once.
5. Only one repair runs at a time on the server (409 otherwise), so scenarios are repaired one after another.
6. The repair engine applies ONLY patches from its registry (`patch-registry.ts`), never the `proposedCode` text.
   A scenario with no registered patch gets the explicit result `unsupported` and nothing is executed.
7. `validation.checks` from the AI engine is stored with the proposal and ignored.
   `requiredValidationTests` stays the only gate for a repair.
8. One Draft pull request per scenario, and only for a scenario whose repair passed.
9. Repair completion and PR creation are separate. A job is `completed` when every scenario is resolved,
   whether or not the PRs exist yet. PR state lives on each scenario (`pr_status`). The job does NOT move to
   `pr_created` in v2. (The old job-level `POST /jobs/{id}/pr` and `completed -> pr_created` stay for old jobs.)

## Status and stage

`status` is authoritative. `stage` is only the current phase for display.

| status | meaning |
|---|---|
| queued, inspecting, analyzing | capture, then diagnosis and proposal generation |
| repair_proposed | proposals exist and at least one scenario still needs a decision or a repair |
| applying_patch | one scenario is being repaired right now |
| completed | every scenario is resolved, or there was nothing to repair |
| failed | a PIPELINE step failed (capture, diagnosis, proposal generation). A failed repair does NOT fail the job |

`stage`: `queued`, `inspecting`, `analyzing`, `generating_proposals`, `awaiting_approval`, `repairing`, `done`.
`completed` jobs end with stage `done`. `failed` jobs keep the stage where they failed.

Parent status rule: after each repair finishes the job returns to `repair_proposed` while any scenario is
`pending`, `approved` or `not_started`. It becomes `completed` when every scenario is resolved: its
`repair_state` is `passed`, `failed`, `rejected` or `unsupported`. This needs one change to the state table:
`applying_patch -> repair_proposed` becomes allowed.

```
summary: { total, pending_review, approved, repairing, passed, failed, rejected, unsupported, prs_created }
outcome: null while open, then "all_passed" | "partial" | "all_failed" | "all_rejected" | "no_repairs_needed"
```

`all_passed`: every scenario that was not rejected or unsupported passed (at least one did).
`partial`: at least one passed and at least one failed, was rejected or is unsupported.
`all_failed`: none passed and at least one failed or is unsupported. `all_rejected`: every scenario rejected.

## Job (v2 additions to GET /jobs/{id})

```json
{
  "job_id": "job-...", "status": "repair_proposed", "stage": "awaiting_approval",
  "summary": {"total": 4, "pending_review": 3, "approved": 0, "repairing": 0, "passed": 1, "failed": 0,
              "rejected": 0, "unsupported": 0, "prs_created": 0},
  "outcome": null,
  "scenarios": [
    {
      "scenario_id": "product-image-distortion",
      "defect_category": "image_distortion",
      "is_mock": true,
      "diagnosis": {"provider": "mock", "model": "mock-vlm-v1", "status": "diagnosed"},
      "proposal": { "...the proposal object from repair_proposals.json, including any validation.checks..." },
      "review_status": "pending_review",
      "approval": null,
      "repair_state": "not_started",
      "repair_job_id": "job-...--product-image-distortion",
      "repair": null,
      "pr_status": "not_started",
      "pull_request": null
    }
  ]
}
```

`review_status`: `pending_review`, `approved`, `rejected`.
`repair_state`: `not_started`, `running`, `passed`, `failed`, `rejected`, `unsupported`, `error`.
`approval`: `{"reviewed_by": "...", "reviewed_at": "..."}` (timestamp set by the server) or null.
`repair`: the existing repair result object (outcome, exit_code, final_state, failure_reason, build_passed,
test_passed, visual_passed, cleanup, report_path, stdout_tail, stderr_tail ...) plus `branch` and
`commit_sha` once the repair engine reports them, or null.
`pr_status`: `not_started`, `created`, `failed`. Always `not_started` unless `repair_state` is `passed`.
`pull_request`: `{pr_number, url, state, draft, head_branch, head_commit_sha, base_branch, repository, existing}` or null.
The old single-proposal fields (`proposal`, `approval`, `repair`, `pull_request` on the job itself) stay for jobs
created through the current endpoints.

## New endpoints (all except GET need the X-Operator-Token header)

| Request | Body | Success | Errors |
|---|---|---|---|
| `GET /jobs/{id}/scenarios` | | 200, list of scenarios | 404 |
| `GET /jobs/{id}/scenarios/{scenario_id}` | | 200, one scenario | 404 |
| `POST /jobs/{id}/scenarios/{scenario_id}/approval` | `{"reviewed_by": "name"}` | 200, the scenario | 401, 404, 409 (not pending), 422, 503 |
| `POST /jobs/{id}/scenarios/{scenario_id}/rejection` | `{"reviewed_by": "name", "reason": "text"}` | 200, the scenario | same |
| `POST /jobs/{id}/scenarios/{scenario_id}/repair` | none | 202, the job | 401, 404, 409 (not approved, already ran, or another repair running), 503 |
| `POST /jobs/{id}/scenarios/{scenario_id}/pr` | optional `{"title", "body", "base_branch"}` | 201 new, 200 existing, the scenario | 401, 404, 409 (repair not passed), 422, 429, 502 (push or GitHub failed), 503 (no GitHub token) |
| `GET /jobs/{id}/scenarios/{scenario_id}/pr` | | 200, the pull_request object | 404 |

The PR request cannot choose the repository or the head branch. The repository comes from the server setting
`OMNISIGHT_GITHUB_REPO`; the head branch comes from the repair report.

Examples:

```
POST /jobs/job-1/scenarios/low-contrast-text/approval
{"reviewed_by": "qa-engineer"}
-> 200 {"scenario_id": "low-contrast-text", "review_status": "approved",
        "approval": {"reviewed_by": "qa-engineer", "reviewed_at": "2026-11-01T07:40:00Z"}, ...}

POST /jobs/job-1/scenarios/low-contrast-text/repair
-> 202 {"job_id": "job-1", "status": "applying_patch", "stage": "repairing", ...}
```

## Pull request flow (per scenario)

1. The repair engine applies the registered patch and runs build, required tests and visual verification.
2. After success it COMMITS the change in the isolated worktree and puts `branch` and `commit_sha` in its report.
   The worktree may be removed afterwards, but the commit and the local branch must still exist until the push.
3. `POST .../pr` makes the backend push that one commit to the configured repository with the server-side GitHub
   token (never sent to the browser, never in a URL or log), as `<commit_sha>:refs/heads/<branch>`, no force.
   The backend refuses any branch that does not start with `omnisight-repair/` or contains odd characters.
4. The backend then creates the Draft PR through the GitHub API. A PR that already exists for the branch is returned.

## Needed from Ajay's repair engine

- Commit after successful validation, before cleanup; keep the local branch.
- Put `branch` and `commit_sha` in `repair_execution_report.json` and in the stdout summary.
- Return an explicit `unsupported` (or `unmatched`) final state when no patch is registered, with exit code 1
  and no execution. Tell the backend the exact field and value to look for.

## Unchanged
`POST /jobs`, `POST /webhooks/ci`, `GET /jobs`, `GET /jobs/{id}`, `GET /jobs/{id}/artifacts`, and the single-proposal
endpoints (`/proposal`, `/approval`, `/repair`, `/pr`) keep working so the current dashboard client does not break.

## Open questions
- Should a rejected scenario be allowed to be re-opened? (Draft: no.)
- The status rename to queued/running/completed/failed is separate and still not done.