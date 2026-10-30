# P4: GitHub Integration & QA Dashboard — Development Setup & Architecture

**Engineer / Workstream:** Sahil — P4 (GitHub Integration & QA Dashboard)  
**System:** OmniSight (AI-powered UI defect detection & self-healing platform)  
**Document Status:** Final Handover Specification (Day 20)  
**Date:** October 2026  

---

## 1. Role Scope and P4 Responsibilities

As the engineer for **P4: GitHub Integration & QA Dashboard**, the responsibility is to deliver the complete human-in-the-loop triage console, visual evidence inspection interface, automated validation reporting, and secure GitHub self-healing workflows for OmniSight.

### Core Responsibilities:
1. **React 19 QA Dashboard Shell & Layout:**
   - Dedicated developer tool navigation console located at `/qa`.
   - Responsive sidebar, mobile drawer, executive headers, telemetry badges, and breadcrumb navigation.
2. **Overview & System Telemetry (`/qa`):**
   - Real-time aggregation of inspection runs, pass/failure rates, defect counts, and review queues.
   - Dual-mode data indicator: Live FastAPI backend vs. typed demo database indicator with pulsing status indicator.
   - Interactive empty-state simulation toggle for UI resilience verification.
3. **Inspection Job History & Filtering (`/qa/jobs`):**
   - Full chronological test execution audit table.
   - Real-time search query matching across Job ID, target application, route, and defect summaries.
   - Multi-criteria dropdown filters for inspection status and self-healing validation status.
4. **Job Detail Telemetry & Findings (`/qa/jobs/:id`):**
   - Granular execution telemetry (Playwright runner, viewport, duration, started timestamp).
   - Defect findings registry with severity triage badges, DOM locator code blocks, and affected component paths.
   - Automated Self-Healing Repair Action (`#repair-workflow`) for staging repair branches, commits, and draft PRs.
   - Interactive visual evidence viewer (`#visual-evidence-viewer`) with side-by-side screenshot diffs and trace metadata.
5. **Defect Review & Triage Hub (`/qa/defects`):**
   - Centralized finding registry across all test runs with severity categorization (`critical`, `high`, `medium`, `low`).
   - Direct jump buttons to open originating job details (`/qa/jobs/:id`) and inspect in comparison viewer.
6. **GitHub Pull Requests & Self-Healing Hub (`/qa/pull-requests`):**
   - Dashboard console tracking all self-healing repair branches, commit SHAs, and draft pull requests.
   - Safety guardrail callout highlighting base branch protection and human-in-the-loop review enforcement.
7. **Secure GitHub Integration Service (`src/services/github/`):**
   - Zero-dependency REST API client communicating directly with GitHub API v3.
   - Strict credential isolation: tokens reside exclusively on the server (`process.env.GITHUB_TOKEN`); zero secrets in client code.
   - Validation Gate: write operations strictly blocked unless validation tests passed cleanly with 0 regressions.
   - Base branch protection: direct commits to `main`, `master`, and `release/*` are rejected.
   - Draft PR invariant: pull requests created unconditionally with `draft: true` and `merged: false`.
   - Robust error handling: exponential backoff retries, secret redaction, and race-condition recovery.

---

## 2. Directory Structure & Key Files

