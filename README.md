# OmniSight — Mock E-Commerce Storefront (OmniShop)

**Day 1 Implementation: Baseline Mock E-Commerce, Functional Shopping Cart & UI Defect-Injection Framework**
**Role:** Mock E-Commerce Application & Browser Automation
**Assigned Developer:** Ajay
**Feature Branch:** `feature/ajay-defect-injection`

---

## 1. Overview

**OmniShop** is the mock e-commerce test website created for the **OmniSight** system. OmniSight is an AI-powered UI defect detection and self-healing system that opens web applications via Playwright, analyzes visual evidence with a Vision-Language Model (VLM), detects defects, locates source code, and proposes automated fixes.

OmniShop serves as the benchmark target application that undergoes controlled defect injection and automated visual inspections.

---

## 2. Technology Stack

- **React 19** (`react`, `react-dom`)
- **TypeScript** (Strict mode)
- **Vite 6** (Fast build tool & HMR)
- **React Router DOM v7** (Declarative client-side routing & search parameters)
- **Vanilla CSS** (Custom responsive design tokens, glassmorphism, responsive grids, isolated defect styles)
- **Playwright** (`@playwright/test` for Chromium end-to-end, responsive validation, and defect verification)
- **npm** (Package management)

---

## 3. Project Structure

```text
OmniSight/
├── artifacts/
│   └── screenshots/        # Clean baseline screenshots for OmniSight VLM inspection
├── public/                 # Static assets
├── src/
│   ├── components/
│   │   ├── Navbar.tsx      # Reusable sticky navigation with live cart badge & defect hooks
│   │   ├── ProductCard.tsx # Reusable card with Add to Cart, stock status & defect hooks
│   │   └── Footer.tsx      # Reusable footer with brand and status notes
│   ├── context/
│   │   ├── CartContext.tsx # React Context & Reducer for cart state and persistence
│   │   └── DefectContext.tsx # Defect injection engine reading URL params & emitting metadata
│   ├── hooks/
│   │   ├── useCart.ts      # Custom hook to access shared cart operations
│   │   └── useDefects.ts   # Custom hook to check active defect status
│   ├── pages/
│   │   ├── Home.tsx        # Hero section + 4 featured product cards + benefits
│   │   ├── Products.tsx    # Full catalog with search & category filtering
│   │   ├── ProductDetails.tsx # Route-based details (/products/:id) & quantity adder
│   │   ├── Cart.tsx        # Functional shopping cart with line totals & controls
│   │   ├── Checkout.tsx    # Demo checkout summary with shipping form & confirmation
│   │   └── NotFound.tsx    # 404 fallback for unmatched routes
│   ├── data/
│   │   ├── products.ts     # Separated typed product dataset with stable images
│   │   └── defects.ts      # Typed registry of controlled defect definitions
│   ├── App.tsx             # Root router setup wrapped in CartProvider & DefectProvider
│   ├── main.tsx            # React root mount with StrictMode
│   └── index.css           # Design tokens, typography, media queries & defect styles
├── tests/
│   ├── shopping-cart.spec.ts # Cart operations, stock disabling, and persistence
│   ├── checkout.spec.ts     # Checkout validation and order placement simulation
│   ├── responsive.spec.ts   # Multi-viewport (1440x900, 768x1024, 390x844) overflow checks
│   ├── defect-injection.spec.ts # Defect framework activation, isolation, and reversibility
│   └── screenshots.spec.ts  # Baseline screenshot capture
├── playwright.config.ts    # Playwright configuration with webServer integration
├── index.html              # HTML shell with accessibility metadata
├── package.json            # Scripts and dependencies
├── tsconfig.json           # TypeScript configuration
└── vite.config.ts          # Vite configuration
```

---

## 4. Configured Page Routes

| Route | Component | Status | Description |
|---|---|---|---|
| `/` | `Home` | Complete | Brand hero section, "Shop Now" CTA, and 4 featured product cards |
| `/products` | `Products` | Complete | Catalog grid with real-time category filtering, search, direct Add to Cart, and defect injection |
| `/products/:id` | `ProductDetails` | Complete | Dynamic product route with quantity selector, out-of-stock guard, and specs |
| `/cart` | `Cart` | Complete | Functional cart: quantity adjustments (+/−), item removal, line totals, and subtotal |
| `/checkout` | `Checkout` | Complete | Demo checkout: customer shipping form, order preview, and demo confirmation |
| `*` | `NotFound` | Complete | Graceful 404 fallback page with return navigation links |

