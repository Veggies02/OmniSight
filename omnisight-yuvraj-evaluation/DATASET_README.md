# OmniSight Multimodal UI Defect Evaluation Dataset
**Target Consumer:** Yuvraj (AI / VLM Diagnosis Engine — `feature/yuvaraj-ai-engine`)  
**Curated By:** Ajay (QA Automation & Integration Engineer — `feature/ajay-defect-injection`)  
**Run Origin:** `artifacts/visual-evidence/run-2026-10-13T17-36-08-002Z/`  
**Dataset Version:** 1.0.0  
**Generated Date:** 2026-11-01  

---

## 1. Overview & Dataset Purpose

This evaluation bundle provides a standardized, leak-free benchmark for evaluating the OmniSight Vision-Language Model (VLM) UI defect diagnosis and repair proposal engine.

The dataset includes **eight total evaluation cases**:
* **4 Defective UI Cases** (`model_inputs/defective/case_01` through `case_04`) representing real seeded visual, structural, and responsive defects.
* **4 Clean Baseline Cases** (`model_inputs/baseline/case_01` through `case_04`) representing healthy renders of the identical viewports and routes.

Strict ground-truth isolation is enforced. Model inputs contain **zero defect labels, scenario names, or expected classifications**, preventing model prompt pollution or false high-accuracy scores.

---

## 2. Directory Structure

```
omnisight-yuvraj-evaluation/
├── model_inputs/
│   ├── defective/
│   │   ├── case_01/
│   │   │   ├── screenshot.png      # 1440x900 viewport capture
│   │   │   ├── evidence.json       # Viewport, DOM metrics, element bounding boxes, computed styles
│   │   │   └── dom.html            # Sanitized DOM structure
│   │   ├── case_02/
│   │   │   ├── screenshot.png      # 1440x900 viewport capture
│   │   │   ├── evidence.json
│   │   │   └── dom.html
│   │   ├── case_03/
│   │   │   ├── screenshot.png      # 1440x900 viewport capture
│   │   │   ├── evidence.json
│   │   │   └── dom.html
│   │   └── case_04/
│   │       ├── screenshot.png      # 390x844 mobile viewport capture
│   │       ├── evidence.json
│   │       └── dom.html
│   └── baseline/
│       ├── case_01/
│       │   ├── screenshot.png      # Clean 1440x900 baseline
│       │   ├── evidence.json
│       │   └── dom.html
│       ├── case_02/
│       │   ├── screenshot.png      # Clean 1440x900 baseline
│       │   ├── evidence.json
│       │   └── dom.html
│       ├── case_03/
│       │   ├── screenshot.png      # Clean 1440x900 baseline
│       │   ├── evidence.json
│       │   └── dom.html
│       └── case_04/
│           ├── screenshot.png      # Clean 390x844 mobile baseline
│           ├── evidence.json
│           └── dom.html
├── scoring/
│   └── ground_truth.json           # Isolated ground truth for automated evaluation scoring
├── dataset_manifest.json           # Full index of all cases, dimensions, and paths
└── DATASET_README.md               # Dataset documentation and guide
```

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
* **Format:** 24-bit PNG with RGB / RGBA color profile.
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
* `screenshot_path`: Relative path to the rendered screenshot (`screenshot.png`).
* `dom_path`: Relative path to the cleaned DOM snapshot (`dom.html`).
* `viewport`: Device viewport configuration used during capture (`width`, `height`).
* `document_metrics`: Live document layout metrics (`clientWidth`, `scrollWidth`, `clientHeight`, `scrollHeight`).
* `element_bounding_boxes`: Bounding boxes (`x`, `y`, `width`, `height`) of target UI elements.
* `computed_styles`: Actual computed CSS styles relevant to the layout / rendering.
* `console_errors`: Browser runtime error log entries captured during render.

---

## 6. Ground-Truth Separation & Anti-Leakage Protocol

To ensure rigorous evaluation:
1. **Separation:** Ground truth is located exclusively in `scoring/ground_truth.json`.
2. **Sanitization:** All scenario names (`product-image-distortion`, `mobile-nav-overflow`, etc.), defect IDs, expected categories, and diagnostic symptoms have been scrubbed from `model_inputs/`.
3. **Neutral Aliases:** The VLM should be prompted with neutral identifiers (`scenario_01` or `case_01`) rather than defect names.
4. **Validation:** Automated test `assertNoGroundTruthLeakage` runs across all files in `model_inputs/` to guarantee zero forbidden tokens exist in the model-facing payload.

---

## 7. How to Use This Dataset for VLM Evaluation

### Step A: Feed Inputs to VLM Provider
For each `case_XX` in `model_inputs/defective/`:
1. Provide `screenshot.png` alongside the baseline counterpart `model_inputs/baseline/case_XX/screenshot.png`.
2. Provide `evidence.json` (viewport, document metrics, computed styles) and `dom.html`.
3. Invoke your VLM prompt (e.g. Gemini 1.5 Flash / Pro or Mock Provider) using `DiagnosisService`.

### Step B: Score Output against Ground Truth
1. Load `scoring/ground_truth.json`.
2. Match your predicted `category` against either `canonical_category` (e.g. `image_distortion`, `layout_breakage`, `low_contrast`, `responsive_overflow`) or `expected_category` (e.g. `visual-distortion`, `layout-shift`, `color-contrast`, `responsive-overflow`).
3. Compute metrics:
   * **Category Accuracy:** % of cases where predicted category matches ground truth.
   * **Localization Accuracy:** Did the model correctly identify the target selector/component?
   * **False Positive Rate:** Test baseline cases in `model_inputs/baseline/` to confirm status is `no_defect_detected`.

