# OmniSight Multimodal UI Defect Evaluation Dataset (v2.0)

**Target Consumer:** Yuvraj (AI / VLM Diagnosis Engine — `feature/yuvaraj-ai-engine`)  
**Curated By:** Ajay (QA Automation & Integration Engineer — `feature/ajay-defect-injection`)  
**Run Origin:** `artifacts/visual-evidence/run-2026-10-13T17-36-08-002Z/`  
**Dataset Version:** 2.0.0  
**Updated Date:** 2026-11-02  

---

## 1. Overview & Dataset Purpose

This evaluation bundle provides a standardized, leak-free benchmark for evaluating the OmniSight Vision-Language Model (VLM) UI defect diagnosis and repair proposal engine.

The dataset includes **eight total evaluation cases**:
* **4 Defective UI Cases** (`model_inputs/defective/case_01` through `case_04`) representing real seeded visual, structural, and responsive defects.
* **4 Clean Baseline Cases** (`model_inputs/baseline/case_01` through `case_04`) representing healthy renders of the identical viewports and routes.

Strict ground-truth isolation is enforced. Model inputs contain **zero defect labels, scenario names, or expected classifications**, preventing model prompt pollution or false high-accuracy scores.

---

## 2. Directory Structure & Packaged Distributions

### Directory Layout
```
omnisight-yuvraj-evaluation/
├── model_inputs/
│   ├── defective/
│   │   ├── case_01/ (screenshot.png, dom.html, evidence.json)
│   │   ├── case_02/ (screenshot.png, dom.html, evidence.json)
│   │   ├── case_03/ (screenshot.png, dom.html, evidence.json)
│   │   └── case_04/ (screenshot.png, dom.html, evidence.json)
│   └── baseline/
│       ├── case_01/ (screenshot.png, dom.html, evidence.json)
│       ├── case_02/ (screenshot.png, dom.html, evidence.json)
│       ├── case_03/ (screenshot.png, dom.html, evidence.json)
│       └── case_04/ (screenshot.png, dom.html, evidence.json)
├── scoring/
│   └── ground_truth.json           # Isolated ground truth for automated evaluation scoring
├── dataset_manifest.json           # Full index of all cases, dimensions, and paths
└── DATASET_README.md               # Dataset documentation and guide
```

### Packaged Distributions (Two Separate Archives)
To prevent accidental ground-truth exposure during evaluation, two distinct packages are produced:

1. **Model-Only Package (`omnisight-yuvraj-model-inputs-v2.zip`):**
   * Contains **ONLY** the `model_inputs/` folder (baseline and defective cases).
   * Contains **NO** `scoring/`, `ground_truth.json`, `dataset_manifest.json`, `DATASET_README.md`, or defect labels.
   * Safe to unpack directly into AI/VLM inference pipelines.

2. **Evaluator Metadata Package (`omnisight-yuvraj-evaluation-metadata-v2.zip`):**
   * Contains **ONLY** `scoring/ground_truth.json`, `dataset_manifest.json`, and `DATASET_README.md`.
   * Used strictly by evaluation scoring harnesses and test runners to benchmark model outputs.

---

## 3. Evaluation Cases & Scenarios