---

## 5. UI Defect-Injection Framework

### Why OmniSight Needs Defect Injection
To rigorously benchmark OmniSight's multimodal VLM detection and automated repair pipeline, we must introduce **reproducible, controlled visual and layout defects**. Instead of modifying code destructively or relying on unpredictable bugs, defects can be activated deterministically on-demand via URL query parameters.

> **Important Distinction**:
> - **Seeded Defect**: The intentionally activated ground-truth test configuration controlled via `?defect=<id>`.
> - **AI-Detected Defect**: The defect that the Vision-Language Model independently identifies solely from screenshots and DOM evidence, without reading the internal registry.

### Supported Defect Scenarios

| Defect ID | Category | Target Component & Route | Activation URL | Expected Symptom |
|---|---|---|---|---|
| `product-image-distortion` | Visual Distortion | `ProductCard` on `/products` | `/products?defect=product-image-distortion` | Image aspect ratio is distorted via `object-fit: fill` and skewed vertical stretch (`height: 380px`). |
| `product-card-layout-break` | Layout Shift | `ProductCard` on `/products` | `/products?defect=product-card-layout-break` | Card body overlaps the image vertically and action footer is positioned out of card boundaries. |
| `low-contrast-text` | Color Contrast | `ProductCard` on `/products` | `/products?defect=low-contrast-text` | Text snippets, titles, and prices render in `#cbd5e1` light grey against a white card, violating WCAG AA. |
| `mobile-nav-overflow` | Responsive Overflow | `Navbar` on all routes | `/products?defect=mobile-nav-overflow` | Navigation container forces `650px` width on mobile screens, creating unintended horizontal scroll overflow. |

### How It Works & Safety Controls
1. **Disabled by Default in Production**: In production builds (`import.meta.env.PROD`), defect injection is disabled by default to protect end users. Even if `?defect=...` is appended, defects will not activate unless explicitly enabled via environment configuration (`VITE_ENABLE_DEFECTS="true"`) or test-session override (`sessionStorage.setItem("omnisight:enable-defects", "true")`).
2. **Enabled in Development**: In development mode (`import.meta.env.DEV`), defect injection is enabled by default to facilitate local inspection and debugging.
3. **Deterministic Activation**: Triggered solely via `?defect=<defect-id>`. Removing the parameter immediately restores clean baseline appearance.
4. **Fail-Safe**: Unknown defect IDs fail safely and maintain standard layout.
5. **State Isolation**: Defect styles are scoped strictly via specific classes (e.g. `.defect-product-image-distortion`) and do not corrupt cart state, product prices, or checkout logic.
6. **DOM Inspection Metadata**: Emits an invisible inspection element `<div id="omnisight-defect-metadata" ... />` detailing ground-truth active defect properties, category, target selector, and injection status (`data-defect-injection-enabled`) for test evaluation.

---

## 6. Getting Started Locally

### Prerequisites
- Node.js (v18+ recommended)
- npm (v9+ recommended)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Development Server
```bash
npm run dev
```
Local development URL: **http://localhost:5173/** (or `http://127.0.0.1:5173/`)

### 3. Run Production Build & Type Check
```bash
npm run build
```

### 4. Run Automated Playwright E2E Tests
```bash
npm run test:e2e
```

### 5. Run Visual Evidence Capture Harness
```bash
npm run capture:evidence
```
Captures deterministic clean baseline and defective screenshot pairs, DOM snapshots, and quantitative visual measurements across all seeded defect scenarios.

### 6. Run Blind VLM Defect Diagnosis
```bash
npm run diagnose:evidence
# Or with options:
# npm run diagnose:evidence -- --provider=mock
# npm run diagnose:evidence -- --run-id=<id> --provider=gemini
```
Executes blind multimodal VLM inspection against sanitized evidence without ground-truth leakage.

### 7. Evaluate Diagnosis Accuracy
```bash
npm run evaluate:diagnoses
# Or against specific diagnosis output:
# npm run evaluate:diagnoses -- --diagnosis=artifacts/diagnoses/<diagnosis-file>.json
```
Evaluates structured VLM diagnosis reports against ground-truth evaluation standards.