```text
OmniSight/
├── docs/                                  # Workstream documentation
│   ├── p4-development-setup.md            # (This guide) P4 architecture & development setup
│   ├── p4-github-integration.md           # GitHub service architecture, security & safety gates
│   ├── p4-api-contracts.md                # P3/P4 API contracts, schemas & coordination
│   ├── p4-demo-walkthrough.md             # Reproducible step-by-step demo script
│   └── p4-handover.md                     # Day 20 final handover summary
├── src/
│   ├── api/                               # Centralized API Client & Service Layer
│   │   ├── client.ts                      # OmniSightApiClient (timeout, abort, error sanitization)
│   │   ├── adapters.ts                    # Backend-to-Frontend domain mapping & resilient fallback
│   │   ├── services/
│   │   │   ├── jobsService.ts             # JobsService (listJobs, getJob, getArtifacts)
│   │   │   ├── evidenceService.ts         # EvidenceService (artifact resolving & previews)
│   │   │   └── githubService.ts          # ClientGitHubService (frontend boundary for repair & PR actions)
│   │   └── hooks/
│   │       ├── useInspectionJobs.ts       # React hook for jobs listing with fallback
│   │       └── useInspectionJobDetails.ts # React hook for job details with fallback
│   ├── components/dashboard/              # Reusable QA Dashboard Components
│   │   ├── DashboardLayout.tsx            # Main shell with sidebar, topnav & outlet
│   │   ├── DashboardSidebar.tsx           # Sidebar navigation with active route highlights
│   │   ├── DashboardHeader.tsx            # Top header bar with status telemetry
│   │   ├── PageHeader.tsx                 # Standardized view header with badges & action slots
│   │   ├── StatCard.tsx                   # Metric telemetry card with trend indicators
│   │   ├── StatusBadge.tsx                # Status pill (passed, failed, running, needs-review)
│   │   ├── DefectFindingsReview.tsx       # Expandable defect cards with DOM locators & evidence
│   │   ├── VisualEvidenceViewer.tsx       # Screenshot comparison & Playwright trace viewer
│   │   ├── ValidationResults.tsx          # Assertion checks list, durations & evidence links
│   │   ├── RepairBranchWorkflowAction.tsx # Staged repair branch & commit creator
│   │   ├── DraftPullRequestAction.tsx     # Draft PR creator & GitHub link display
│   │   ├── EmptyState.tsx                 # Zero-data fallback component
│   │   ├── LoadingState.tsx               # Spinner state with messaging
│   │   └── ErrorState.tsx                 # Error alert with safe retry action
│   ├── pages/dashboard/                   # QA Dashboard Routed Views
│   │   ├── DashboardOverview.tsx          # Route: /qa
│   │   ├── DashboardJobs.tsx              # Route: /qa/jobs
│   │   ├── DashboardJobDetails.tsx        # Route: /qa/jobs/:id
│   │   ├── DashboardDefects.tsx           # Route: /qa/defects
│   │   └── DashboardPullRequests.tsx      # Route: /qa/pull-requests
│   ├── services/github/                   # Server-Side GitHub Integration Engine
│   │   ├── githubIntegrationService.ts   # Core workflow engine (branches, commits, PRs)
│   │   ├── githubClient.ts                # GitHub REST API client with retry & backoff
│   │   ├── validationGate.ts              # Safety assertions, allowlists & slug builders
│   │   ├── errors.ts                      # Normalized error mapping & token redaction
│   │   └── types.ts                       # GitHub domain models & parameter interfaces
│   ├── types/
│   │   ├── contracts.ts                   # Mirrors Pydantic schemas from P3 & P2
│   │   └── dashboard.ts                   # Frontend UI domain models & status translators
│   ├── styles/
│   │   └── dashboard.css                  # QA Dashboard design system (2,700+ lines)
│   └── App.tsx                            # Root router configuring /qa and storefront
├── tests/                                 # Node 22 Native Test Suites
│   ├── api-client.test.mjs                # Client HTTP, error sanitization & adapters
│   ├── github-service.test.mjs            # GitHub API, permissions, repair & PR workflows
│   ├── qa-dashboard-e2e.test.mjs          # Cross-view entity linkages & validation gates
│   └── dashboard-comprehensive.test.mjs   # Overview metrics, filters, partial data & safety
├── .env.example                           # Configuration template (placeholders only)
├── package.json                           # npm scripts & dependencies
└── tsconfig.json                          # TypeScript configuration
```

---

## 3. Environment Configuration & Setup

### Environment Variables (`.env.example` & `.env.local`):

Copy `.env.example` to `.env.local` to configure local settings:

```bash
cp .env.example .env.local
```

```ini
# ==============================================================================
# 1. CLIENT-SIDE (React QA Dashboard Frontend)
# ==============================================================================
# Base URL for OmniSight Backend API (FastAPI)
VITE_API_BASE_URL=/api

# Network request timeout in milliseconds
VITE_API_TIMEOUT_MS=10000

# Mock data fallback toggle: when true, dashboard gracefully displays demo data if backend is unreachable
VITE_ENABLE_MOCK_FALLBACK=true

# ==============================================================================
# 2. SERVER-SIDE (FastAPI Backend, Orchestrator & CLI Services Only)
# ==============================================================================
# GitHub Personal Access Token or GitHub App Token for branch & PR creation
# GITHUB_TOKEN=ghp_exampleTokenDoNotCommitToGit

# GitHub API Base URL (defaults to https://api.github.com)
# GITHUB_API_BASE_URL=https://api.github.com

# Default base branch for repair branches (defaults to main)
# OMNISIGHT_GITHUB_DEFAULT_BASE_BRANCH=main

# Default repository target in owner/repo format
# OMNISIGHT_GITHUB_DEFAULT_REPO=Veggies02/OmniSight
```

