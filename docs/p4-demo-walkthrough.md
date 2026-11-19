# OmniSight — P4 Reproducible Demo Walkthrough

**Author:** Person 4 (GitHub Integration & QA Dashboard — Sahil)  
**System:** OmniSight QA Platform  
**Target Audience:** Engineering Leads, Teammates, and QA Reviewers  
**Prerequisites:** Node.js >= 20.19.0 or >= 22.12.0, dependencies installed via `npm install`  

---

## 1. Demo Overview & Ground Rules

This walkthrough demonstrates the end-to-end functionality implemented in the **P4 workstream** over the 20-day delivery plan.

### Rules of Engagement:
- **No Fabricated Production Claims:** Dual-mode badges clearly distinguish whether the view is displaying live backend API data or the resilient demo fallback database.
- **Zero Real GitHub Writes in Test Mode:** Automated test suites mock GitHub network calls to ensure no unauthorized commits or branches are pushed to GitHub.
- **Strict Safety Invariants:** Pull requests are strictly created as **Drafts**, base branches (`main`, `master`) are protected against direct writes, and mutations are halted if validation has not passed.

---

## 2. Step-by-Step Walkthrough

### Step 1: Opening the QA Dashboard Overview
- **Starting URL:** `http://localhost:5173/qa` (or root `/` with navigation link to QA Dashboard in header).
- **User Action:** Open browser to `http://localhost:5173/qa`.
- **Expected Result:**
  - Page header displays: `"QA Overview — Monitor UI inspections, detected defects, and self-healing validation outcomes"`.
  - Data source indicator displays `"Live Backend API"` (green pulse) if FastAPI is running, or `"Demo Data Fallback"` (amber pulse) if backend is offline.
  - 4 Executive StatCards render: Total Inspections, Passed Inspections, Defects Detected, and Pending Reviews.
  - Recent jobs table displays the 10 most recent runs with status badges (`running`, `passed`, `failed`).
  - Action button `"Simulate Empty"` can be clicked to demonstrate the empty-state resilience UI.
- **Data Source:** `useInspectionJobs({ limit: 10 })` querying `GET /api/jobs` or falling back to `MOCK_INSPECTION_JOBS`.

---

### Step 2: Navigating to Inspection Job History
- **Starting Page:** QA Overview (`/qa`).
- **User Action:** Click `"Inspection Jobs"` in the sidebar or `"Explore All Inspection Jobs →"` in the roadmap panel.
- **Expected Result:**
  - Route transitions to `/qa/jobs`.
  - Breadcrumbs display: `QA Overview / Inspection Jobs`.
  - Filter toolbar displays search input, Status filter dropdown, and Validation filter dropdown.
  - Table displays all historical inspection jobs with Job ID, Application, Route, Timestamp, Status, Defect count, and Validation Status.
  - **Interaction Test:** Type `"cart"` in the search box; the list immediately filters to only show runs on `/cart`.
  - **Interaction Test:** Select Validation filter `"Validated (Passed)"`; table filters down to validated healing runs (e.g. `JOB-1083`).
  - **Interaction Test:** Click `"Reset all"` / `"Clear Filters ×"`; table restores full list.
- **Data Source:** `useInspectionJobs()` querying `GET /api/jobs` or fallback jobs.

---

### Step 3: Opening a Job and Reviewing Defect Findings
- **Starting Page:** Job History (`/qa/jobs`).
- **User Action:** Locate Job `#JOB-1083` (or type `1083` in search) and click `"View Details →"`.
- **Expected Result:**
  - Route transitions to `/qa/jobs/JOB-1083`.
  - Breadcrumbs display: `QA Overview / Inspection Jobs / #JOB-1083`.
  - Executive telemetry displays: Status `"Failed"` (pre-healing baseline), Validation Status `"Validated (Passed)"`, Defects `"1 defect detected"`, Viewport `"Desktop (1440 × 900)"`.
  - Scroll to Section 6 (**Defect Findings**):
    - Defect card displays: `DEF-188: Proceed to Checkout button low contrast ratio`.
    - Severity badge displays `HIGH` (amber/orange).
    - Category displays `Accessibility / Contrast`.
    - Status badge displays `Resolved` (green).
    - DOM Locator code block displays: `.cart-summary .btn-checkout`.
    - Description explains: *"Text color #94a3b8 on background #dbeafe provides only 2.4:1 contrast (WCAG AA requires 4.5:1)"*.
    - Button displays: `"Inspect in Comparison Viewer →"`.
- **Data Source:** `useInspectionJobDetails("JOB-1083")` querying `GET /api/jobs/JOB-1083`.

---

### Step 4: Viewing Before/After Visual Evidence
- **Starting Page:** Job Details (`/qa/jobs/JOB-1083`).
- **User Action:** Scroll to Section 7 (**Visual Evidence & Inspection Artifacts**), or click `"Inspect in Comparison Viewer →"` in defect `DEF-188`.
- **Expected Result:**
  - Browser smoothly scrolls to `#visual-evidence-viewer`.
  - Visual evidence viewer renders the side-by-side comparison:
    - **Baseline Label:** `"WCAG AA Baseline (Expected)"`.
    - **Defective Label:** `"Uncaptured Defective State"`.
    - Resolution watermark: `1440 × 900 px`.
    - Diagnostic metadata tags: Artifact ID `EVI-288`, Viewport `Desktop (1440 × 900)`, Browser `Chromium Headless (Playwright v1.48.0)`.
  - For jobs with Playwright traces (e.g. `JOB-1084`), trace cards display HAR network recording status and console log timeline.