### 8. Generate Defect Repair Proposals
```bash
npm run repair:proposals
# Or with options:
# npm run repair:proposals -- --run-id=<id>
# npm run repair:proposals -- --diagnosis=artifacts/visual-evidence/<run-id>/diagnoses/diagnoses-manifest.json
```
Inspects real source files, verifies source freshness and safety allowlists, and generates bounded repair proposals for human review.

---

## 7. Visual Evidence Capture Harness (Step 4.2)

### Overview & Purpose
The **Visual Evidence Capture Harness** (`scripts/capture-visual-evidence.ts`) is designed to generate paired, deterministic evaluation datasets for the OmniSight multimodal VLM inspection pipeline. For each seeded defect, the harness executes paired inspections (clean baseline vs. defective state) under identical browser viewports and settings.

### Artifacts Directory Layout
Each capture session generates an isolated, timestamped run directory under `artifacts/visual-evidence/<run-id>/`:

```text
artifacts/visual-evidence/<run-id>/
├── manifest.json                  # Overall run summary, status, and scenario index
├── model_facing_evidence.json     # Blind model-facing payload (WITHOUT ground-truth defect labels)
├── ground_truth_eval.json         # Evaluation record with expected defect IDs and measured deltas
├── product-image-distortion/
│   ├── baseline.png               # Clean image screenshot (1440x900)
│   ├── defective.png              # Distorted image screenshot (1440x900)
│   ├── dom-baseline.html          # Clean DOM snapshot (metadata stripped)
│   ├── dom-defective.html         # Defective DOM snapshot (metadata stripped)
│   ├── measurements-baseline.json # Bounding boxes and computed styles (clean)
│   ├── measurements-defective.json# Bounding boxes and computed styles (defective)
│   └── measurements.json          # Paired delta measurements
├── product-card-layout-break/
├── low-contrast-text/
└── mobile-nav-overflow/
```

### Separation of Ground Truth vs. Model Input
To ensure rigorous evaluation without data leakage:
- **`model_facing_evidence.json` & `dom-*.html`**: Contain only screenshots, page metadata, console logs, and cleaned DOM snapshots. All hidden defect metadata tags (`#omnisight-defect-metadata`), attributes (`data-defect-applied`), and internal defect classes (`.defect-*`) are completely stripped.
- **`ground_truth_eval.json`**: Preserves ground-truth defect IDs, expected categories, expected symptoms, target component names, and calculated metric deltas for automated benchmark scoring.

### Measured Metrics by Scenario
1. **Product Image Distortion (`product-image-distortion`)**:
   - `object-fit` (`cover` vs `fill`)
   - Rendered media container height (`265px` vs `380px`)
   - Natural vs rendered image aspect ratios
2. **Product Card Layout Breakage (`product-card-layout-break`)**:
   - Card, body, and footer bounding boxes
   - Footer positioning (`static` vs `absolute`, `bottom: -45px`)
   - Physical footer protrusion below card boundary (`0px` baseline vs `28px` defective)
3. **Low-Contrast Text Element (`low-contrast-text`)**:
   - Foreground and background rendered sRGB colors
   - Relative luminance and calculated WCAG 2.1 contrast ratio (`4.76:1` baseline vs `1.48:1` defective)
   - WCAG AA (`>= 4.5:1`) compliance evaluation
4. **Mobile Navigation Overflow (`mobile-nav-overflow`)**:
   - Viewport dimensions (`390px × 844px`)
   - Document `clientWidth` (`390px`) vs `scrollWidth` (`390px` baseline vs `650px` defective)
   - Calculated horizontal overflow (`0px` vs `260px`)

---

## 8. VLM Integration & Blind Defect Diagnosis (Step 4.3)

### Overview & Architecture
The **VLM Defect Diagnosis Pipeline** (`scripts/run-diagnosis.ts` & `scripts/vlm/`) provides automated visual and structural defect inspection powered by Vision-Language Models (supporting Gemini, OpenAI, Claude, and offline Mock providers):

