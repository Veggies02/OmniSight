# OmniSight — P4 GitHub Integration Service Architecture

**Author:** Person 4 (GitHub Integration & QA Dashboard — Sahil)  
**Status:** Foundation Implemented (Day 13)  
**Module:** `src/services/github/` & `src/api/services/githubService.ts`

---

## 1. Executive Summary

The **GitHub Integration Service Foundation** establishes a secure, zero-dependency integration boundary for OmniSight's self-healing pipeline. It governs all Git branch creation, commit staging, and pull request draft construction while strictly enforcing automated validation gates and protected branch isolation.

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
  │     └── validateBranchName()
  ▼
GitHub REST API v3 (`https://api.github.com`)
```

### Security Rules:
1. **Server-Side Credential Isolation:**
   - Write credentials (`GITHUB_TOKEN`, PATs) must remain exclusively on the server.
   - Client code in `src/` never imports or accesses privileged tokens.
   - Vite environment variables (`VITE_*`) are strictly restricted to public non-sensitive URLs and timeout limits.
2. **Token Redaction:**
   - The error handling subsystem (`src/services/github/errors.ts`) automatically scrubs Bearer tokens and GitHub PAT patterns (`ghp_*`, `gho_*`, `ghu_*`) before details can be logged or serialized.

---

## 3. Implemented vs. Prepared Operations

| Operation | Service Method | Status | Safety Enforcement |
| :--- | :--- | :--- | :--- |
| **Retrieve Repository Metadata** | `getRepository(owner, repo)` | **Implemented** | Permissions & visibility check, rate limit handling |
| **Check Branch Information** | `getBranch(owner, repo, branch)` | **Implemented** | Confirms commit SHA and branch protection |
| **Retrieve Pull Request Metadata** | `getPullRequest(owner, repo, num)` | **Implemented** | Extracts review status, author, draft and merge state |
| **Prepare Repair Branch** | `prepareRepairBranch(params)` | **Implemented** | Requires 100% test pass; blocks protected branches; idempotent |
| **Prepare Repair Commit** | `prepareRepairCommit(params)` | **Implemented** | Git tree/commit data API; requires non-empty diff; rejects protected |
| **Build Draft Pull Request** | `buildDraftPullRequestPayload(params)` | **Implemented** | `draft: true` invariant; embeds job telemetry & assertion checklist |
| **Automated PR Dispatch / Publishing** | `publishPullRequest()` | **Prepared for Day 18** | Awaits UI review confirmation dialog in QA Dashboard |

---

## 4. Safety Guardrails & Validation Gate

1. **Validation Gate Enforcement (`assertValidationPassed`):**
   - Blocks branch creation or commit staging unless the job's validation status is explicitly `"passed"`.
   - Requires `failedChecks === 0` and `totalChecks >= 1`.
   - Rejects `"running"`, `"pending"`, `"needs-review"`, `"failed"`, or missing validation results with `ValidationGateError`.
2. **Protected Branch Protection (`assertNotProtectedBranch`):**
   - Directly rejects writes or target branches matching `main`, `master`, `develop`, `production`, `release/*`.
   - Throws `ProtectedBranchError` (HTTP 403 equivalent).
3. **Draft-Only PRs:**
   - Automated pull requests are always created with `draft: true`.
   - Automated merging is completely prohibited. Human-in-the-loop engineering review is mandatory.
4. **Git Ref Sanitization:**
   - Canonical repair branch pattern: `omnisight/repair-{jobId}-{findingId}`.
   - Strict regex validation blocks path traversal (`..`), shell metacharacters, and illegal git control characters.
