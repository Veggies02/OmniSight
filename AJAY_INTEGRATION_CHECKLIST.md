# Ajay's Individual Responsibilities & Integration Checklist

**Owner:** Ajay Kowkuntla (Senior Full-Stack Integration Engineer & Browser Automation Architect)  
**Branch:** `feature/ajay-security-sandbox` (HEAD: `bcbc607`)  
**Last Verified:** 2026-11-19T21:12:00+05:30  
**Project:** OmniSight — Multimodal UI Self-Healing & RPA Agent  

---

## 1. Scope of Individual Responsibilities

Ajay owns five core functional domains within OmniSight:
1. **OmniShop Target Storefront:** End-to-end mock e-commerce web application serving as the monitored real-world target.
2. **Defect Injection Engine:** Controlled, deterministic injection of visual regressions and UI defects across 4 realistic scenarios.
3. **Playwright Automation Harness:** Browser automation infrastructure capturing baseline/defective screenshots, sanitized DOM snapshots, and layout metrics.
4. **Isolated Worktree Repair Worker:** Safe git worktree isolation, patch application, build execution, regression test verification, and automated post-repair visual delta checks.
5. **Frontend Review & Integration Bridge:** Secure review dashboard, UI human-approval binding, cryptographic digest matching, and frontend-backend connectivity.

---

## 2. Task Checklist & Verification Status

### A. OmniShop Mock E-Commerce Application

- [x] **Storefront Architecture:** Modern React 19 + TypeScript + Vite architecture with responsive layouts.
- [x] **Homepage (`/`):** Hero banner, value propositions, category navigation, and featured product grid.
- [x] **Product Listing (`/products`):** Dynamic category filtering (`Audio`, `Wearables`, `Accessories`), stock counters, and search query synchronization.
- [x] **Product Detail View (`/products/:id`):** Multi-angle gallery, quantity selector, specs breakdown, and out-of-stock disabling.
- [x] **Cart State Management (`/cart`):** Centralized `CartContext` supporting add, update, remove, clear, and integer-cents total calculation without floating-point drift.
- [x] **Checkout Flow (`/checkout`):** Form validation (email, shipping address, postal code) and empty-cart protection.
- [x] **Responsive Layouts:** Viewport-tested at Desktop (1440×900), Tablet (768×1024), and Mobile (390×844) without unintended horizontal scrolling.
- [x] **Accessibility & Semantics:** WCAG AA compliant contrast in baseline state, keyboard navigation, skip-to-content anchors, and reduced-motion support.

### B. Controlled Defect Injection Engine

- [x] **Deterministic Activation:** Defects activate strictly via `?defect=<scenario-id>` when `sessionStorage["omnisight:enable-defects"] === "true"`.
- [x] **Scenario 1: `product-image-distortion`:** Overrides `.product-image` with `object-fit: fill` and scaling transform causing visible aspect ratio distortion.
- [x] **Scenario 2: `product-card-layout-break`:** Injects negative margins and absolute offsets displacing the footer buttons outside the product card container.
- [x] **Scenario 3: `low-contrast-text`:** Overrides `.product-snippet` color to pale slate grey (`#cbd5e1`), dropping contrast below 1.5:1.
- [x] **Scenario 4: `mobile-nav-overflow`:** Forces `min-width: 650px` on mobile navbar in 390px viewport, causing page horizontal scrolling.
- [x] **Safety & Reversibility:** Navigating without query parameters immediately returns the clean baseline state. Cart and state are untouched.
- [x] **Production Build Isolation:** Defect metadata and controllers are stripped or disabled in production builds.

### C. Playwright Browser Automation & Capture Harness

- [x] **Clean Launch & Teardown:** Automated headless Chromium lifecycle with proper session isolation.
- [x] **Dual Evidence Capture:** Captures clean baseline state and defective state for all 4 scenarios in identical conditions.
- [x] **DOM Snapshot Generation:** Full outer HTML snapshot serialized and sanitized.
- [x] **Layout Metric Extraction:** Computes bounding boxes, aspect ratios, contrast ratios, and scrollWidth dimensions into `measurements.json`.
- [x] **Manifest Construction:** Writes structured `manifest.json` indexing all evidence files with run-level metadata.
- [x] **Anti-Leakage Sanitization:** Strips defect query parameters, developer paths, internal defect IDs, and CSS comments before model ingestion.
- [x] **CLI Interface:** Invoked via `npm run capture:evidence -- --base-url=http://127.0.0.1:5173`.

### D. Isolated Repair Execution Worker (`npm run repair:execute`)