```text
Evidence Capture Run (artifacts/visual-evidence/<run-id>/)
                       │
                       ▼
       ┌───────────────────────────────┐
       │   Evidence Sanitizer Guard    │  ◄── Enforces Zero Ground-Truth Leakage
       │  (assertNoGroundTruthLeakage) │      Strips defect IDs, names, hints
       └──────────────┬────────────────┘
                      │ Sanitized blind evidence
                      ▼
       ┌───────────────────────────────┐
       │    VLM Provider & Prompts     │  ◄── Multi-image inspection (baseline + defective)
       │    (Gemini / Claude / Mock)   │      + DOM context + layout metrics
       └──────────────┬────────────────┘
                      │ Raw JSON response
                      ▼
       ┌───────────────────────────────┐
       │   Zod Schema Validation &     │  ◄── Strict typing, confidence bounds [0, 1],
       │     Structured Diagnosis      │      category taxonomy enforcement
       └──────────────┬────────────────┘
                      │
                      ▼
Structured Diagnosis Output (artifacts/diagnoses/diagnosis_<run-id>_<timestamp>.json)
                      │
                      ▼
       ┌───────────────────────────────┐
       │      Diagnosis Evaluator      │  ◄── Compares against ground_truth_eval.json
       │ (scripts/evaluate-diagnoses)  │      Calculates category accuracy, localization,
       └───────────────────────────────┘      and score metrics without model bias
```

### Zero-Leakage Guarantee
The sanitizer strictly validates:
- No mentions of ground-truth defect identifiers (`product-image-distortion`, `product-card-layout-break`, etc.) in prompts or model payloads.
- DOM and CSS class sanitization removing `.defect-*` and `#omnisight-defect-metadata`.
- Strict blind prompts instructing the model to observe only the visual renders and sanitized DOM.

### Supported Providers
- **`mock`**: Deterministic offline provider for test suites, CI/CD, and regression tests (100% free, no API keys).
- **`gemini`**: Live inference via Google Gemini Multimodal APIs (`GEMINI_API_KEY`).
- **`openai`**: Live inference via OpenAI GPT-4o / GPT-4-vision (`OPENAI_API_KEY`).
- **`claude`**: Live inference via Anthropic Claude 3.5 Sonnet (`ANTHROPIC_API_KEY`).

---

## 9. Defect Localization & Repair Proposals (Step 4.4)

### Overview & Workflow
The **Defect Localization and Repair Proposal Pipeline** (`scripts/generate-repair-proposals.ts` & `scripts/vlm/repair-proposal-service.ts`) bridges VLM diagnoses to verified, non-destructive source code repair recommendations:

```text
Validated Diagnosis (diagnoses-manifest.json)
                      │
                      ▼
       ┌───────────────────────────────┐
       │     Security Path Guard       │  ◄── Enforces SOURCE_FILE_ALLOWLIST
       │ (validateAndResolveSourcePath)│      Rejects traversal, configs, secrets
       └──────────────┬────────────────┘
                      │ Verified allowlisted path
                      ▼
       ┌───────────────────────────────┐
       │   Source Localization Engine  │  ◄── Inspects real CSS & React source files
       │  (SourceLocalizationService)  │      Computes SHA-256 hash & bounded excerpt
       └──────────────┬────────────────┘
                      │ Bounded excerpt & hash
                      ▼
       ┌───────────────────────────────┐
       │    Source Freshness Guard     │  ◄── Validates recorded hash vs. disk state
       │ (verifySourceHashFreshness)   │      Rejects stale proposals if source changed
       └──────────────┬────────────────┘
                      │ Confirmed fresh
                      ▼
       ┌───────────────────────────────┐
       │     Repair Proposal Engine    │  ◄── Generates minimal, non-destructive diff,
       │    (RepairProposalService)    │      assesses risks, determines required tests
       └──────────────┬────────────────┘
                      │
                      ▼
Human Review Artifacts (artifacts/repair-proposals/<run-id>/)
├── repair_proposals.json              # Full validated proposals with code diffs
├── source_localization.json           # Component/CSS mapping & line-bounded excerpts
├── repair_proposal_summary.md         # Markdown summary table for reviewers
└── manifest.json                      # Run manifest
```

