# OmniSight — P4 GitHub Integration Service Architecture

**Author:** Person 4 (GitHub Integration & QA Dashboard — Sahil)  
**Status:** Hardened Error Handling & Safe Retries Implemented (Days 13–17)  
**Module:** `src/services/github/` & `src/api/services/githubService.ts`

---

## 1. Executive Summary

The **GitHub Integration Service Foundation** establishes a secure, zero-dependency integration boundary for OmniSight's self-healing pipeline. It governs all Git branch creation, commit staging, pull request draft construction, and permission auditing while strictly enforcing automated validation gates, repository allowlists, and protected branch isolation.

---

## 2. Architectural Boundaries & Credential Security

```
Browser Client (React QA Dashboard)
  │
  │  No GitHub tokens in client code or browser requests
  │  No VITE_* secrets in .env
  ▼
OmniSight Backend Orchestrator (FastAPI / Server CLI)
  │
  │  process.env.GITHUB_TOKEN / process.env.OMNISIGHT_GITHUB_TOKEN
  ▼
GitHub Integration Service (`src/services/github/`)
  │
  ├── Validation Gate (`validationGate.ts`)
  │     ├── assertValidationPassed()
  │     ├── assertNotProtectedBranch()
  │     ├── assertTargetRepoAllowed()
  │     ├── assertRepoNotArchived()
  │     └── assertWritePermission()
  ▼
GitHub REST API v3 (`https://api.github.com`)
```

### Security Rules:
1. **Server-Side Credential Isolation:**
   - Write credentials (`GITHUB_TOKEN`, PATs, installation tokens) must remain exclusively on the server.
   - Client code in `src/` never imports or accesses privileged tokens.
   - Vite environment variables (`VITE_*`) are strictly restricted to public non-sensitive URLs and timeout limits.
2. **Token Redaction:**
   - The error handling subsystem (`src/services/github/errors.ts`) automatically scrubs Bearer tokens and GitHub PAT patterns (`ghp_*`, `gho_*`, `ghu_*`, `github_pat_*`) before details can be logged or serialized.
3. **Target Repository Isolation:**
   - Mutations are restricted to configured target repositories (`OMNISIGHT_GITHUB_ALLOWED_REPOS` / `OMNISIGHT_TARGET_REPO`).

---

## 3. Implemented Operations & Permissions

| Operation | Service Method | Status | Safety Enforcement |
| :--- | :--- | :--- | :--- |
| **Verify Repository Permissions** | `verifyRepositoryAccess(owner, repo)` | **Implemented (Day 14)** | Audits read vs. write access, identity, archive state, and allowlist. |
| **Retrieve Identity** | `getAuthenticatedIdentity()` | **Implemented (Day 14)** | Resolves login, ID, account type, and OAuth/App scopes from `/user`. |
| **Retrieve Repository Metadata** | `getRepository(owner, repo)` | **Implemented** | Permissions & visibility check, rate limit handling |
| **Check Branch Information** | `getBranch(owner, repo, branch)` | **Implemented** | Confirms commit SHA and branch protection |
| **Retrieve Pull Request Metadata** | `getPullRequest(owner, repo, num)` | **Implemented** | Extracts review status, author, draft and merge state |
| **Prepare Repair Branch** | `prepareRepairBranch(params)` | **Implemented** | Requires 100% test pass; blocks protected branches; checks write permissions |
| **Prepare Repair Commit** | `prepareRepairCommit(params)` | **Implemented** | Git tree/commit data API; requires non-empty diff; validates safe paths |
| **Execute Repair Workflow** | `executeRepairWorkflow(params)` | **Implemented (Day 15)** | End-to-end orchestration: validation gate -> permissions -> idempotent branch -> safe commit |
| **Build Draft Pull Request** | `buildDraftPullRequestPayload(params)` | **Implemented** | `draft: true` invariant; embeds job telemetry & assertion checklist |
| **Find Open Pull Request** | `findOpenPullRequest(owner, repo, head, base)` | **Implemented (Day 16)** | Idempotency guard: queries existing open PR by branches |
| **Create Draft Pull Request** | `createDraftPullRequest(params)` | **Implemented (Day 16)** | Strict `draft: true` invariant; zero automated merges; retry & duplicate reuse |
| **Automated PR Dispatch / Publishing** | `publishPullRequest()` | **Prepared for Day 18** | Awaits UI review confirmation dialog in QA Dashboard |

---

## 4. Authentication Methods & Recommended Scopes

OmniSight supports two server-side authentication models:

### 1. Fine-Grained Personal Access Token (Recommended for Development & Staging)
- **Token Format:** `github_pat_*` or `ghp_*`
- **Scope Configuration:**
  - **Repository Selection:** Selected repositories only (e.g. `Veggies02/OmniSight`)
  - **Repository Permissions:**
    - `Contents: Read and write` (to create repair branches and commits)
    - `Pull requests: Read and write` (to open draft repair PRs)
    - `Metadata: Read-only` (mandatory for repo lookups)
- **Advantages:** Narrow blast radius; cannot access other repositories in the organization or user account.

### 2. GitHub App Installation Token (Recommended for Production & CI)
- **Token Format:** `ghs_*` (short-lived 1-hour token)
- **Permissions:**
  - `Repository contents: read & write`
  - `Pull requests: read & write`
- **Advantages:** Completely independent of personal user accounts; automatically rotated; attributed to `omnisight[bot]`.

---

## 5. Permission Auditing & Validation Gate

1. **Read vs. Write Verification:**
   - Successful authentication does **not** assume write access.
   - `verifyRepositoryAccess` explicitly evaluates `repoMeta.permissions.push`.
   - Read-only tokens (`push: false`) are blocked before mutations via `InsufficientPermissionsError` (HTTP 403).
2. **Archived Repository Protection:**
   - Archived repositories block automated mutations with `ArchivedRepositoryError`.
3. **Validation Gate Enforcement (`assertValidationPassed`):**
   - Blocks branch creation or commit staging unless the job's validation status is explicitly `"passed"`.
   - Requires `failedChecks === 0` and `totalChecks >= 1`.
   - Rejects `"running"`, `"pending"`, `"needs-review"`, `"failed"`, or missing validation results with `ValidationGateError`.
4. **Protected Branch Protection (`assertNotProtectedBranch`):**
   - Directly rejects writes or target branches matching `main`, `master`, `develop`, `production`, `release/*`.
   - Throws `ProtectedBranchError` (HTTP 403 equivalent).
5. **Draft-Only PRs:**
   - Automated pull requests are always created with `draft: true`.
   - Automated merging is completely prohibited. Human-in-the-loop engineering review is mandatory.

---

## 6. Day 15: Repair Branch and Commit Workflow Orchestration

### Workflow Pipeline (`executeRepairWorkflow`):
1. **Pre-Flight Validation Gate (`assertValidationPassed`):**
   - Asserts job validation has explicitly succeeded (`status: "passed"`), with 0 failed checks and at least 1 executed check.
2. **Permission & Security Verification (`assertWritePermission`):**
   - Asserts target repository is allowlisted, not archived, and the authenticated identity possesses `push: true` permissions.
3. **Safe File Path and Artifact Validation (`validateRepairFileChanges`):**
   - Requires non-empty file changes (`EmptyRepairDiffError` thrown if empty).
   - Blocks path traversal (`..`), absolute paths, Windows drive letters, null bytes, and control characters via `UnsafeFilePathError`.
   - Blocks sensitive system directories: `.git`, `node_modules`, `dist`, `build`, `.env`, `.github/workflows`.
   - Restricts file modifications to allowed source extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.json`, `.py`, etc.).
4. **Idempotent Dedicated Repair Branch Creation (`getBranch` + `createBranch`):**
   - Canonical branch format: `omnisight/repair-{jobId}-{findingId}`.
   - If branch already exists, reuses its tip commit as parent; otherwise, branches off the validated base branch tip (`main`).
5. **Atomic Commit Construction (`prepareRepairCommit`):**
   - Stages Git tree blobs and creates a new Git commit referencing the repair branch parent.
   - Validates that the commit message includes the job ID, finding summary, and verification tag.
   - Updates the repair branch ref to the new commit SHA.
6. **Dashboard UI Integration (`RepairBranchWorkflowAction.tsx`):**
   - Rendered within `DashboardJobDetails.tsx` (Section 5b).
   - Blocks trigger button when validation has not explicitly succeeded.
   - Displays real-time staging progress and renders confirmed results (branch name, base branch, commit SHA, files modified) or actionable error banners.

---

## 7. Day 16: GitHub Draft Pull Request Creation

### Workflow Pipeline (`createDraftPullRequest`):
1. **Pre-requisite Gate Enforcement:**
   - **Validation Gate:** Asserts `status === "passed"`, `failedChecks === 0`, `totalChecks >= 1`.
   - **Confirmed Commit SHA:** Asserts repair commit was confirmed (`assertConfirmedRepairCommit`).
   - **Source Branch Safety:** Asserts `headBranch` is not protected (`assertNotProtectedBranch`) and differs from target base branch (`assertDifferentBranches`).
   - **Write Permission Verification:** Asserts repository allowlist, unarchived state, and `push: true`.
   - **Branch Existence:** Verifies the repair branch actually exists in `{owner}/{repo}` on GitHub.
2. **Idempotency & Retry Safety:**
   - Queries `findOpenPullRequest` for matching head and base branches.
   - If an open PR already exists, reuses its details (`existing: true`) instead of submitting a duplicate request.
   - Catches HTTP 422 concurrent creation race conditions and automatically recovers the existing PR.
3. **Draft-Only Safeguards & Human-in-the-Loop Review:**
   - Unconditionally submits `draft: true` to the GitHub API.
   - Embeds defect summaries, 100% pass verification logs, visual evidence references, and review notices.
   - Zero automated merges: guarantees `merged: false` and forbids automatic merge execution.
4. **Dashboard UI Integration (`DraftPullRequestAction.tsx`):**
   - Displays real-time PR creation controls only when prerequisites (passed validation + confirmed branch/commit) are met.
   - Prevents duplicate inflight submissions.
   - Displays confirmed PR details (PR link, number, source/base branches, draft status, and safety badges).
   - Handles API errors and missing backend dependencies transparently.

---

## 8. Day 17: GitHub Workflow Error Handling, Retries & Safety Architecture

### 1. Centralized Structured Error Classification (`errors.ts`):
- All failures produce a normalized `StructuredGitHubError` with stable codes (`code`), readable sanitized messages, and actionable guidance (`help`).
- **Codes:** `AUTH_FAILED`, `PERMISSION_DENIED`, `RESOURCE_NOT_FOUND`, `VALIDATION_FAILED`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, `TIMEOUT`, `CONFLICT`, `UNSAFE_PATH`, `EMPTY_DIFF`, `MISSING_COMMIT`, `BRANCH_MISMATCH`, `REPO_NOT_ALLOWED`, `REPO_ARCHIVED`, `OUTCOME_UNKNOWN`.

### 2. Strict Retry Policy:
| Failure Type | Status | Error Code | Retry Policy | Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Authentication** | 401 | `AUTH_FAILED` | **Never** (`isRetryable: false`) | Rejects immediately; prompts for valid token in server `.env` |
| **Permission Denied** | 403 | `PERMISSION_DENIED` | **Never** (`isRetryable: false`) | Rejects immediately; prompts for write/push scopes |
| **Validation Gate** | 400 | `VALIDATION_FAILED` | **Never** (`isRetryable: false`) | Rejects immediately; requires test regression resolution |
| **Protected Branch** | 403 | `PROTECTED_BRANCH` | **Never** (`isRetryable: false`) | Rejects direct writes to `main`/`master` |
| **Rate Limit** | 429 | `RATE_LIMITED` | **Transient** (`isRetryable: true`) | Parses `x-ratelimit-reset`; supplies `retryAfterMs` |
| **Service Unavailable** | 502/503 | `SERVICE_UNAVAILABLE` | **Transient** (`isRetryable: true`) | Safe idempotent reads retry up to 2 times with exponential backoff |
| **Timeout (Read)** | 504 | `TIMEOUT` | **Transient** (`isRetryable: true`) | Retries read after timeout |
| **Timeout (Write)** | 504 | `OUTCOME_UNKNOWN` | **State-Checked** (`isRetryable: false`) | **Never blindly repeats write!** Checks GitHub state (`getBranch` or `findOpenPullRequest`). If confirmed, recovers resource; otherwise throws `OUTCOME_UNKNOWN` |

### 3. Secret Redaction:
- `sanitizeMessage()` and `sanitizeDetails()` scrub GitHub Personal Access Tokens (`ghp_*`, `gho_*`, `ghu_*`, `github_pat_*`), `Bearer` tokens, passwords, and authorization headers from error messages, serialized objects, and UI logs.

### 4. Dashboard Feedback Integration:
- `RepairBranchWorkflowAction.tsx` and `DraftPullRequestAction.tsx` track operation states (`idle`, `running`, `succeeded`, `failed`, `unknown`).
- Transient errors render a safe **"Retry"** button.
- Permanent errors display clear remediation steps without a retry action.
- Unknown outcomes render an amber notice directing users to check GitHub before re-submitting.

---

## 9. Day 18: End-to-End QA Dashboard Integration Polish

### 1. Connected Workflow Architecture:
All 5 QA dashboard pages now operate as a unified, seamless inspection console:

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   QA Overview   │ ────> │ Inspection Jobs │ ────> │   Job Details   │
│     (/qa)       │       │   (/qa/jobs)    │       │ (/qa/jobs/:id)  │
└────────┬────────┘       └─────────────────┘       └────────┬────────┘
         │                                                   │
         ├─────────────────────────────────┐                 │
         ▼                                 ▼                 ▼
┌─────────────────┐               ┌─────────────────┐        │
│ Defect Review   │ <───────────> │ Self-Healing PR │ <──────┘
│  (/qa/defects)  │               │(/qa/pull-requests)
└─────────────────┘               └─────────────────┘
```

1. **QA Overview (`/qa`):**
   - Displays real-time inspection metrics, status distribution, and recent jobs.
   - Live backend vs. demo data fallback badge with pulsing status dot.
   - Quick navigation links to Inspection Jobs, Defect Review, and Self-Healing PRs.
   - Interactive empty-state simulator for resilience testing.
2. **Inspection Jobs (`/qa/jobs`):**
   - Breadcrumb navigation (`QA Overview / Inspection Jobs`).
   - Multi-field search (Job ID, Application, Route, Defect summary) and dropdown filters (Status, Validation).
   - Direct links to `/qa/jobs/:id` for comprehensive inspection details.
3. **Job Details (`/qa/jobs/:id`):**
   - Breadcrumbs with current Job ID.
   - Status metrics, Playwright runner telemetry, application target route.
   - Validation Results viewer with individual check assertions, durations, targets, and evidence jump links.
   - Repair Branch & Commit Workflow Action (`#repair-workflow`) with interactive Draft PR generation.
   - Defect Findings review connected to visual comparison evidence (`#visual-evidence-viewer`).
   - Smooth scrolling between validation check evidence references and the visual comparison viewer.
4. **Defect Findings & Review (`/qa/defects`):**
   - Aggregates visual findings across loaded jobs with clean fallback to mock registry.
   - Breadcrumbs navigation (`QA Overview / Defect Findings & Review`).
   - Severity badges (P0/P1 Critical, High, Medium, Low), DOM selector previews, and attached evidence cards.
   - Direct action buttons on each defect: "Open Job Details (#JOB-XXXX) →" and "Inspect in Comparison Viewer →".
5. **GitHub Pull Requests & Self-Healing (`/qa/pull-requests`):**
   - Replaced placeholder with a dedicated Pull Requests & Self-Healing dashboard page.
   - StatCards: Draft PRs Created, Repair Branches Staged, Base Branch Protection (100%), Automated Direct Merges (0).
   - Invariant callout: highlights validation gate verification, `draft: true` guarantee, and human-in-the-loop review.
   - Searchable and filterable table of repair branches, commit SHAs, PR links, and validation outcomes.
   - One-click links to GitHub draft pull requests and originating job records.

### 2. Verification Summary:
- **Test Suite:** 100 unit & integration tests passing across 18 suites (`api-client.test.mjs`, `github-service.test.mjs`, `qa-dashboard-e2e.test.mjs`, `dashboard-comprehensive.test.mjs`).
- **Type Checking:** `tsc -b` compiles with 0 errors.
- **Production Build:** Vite builds in ~0.3s with 0 errors.
- **Linter:** `oxlint` reports 0 errors across 58 files.
- **Safety Invariant:** All tokens remain server-side; zero secrets in client code or bundle.

---

## 10. Day 19–20: Safe Mock Testing & Invariant Enforcement

### 1. Mock Testing Invariant (Zero Real GitHub Mutations in Tests)
All automated unit and integration tests strictly mock the Fetch API or instantiate `GitHubIntegrationService` with simulated HTTP transports:
- **No real branches, commits, or PRs** are created against `Veggies02/OmniSight` during testing.
- Tests verify request payloads, URLs, headers, and validation gate halts deterministically in memory.
- Execution command: `node --experimental-strip-types --test tests/github-service.test.mjs tests/dashboard-comprehensive.test.mjs`

### 2. Prohibited Actions & Non-Negotiable Invariants:
1. **Base Branch Mutation Strictly Prohibited:**
   - Any attempt to target `main`, `master`, `release/*`, or `production` as a write head branch is intercepted by `assertNotProtectedBranch()` and immediately rejected with `PROTECTED_BRANCH` (HTTP 403).
   - Automated repair commits can only be staged onto dedicated branches named via `buildRepairBranchName()` (`omnisight/repair-*`).
2. **Automated Merging Strictly Prohibited:**
   - `createDraftPullRequest()` guarantees `merged: false` in all return payloads.
   - The integration service does not implement or expose any GitHub merge endpoints (`PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`).
   - Human review by repository code owners is an immutable design requirement.
3. **Draft-Only Pull Requests Invariant:**
   - All PR payloads unconditionally set `draft: true`.
   - Automated workflows never mark pull requests as ready for review (`draft: false`) without explicit human intervention in GitHub.
4. **Validation Gate Invariant:**
   - `assertValidationPassed()` halts workflow execution before any branch or commit request if `status !== "passed"`, `failedChecks > 0`, or `totalChecks === 0`.