| Case ID | Viewport | Dimensions | Mode | Route | Component Target | Seeded Defect Description | Canonical VLM Category |
|---|---|---|---|---|---|---|---|
| `case_01` | Desktop | 1440 × 900 | Viewport | `/products` | `ProductCard` | Abnormal image height stretch & aspect ratio distortion | `image_distortion` (`visual-distortion`) |
| `case_02` | Desktop | 1440 × 900 | Viewport | `/products` | `ProductCard` | Broken card body flex alignment & footer button protrusion | `layout_breakage` (`layout-shift`) |
| `case_03` | Desktop | 1440 × 900 | Viewport | `/products` | `ProductCard` | Low contrast text (#cbd5e1 on white, ratio 1.48:1 < 4.5:1) | `low_contrast` (`color-contrast`) |
| `case_04` | Mobile | 390 × 844 | Viewport | `/*` (`/products`) | `Navbar` | Horizontal scroll overflow on mobile viewport (scrollWidth 650px) | `responsive_overflow` (`responsive-overflow`) |

---

## 4. Screenshot Capture Details

* **Engine:** Playwright Chromium headless browser.
* **Capture Mode:** Viewport screenshot (`fullPage: false`).
* **Format:** 24-bit PNG with standard sRGB color profile.
* **Pixel Dimensions:**
  * `case_01` (Baseline & Defective): **1440 × 900 px**
  * `case_02` (Baseline & Defective): **1440 × 900 px**
  * `case_03` (Baseline & Defective): **1440 × 900 px**
  * `case_04` (Baseline & Defective): **390 × 844 px**
* **Deterministic Environment:** All network idle conditions, web fonts loaded, animation transitions disabled.

---

## 5. Model-Input Evidence JSON Schema

Each case in `model_inputs/{defective,baseline}/case_XX/` contains an `evidence.json` file. All fields adhere to the following schema:

```json
{
  "case_id": "case_01",
  "step_name": "not_recorded",
  "screenshot_path": "screenshot.png",
  "dom_path": "dom.html",
  "page_title": "OmniShop — Modern Curated Essentials",
  "route": "/products",
  "url": "http://127.0.0.1:5173/products",
  "viewport": {
    "width": 1440,
    "height": 900
  },
  "is_mobile": false,
  "browser": "chromium",
  "capture_mode": "viewport",
  "document_metrics": {
    "clientWidth": 1440,
    "scrollWidth": 1440,
    "clientHeight": 900,
    "scrollHeight": 1927
  },
  "element_bounding_boxes": {
    "card": { "x": 144, "y": 361.765625, "width": 267, "height": 608.390625 },
    "media": { "x": 145, "y": 362.765625, "width": 265, "height": 380 },
    "image": { "x": 178.125, "y": 277.265625, "width": 198.75, "height": 551 }
  },
  "computed_styles": {
    "image.objectFit": "fill",
    "image.height": "380px",
    "image.transform": "matrix(0.75, 0, 0, 1.45, 0, 0)",
    "media.height": "380px"
  },
  "console_errors": []
}
```

### Key Field Descriptions:
* `case_id`: Opaque neutral identifier (`case_01` to `case_04`).
* `step_name`: Explicit journey step status (`"not_recorded"` since static route capture was used; not fabricated).
* `screenshot_path`: Relative path to the rendered screenshot (`screenshot.png`).
* `dom_path`: Relative path to the sanitized DOM snapshot (`dom.html`).
* `viewport`: Device viewport configuration used during capture (`width`, `height`).
* `document_metrics`: Live document layout metrics (`clientWidth`, `scrollWidth`, `clientHeight`, `scrollHeight`).
* `element_bounding_boxes`: Bounding boxes (`x`, `y`, `width`, `height`) of target UI elements.
* `computed_styles`: Actual computed CSS styles relevant to the layout / rendering.
* `console_errors`: Browser runtime error log entries captured during render.

---

## 6. Ground-Truth Isolation & Anti-Leakage Protocol

All model-facing DOM snapshots (`dom.html`) are thoroughly sanitized by `sanitizeDomSnapshot`:
1. **Comment Elimination:** All CSS comments (`/* Defect 1: ... */`, `/* Controlled UI ... */`, `/* Stretches and distorts ... */`) are stripped.
2. **Metadata Removal:** `omnisight-defect-metadata` divs and `data-defect-*` attributes are removed.
3. **Environment Scrubbing:** Development paths (`/Users/...`) and Vite attributes (`data-vite-dev-id`) are removed.
4. **Script Stripping:** Vite client and React refresh scripts are omitted.
5. **Preservation Guarantee:** Actual diagnostic CSS declarations (`object-fit: fill`, `height: 380px`, `margin-top: -40px`, `bottom: -45px`, `color: #cbd5e1 !important`, `width: 650px`) and DOM element structure are 100% preserved.

---

## 7. How to Regenerate the Dataset & Run Validation Tests

### Regenerate Dataset and Archives
```bash
npm run prepare:evaluation
```
This script reads source artifacts, sanitizes all DOM snapshots, generates `evidence.json`, indexes `dataset_manifest.json`, isolates `scoring/ground_truth.json`, and packages both `omnisight-yuvraj-model-inputs-v2.zip` and `omnisight-yuvraj-evaluation-metadata-v2.zip`.

### Run Automated Integrity & Anti-Leakage Tests
```bash
npx playwright test tests/evaluation-dataset.spec.ts
```
The test suite validates:
* 8 total cases (4 baseline, 4 defective).
* Evidence schema completeness (`step_name: "not_recorded"`, bounding boxes, computed styles).
* Zero leakage across all JSON and HTML files.
* Diagnostic CSS preservation in all defective DOM files.
* ZIP archive integrity and model-only isolation.