### Security & Safety Guardrails
1. **Source File Allowlist (`SOURCE_FILE_ALLOWLIST`)**:
   - Only approved UI stylesheets and components (`src/index.css`, `src/components/*.tsx`, `src/pages/*.tsx`) can be inspected.
   - Strictly rejects absolute paths (`/etc/passwd`), path traversal (`../`), build outputs (`dist/`), environment files (`.env`), lockfiles (`package-lock.json`), and configuration files.
2. **Strict Non-Destructive Invariant**:
   - The proposal engine **never modifies application source code** and **never applies automated patches**.
   - All proposals set `humanReviewStatus: "pending_review"` for mandatory developer inspection.
3. **Concurrent Modification & Stale Source Detection**:
   - Every localized excerpt records a 64-character SHA-256 hash of the target file.
   - If the file is modified on disk after inspection, proposal generation marks the status as `stale_source` and rejects the proposal.
4. **Unsupported Category Handling**:
   - Unknown or inconclusive diagnoses are marked with `status: "inconclusive"` or `"unsupported_category"` rather than inventing hallucinated repairs.

---

## 10. Human-in-the-Loop Repair Review Dashboard (Step 4.5)

### Overview & Purpose
The **Human-in-the-Loop Repair Review Console** provides an interactive web interface accessible at `/review` allowing human reviewers to inspect, compare, evaluate, and approve or reject AI-generated UI repair proposals.

> **CRITICAL INVARIANT**:
> **Approval records human acceptance of a repair proposal. It does not apply code changes or prove that a repair is correct.**
>
> Approving a proposal in this interface **never modifies application source code, never creates Git commits, and never applies automated patches**. Patch application and sandbox regression verification are reserved for Step 4.6.

### Review Dashboard Routes
- `/review` (or `/review/proposals`): Main proposal queue, summary metrics, category filters, freshness filters, and text search.
- `/review/proposals/:proposalId`: Detailed proposal inspector displaying paired visual evidence (clean baseline vs. defective), VLM diagnosis explanation, source localization excerpt, non-destructive code diff preview, and confirmation dialogs.
- `/review/history`: Full audit trail of reviewer approvals and rejections with recorded feedback reasons.

### Architecture & Data Persistence
- **Storage Adapter Pattern**: Implemented via `reviewRepository` (`src/services/reviewRepository.ts`). In demo mode, state transitions (approvals, rejections with reasons) persist in `window.localStorage` across page reloads.
- **Backend-Ready Interface**: The repository is decoupled from the UI, allowing drop-in replacement with an authenticated REST/GraphQL API for team-wide review.
- **Source Freshness Verification**: Displays `FRESH`, `STALE`, or `UNVERIFIED` tags based on recorded SHA-256 file hashes. Stale proposals prevent silent application of outdated recommendations.

---

---

## 11. Isolated Patch Application & Automated Self-Healing Validation Loop (Step 4.6)

### Architecture & Safety Invariants
Step 4.6 introduces a controlled, isolated self-healing verification loop that bridges human-approved proposals with automated verification:

```
[Approved Proposal]
         │
         ▼
[Approval & Hash Validation] ──(Fails)──> [REJECTED (No changes made)]
         │ (Passes)
         ▼
[Git Worktree Creation] ──> `artifacts/repair-worktrees/<job-id>` (branch: `omnisight-repair/<job-id>`)
         │
         ▼
[Deterministic Patch Applied] ──> Only approved files from `REGISTERED_PATCHES`
         │
         ▼
[Automated Build & Tests] ──> `npm run build` inside isolated worktree
         │
         ▼
[Visual Delta Evaluation] ──> Defect-specific measurement assertions (aspect ratio, contrast, layout overlap, viewport)
         │
         ▼
[Safe Worktree Cleanup] ──> Worktree removed & branch pruned; report saved to `artifacts/repair-executions/<job-id>/`
         │
         ▼
[Final Outcome: PASSED or FAILED]
```

### Core Security & Isolation Principles
1. **Zero Main Working Tree Modification**:
   - Repair patches are **never** applied to the developer's working tree or main checkout.
   - All file modifications and test builds occur inside temporary Git worktrees located under `artifacts/repair-worktrees/<job-id>`.
2. **Deterministic Registered Patches**:
   - Only pre-verified, registered patches (`scripts/repair/patch-registry.ts`) for the four seeded defects are allowed.
   - Model-generated arbitrary code strings or shell commands are **never** executed.