- **Data Source:** `job.evidence` array containing `InspectionEvidence` models.

---

### Step 5: Inspecting Validation Results
- **Starting Page:** Job Details (`/qa/jobs/JOB-1083`).
- **User Action:** Scroll to Section 5 (**Self-Healing Validation Outcomes**).
- **Expected Result:**
  - Header displays: `"Self-Healing Validation Outcomes"` with Status badge `"Validation Passed"`.
  - StatCards display: Total Checks: `3`, Checks Passed: `3` (100%), Checks Failed: `0`, Duration: `24s`.
  - Checks list details:
    1. `VAL-101`: `WCAG 2.1 AA Contrast Ratio Verification` (Passed, 4.2s) — Assertion: `Color Contrast Ratio`, Actual: `4.8:1 (Passed AA standard)`, Expected: `≥ 4.5:1`. Clicking the evidence pill jumps directly to `EVI-288`.
    2. `VAL-102`: `Button Layout & Bounding Box Inspection` (Passed, 2.1s) — Target: `.cart-summary .btn-checkout`.
    3. `VAL-103`: `Cart State Re-hydration Assertion` (Passed, 1.8s) — Target: `CartContext.tsx`.
- **Data Source:** `job.validation` containing `JobValidationResult`.

---

### Step 6: Reviewing the GitHub Repair Branch & Commit Workflow
- **Starting Page:** Job Details (`/qa/jobs/JOB-1083`).
- **User Action:** Inspect Section 5b (**Automated Repair Branch Workflow**).
- **Expected Result:**
  - Status indicator displays: `"Validation Gate Verified — 100% automated check passage verified. Eligible for repair branch staging."`
  - Action card displays: Target Repository `Veggies02/OmniSight`, Base Branch `main`, Safe Branch Slug `omnisight/repair-JOB-1083`.
  - User can click `"Stage Repair Branch & Commit"`.
  - The service executes `clientGitHubService.triggerRepairWorkflow()` with validated repair patches.
  - Upon completion, the card reveals:
    - Confirmed Branch: `omnisight/repair-JOB-1083`.
    - Confirmed Commit SHA: `commit_sha_def456` (or generated SHA).
    - Changed Files: `src/pages/Cart.tsx`.
    - Safety Badges: `Validation Gate Verified`, `Base Branch Shielded`.
- **Data Source:** `RepairBranchWorkflowAction.tsx` communicating with backend or server-side service.

---

### Step 7: Creating or Viewing a Draft Pull Request
- **Starting Page:** Job Details (`/qa/jobs/JOB-1083`) inside Section 5b.
- **User Action:** Click `"Create Draft Pull Request"`.
- **Expected Result:**
  - Workflow validates that validation passed, commit SHA exists, and base branch differs from repair branch.
  - Creates draft PR via `clientGitHubService.createDraftPullRequest()`.
  - The card displays the confirmed draft PR:
    - Badge: `"Draft PR #42"` (Draft status guaranteed).
    - Source: `omnisight/repair-JOB-1083` → Base: `main`.
    - PR Link: `https://github.com/Veggies02/OmniSight/pull/42`.
    - Notice: `"⚠️ Draft-only invariant enforced: Automated pull requests require team code-owner triage before merging."`
- **Navigation:** Click `"Self-Healing PRs"` in sidebar (`/qa/pull-requests`).
  - Table lists `#JOB-1083` with Draft PR badge and external GitHub link `PR ↗`.
- **Data Source:** `DraftPullRequestAction.tsx` and `DashboardPullRequests.tsx`.

---

### Step 8: Demonstrating Error Handling and Validation Safeguards
- **Starting Page:** Job History (`/qa/jobs`).
- **User Action:** Open Job `#JOB-1080` (a job where validation failed with 2 regression assertion failures).
- **Expected Result:**
  - Section 5 (**Validation Results**) renders: `"Validation Failed"` with amber alert: *"2 regression assertions failed on 768px tablet layout: floating label collision and delivery option label truncation"*.
  - Section 5b (**Repair Workflow**) displays a disabled/blocked staging action:
    - `"Validation Gate Blocked: Current validation status is 'failed'. Automated repair branches and commits require status to be explicitly 'passed'."`
    - Button to stage repair branch or PR is blocked, preventing broken code from ever being committed to GitHub.
- **Data Source:** `validationGate.ts` (`assertValidationPassed`).

---

## 3. Demo Verification Checklist

| Step | Tested Feature | Status | Verification Check |
| :---: | :--- | :---: | :--- |
| **1** | QA Overview Telemetry & Badges | Verified | Sourced from hook; empty state simulator works cleanly. |
| **2** | Job History Filter & Reset | Verified | Multi-field search and status filters operate smoothly. |
| **3** | Defect Findings & Severity Triage | Verified | Severity badges, DOM selector code, and job linkages confirmed. |
| **4** | Visual Evidence Split Comparison | Verified | Side-by-side labels, dimensions, and jump links verified. |
| **5** | Validation Results & Assertions | Verified | 100% pass verification and check counts match accurately. |
| **6** | Repair Branch & Commit Workflow | Verified | Safe slug generation, commit linking, and base protection verified. |
| **7** | Draft Pull Request Generation | Verified | Strict `draft: true` invariant and idempotency confirmed. |
| **8** | Error Handling & Gate Halts | Verified | Unvalidated jobs (`JOB-1080`) are blocked from PR staging. |
