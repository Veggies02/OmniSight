# OmniSight — P4 GitHub Integration Service Architecture

**Author:** Person 4 (GitHub Integration & QA Dashboard — Sahil)  
**Status:** Foundation & Secure Permissions Implemented (Days 13–14)  
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
| **Prepare Repair Commit** | `prepareRepairCommit(params)` | **Implemented** | Git tree/commit data API; requires non-empty diff; rejects protected |
| **Build Draft Pull Request** | `buildDraftPullRequestPayload(params)` | **Implemented** | `draft: true` invariant; embeds job telemetry & assertion checklist |
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