3. **Mandatory Approval & Freshness Check**:
   - Proposals with `humanReviewStatus !== "approved"` are immediately rejected.
   - If the file SHA-256 on disk differs from the proposal's recorded hash, the proposal is marked stale and execution is blocked.
4. **Machine-Readable Execution Reports**:
   - For every execution, a `RepairExecutionReport` JSON artifact is generated under `artifacts/repair-executions/<job-id>/repair_execution_report.json` containing:
     - Approval validation results and reviewer notes.
     - Git diff summary and changed files list.
     - Build exit codes and test duration metrics.
     - Visual delta metrics comparing baseline, defective, and repaired states.
     - Final state machine status (`PASSED`, `FAILED`, or `REJECTED`).
5. **Safe Cleanup**:
   - Temporary worktrees and branches are strictly cleaned up after job completion, even in failure scenarios, while preserving execution audit reports.

---

## 12. Automated Test Suite & Coverage

The automated test suite runs via `@playwright/test` against the local Vite server:

| Test File | Test Cases | Status | Description |
|---|---|---|---|
| `tests/repair-execution.spec.ts` | 7 | Passed | Patch registry completeness, approval status enforcement, stale hash rejection, unknown patch rejection, state machine transition guards, end-to-end isolated worktree execution, working tree immutability, and dashboard repair modal integration |
| `tests/review-dashboard.spec.ts` | 11 | Passed | Dashboard loading, summary stats, category filtering, search, detail view navigation, baseline/defective image comparison, approval workflow, rejection with required reason, refresh persistence, review history audit log, non-destructive source protection, and responsive mobile viewport (390x844) |
| `tests/repair-proposals.spec.ts` | 18 | Passed | Schema validation, path traversal rejection, absolute path blocking, source hash freshness, real file localization for all 4 defect scenarios, unsupported category safety, stale source handling, non-destructive source protection |
| `tests/vlm-diagnosis.spec.ts` | 12 | Passed | Zod schema validation, sanitization leak prevention, mock provider deterministic diagnosis, multi-provider factory fallbacks, evaluation metrics calculation, and CLI integration |
| `tests/evidence-harness.spec.ts` | 5 | Passed | Scenario definition coverage for all registered defects, WCAG contrast calculation accuracy, effective color resolution, DOM sanitization for model-facing inputs, and complete harness execution with manifest validation |
| `tests/defect-injection.spec.ts` | 8 | Passed | Disabled-by-default behavior, production safety guard check (disabled state ignores query params), unknown ID fail-safety, activation and visual symptoms for Scenarios 1–4, reversibility, mobile overflow detection, and cart state preservation during defect activation |
| `tests/shopping-cart.spec.ts` | 10 | Passed | Catalog rendering, dynamic routes, 404 fallback, out-of-stock disabling, single and multiple adds, quantity increments/decrements, item removal, cart clearing, refresh persistence, corrupted JSON handling, and invalid ID filtering |
| `tests/checkout.spec.ts` | 3 | Passed | Empty-cart checkout prevention, shipping form required field validation, inline error messaging on blur, email/postal code validation, and demo order placement clearing the cart |
| `tests/responsive.spec.ts` | 9 | Passed | Desktop (1440x900), Tablet (768x1024), and Mobile (390x844) zero-overflow checks (`scrollWidth <= clientWidth`) on Home, Catalog, and Cart |
| `tests/screenshots.spec.ts` | 1 (7 captures) | Passed | Baseline screenshots for Home, Catalog, Details, Cart, Checkout, Mobile Catalog, and Mobile Cart |

**Test Results Summary**:
- **Total Tests**: **85 passed in ~14.0s** (0 failed, 0 flaky)

---

## 13. Known Limitations & Next Steps
- **Development-Mode Boundary**: In local development, worktree execution is invoked via the CLI runner (`npm run repair:execute`). Frontend button execution verifies approval and simulates the contract boundary without granting raw filesystem or shell privileges to browser clients.
- **Predefined Registered Patches**: Patch application uses pre-verified deterministic patches for the 4 seeded test-bed defects to ensure safety before introducing autonomous LLM patch generation.
- **Recommended Next Milestone**:
  - Step 4.7: Automated Patch Merging, Release Branch Management, and Live Production Canary Verification.