- [x] **Input Validation:** Strict regex enforcement on `--job-id`, `--proposal`, `--base-commit`, and `--patch`.
- [x] **Human Approval Safety Gate:** Refuses execution unless proposal has `humanReviewStatus: "approved"` and `approvalDigest === proposalDigest`.
- [x] **Git Worktree Isolation:** Spawns clean worktree at `artifacts/repair-worktrees/<jobId>` on dedicated branch `omnisight-repair/<jobId>`.
- [x] **Deterministic Patch Application:** Validates and applies exact registered patch from registry.
- [x] **Automated Build Execution:** Runs `npm run build` inside worktree and inspects exit code.
- [x] **Regression Test Execution:** Runs Playwright test suite inside worktree.
- [x] **Headless Visual Verifier:** Evaluates computed CSS and DOM metrics in worktree to confirm defect resolution.
- [x] **Worktree Teardown:** Safely unmounts and removes worktree directory while preserving the Git commit branch for human review and pull request creation.
- [x] **Execution Report:** Writes detailed `repair_execution_report.json` with duration, test counts, visual check details, and commit SHA.

### E. Frontend Review & Integration Bridge

- [x] **Review Dashboard (`/review`):** Displays queue of AI-diagnosed repair proposals with defect categories, confidence scores, and source status.
- [x] **Proposal Detail View (`/review/proposals/:id`):** Displays side-by-side visual evidence, DOM excerpts, and before/after code diffs.
- [x] **Cryptographic Approval:** Calculates `SHA-256` digest across proposal payload via Web Crypto API and binds `approvalDigest: proposalDigest`.
- [x] **Tamper Rejection:** Automatically rejects approval if proposed code is tampered with post-generation.
- [x] **Backend API Client:** Full REST integration via `backendRepairClient.ts` communicating with FastAPI endpoints.

---

## 3. Test Evidence Summary

| Test Suite | Spec File | Tests Passed | Duration | Status |
| :--- | :--- | :---: | :---: | :---: |
| **OmniShop Cart & Stock** | [`tests/shopping-cart.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/shopping-cart.spec.ts) | 11 / 11 | 4.3s | **PASSED** |
| **Checkout Flow** | [`tests/checkout.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/checkout.spec.ts) | 4 / 4 | 1.4s | **PASSED** |
| **Responsive Viewports** | [`tests/responsive.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/responsive.spec.ts) | 10 / 10 | 2.1s | **PASSED** |
| **Defect Injection Engine** | [`tests/defect-injection.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/defect-injection.spec.ts) | 7 / 7 | 2.2s | **PASSED** |
| **Capture Harness CLI** | [`tests/capture-cli.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/capture-cli.spec.ts) | 6 / 6 | 1.1s | **PASSED** |
| **Evidence Harness & Sanitization** | [`tests/evidence-harness.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/evidence-harness.spec.ts) | 7 / 7 | 8.9s | **PASSED** |
| **Visual Evidence Viewer** | [`tests/evidence-viewer.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/evidence-viewer.spec.ts) | 6 / 6 | 3.4s | **PASSED** |
| **Repair CLI Unit Tests** | [`tests/run-repair-job.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/run-repair-job.spec.ts) | 26 / 26 | 12.4s | **PASSED** |
| **Frontend Integration** | [`tests/repair-frontend-integration.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/repair-frontend-integration.spec.ts) | 6 / 6 | 3.4s | **PASSED** |
| **Fresh Flow End-to-End** | [`tests/fresh-self-healing-flow.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/fresh-self-healing-flow.spec.ts) | 3 / 3 | 1.3s | **PASSED** |
| **Multi-Scenario Orchestration** | [`tests/multi-scenario-workflow.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/multi-scenario-workflow.spec.ts) | 10 / 10 | 2.8s | **PASSED** |
| **Post-Repair Verification** | [`tests/post-repair-verification.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/post-repair-verification.spec.ts) | 9 / 9 | 4.0s | **PASSED** |
| **Full E2E Repair Lifecycle** | [`tests/e2e-repair-workflow.spec.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/tests/e2e-repair-workflow.spec.ts) | 7 / 7 | 14.0s | **PASSED** |
| **Total Ajay Responsibilities** | **13 Playwright Suites** | **112 / 112** | **~60s** | **100% PASSED** |

---

## 4. Remaining Tasks for Ajay

1. **Pre-Demo Dry Runs (19–21 Dec):** Re-execute full clean workflow alongside live screen recording.
2. **Video Presentation Support (22 Dec):** Present OmniShop architecture, Playwright capture pipeline, and isolated repair verification during the team video submission.
3. **Optional Live Gemini Re-Verification:** Once a team Google Cloud Gemini API key is supplied, run a live inference verification pass for the video recording.