> [!CAUTION]
> **Credential Safety Rule:** Never commit real tokens or prefix GitHub write credentials with `VITE_`. Vite embeds `VITE_*` variables directly into public JavaScript bundles. The GitHub Integration Service reads credentials strictly on the server side (`process.env.GITHUB_TOKEN`).

---

## 4. How to Run and Test Locally

### Prerequisites:
- **Node.js**: Node.js **>= 20.19.0** or **>= 22.12.0** (Node 22 LTS recommended).
- **npm**: npm v9+ recommended.

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Development Server
```bash
npm run dev
```
Open **http://localhost:5173/qa** in your browser to view the QA Dashboard. (Or navigate to `/` for the mock storefront).

### 3. Run Automated Tests
```bash
npm test
```
Executes all 4 Node 22 native test suites (`api-client.test.mjs`, `github-service.test.mjs`, `qa-dashboard-e2e.test.mjs`, `dashboard-comprehensive.test.mjs`). 100/100 tests execute in ~2.1 seconds.

### 4. Run TypeScript Type Checking
```bash
npx tsc -b
```
Verifies strict TypeScript compilation across all application modules.

### 5. Run Linter
```bash
npm run lint
```
Runs `oxlint` across all files.

### 6. Build for Production
```bash
npm run build
```
Compiles TypeScript and creates optimized static assets in `dist/`.

---

## 5. Frontend-to-Backend Communication Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Browser Client                       │
│    React 19 Dashboard UI (/qa, /qa/jobs, etc.)         │
└───────────────────────────┬────────────────────────────┘
                            │
               OmniSightApiClient (src/api/client.ts)
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
Live Backend Available?             Backend Offline / 404?
            │                               │
            ▼                               ▼
FastAPI Backend (/api/...)          Resilient Fallback Layer
- GET  /api/jobs                    (src/api/adapters.ts)
- GET  /api/jobs/{id}               - Displays typed demo jobs
- GET  /api/jobs/{id}/artifacts     - Displays validation records
- POST /api/jobs/{id}/repair-branch - Surfaces "Demo Data Fallback"
- POST /api/jobs/{id}/pr            - Zero crashes or blank screens
- GET  /api/jobs/{id}/pr
```

1. **Centralized Client ([`client.ts`](file:///c:/Users/admin/Desktop/OmniSight/src/api/client.ts)):**
   - Configurable `baseUrl`, default timeouts, parameter serialization, and AbortController cancellation.
   - Automatically sanitizes error payloads to remove token and password markers before UI display.
2. **Domain Adapters ([`adapters.ts`](file:///c:/Users/admin/Desktop/OmniSight/src/api/adapters.ts)):**
   - Converts backend Pydantic schemas (`BackendJobResponse`, `BackendArtifactRef`) into frontend presentation models (`InspectionJob`, `InspectionEvidence`).
   - Normalizes state transitions and protects against missing or malformed fields (`website_url`, `created_at`, `inspection` duration).
3. **Dual-Mode Visual Indicator:**
   - Every dashboard view renders a pulsing status badge indicating whether the current view is sourced from the **Live Backend API** or the **Demo Fallback Database**.

---

## 6. Current Implementation Status & Known Limitations

| Feature / Module | Status | Notes |
| :--- | :--- | :--- |
| **QA Overview Dashboard (`/qa`)** | **Complete** | Real-time telemetry, status distribution, and empty simulation mode. |
| **Inspection Job History (`/qa/jobs`)** | **Complete** | Search, status filter, validation filter, and direct navigation links. |
| **Job Details (`/qa/jobs/:id`)** | **Complete** | Playwright telemetry, validation results, repair actions, and evidence. |
| **Defect Findings Hub (`/qa/defects`)** | **Complete** | Severity triage, DOM selector inspection, and job detail linkages. |
| **Self-Healing PRs (`/qa/pull-requests`)**| **Complete** | Full PR console tracking repair branches, commits, PR URLs, and safety metrics. |
| **GitHub Integration Service** | **Complete** | Branch/commit/PR workflows, permission checking, allowlists, and backoff retries. |
| **Safety Invariants & Gates** | **Complete** | Validation gate (100% pass), base branch protection, `draft: true` invariant. |
| **Real-time Live Polling / SSE** | *Pending P3* | P3 backend currently provides REST endpoints; live SSE streaming will be integrated once P3 publishes event streams. |
| **Storefront Target Inspection** | *Pending P1/P2* | Benchmark storefront routes are live; full end-to-end VLM patch ingestion will execute via backend CI pipeline. |
