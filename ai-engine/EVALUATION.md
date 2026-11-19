# Evaluation Report — OmniSight AI Engine

## Overview

This document describes the evaluation methodology, benchmark dataset, and current results for the OmniSight AI defect diagnosis engine. It covers detection accuracy, failure modes, and the gap between mock-model verification and live-model benchmarking.

## Benchmark Dataset

The evaluation uses the four seeded defect scenarios established by the browser automation subsystem (Person 1), plus their clean baselines:

| Scenario ID | Defect Category | Severity | Target File |
|---|---|---|---|
| `product-image-distortion` | `image_distortion` | high | `src/index.css` |
| `product-card-layout-break` | `layout_breakage` | high | `src/index.css` |
| `low-contrast-text` | `low_contrast` | medium | `src/index.css` |
| `mobile-nav-overflow` | `responsive_overflow` | high | `src/index.css` |

Each scenario folder contains:
- `defective-screenshot.png` — the page with the injected defect
- `baseline.png` (where available) — the clean page for comparison
- `measurements.json` — viewport dimensions and element bounding boxes
- `model_facing_evidence.json` — the sanitised evidence prepared for the VLM
- `ground_truth_eval.json` — the answer key (**never sent to the model**)

### Ground-Truth Labels

The ground truth maps each scenario to:
- The expected `DefectCategory` value
- The expected CSS selector(s) causing the defect
- The expected source file path
- A boolean `has_defect` flag (true for defective, false for clean baselines)

Clean baselines are expected to produce `has_defect: false` with zero findings.

## Evaluation Metrics

The benchmark runner (`ai-engine/benchmark.py`) computes the following metrics:

### Per-Category Metrics
- **Precision**: Of all findings the model labelled as category X, what fraction were correct?
- **Recall**: Of all true defects of category X, what fraction did the model detect?
- **F1 Score**: Harmonic mean of precision and recall.

### Overall Metrics
- **Accuracy**: Fraction of scenarios where `has_defect` matches the ground truth.
- **False Positive Rate**: Fraction of clean baselines incorrectly flagged as defective.
- **Inconclusive Rate**: Fraction of scenarios where the model response could not be parsed.

### Error Handling
- A model response that cannot be parsed is counted as **inconclusive**, not as a correct negative.
- A response with `error != null` is always treated as a failure, never as a clean pass.

## Current Results

### Mock Provider (Deterministic)

The mock provider returns scripted responses that exercise the full pipeline. It is not a measure of real-world accuracy — it verifies that:

1. The pipeline correctly parses and validates model output.
2. Category normalisation maps seeded IDs to the standard taxonomy.
3. Confidence scoring, human review flags, and uncertainty notes work.
4. The benchmark harness itself runs correctly end-to-end.

| Metric | Value |
|---|---|
| Scenarios tested | 4 defective + clean baselines |
| Detection accuracy | 100% (mock responses are deterministic) |
| False positive rate | 0% |
| Inconclusive rate | 0% |
| Parse failures | 0 |

### Live Gemini Provider

**Status: Not yet benchmarked.**

A formal benchmark with the Gemini Vision API has not been run. The blockers are:

1. **API key**: A valid `VLM_API_KEY` must be set in `.env`.
2. **Model name**: The original model name in the configuration was retired; the replacement model name must be confirmed.
3. **Leakage guard conflict**: Ajay's TypeScript diagnosis service has a prompt leakage guard (`6fcb14a`) that blocks category names used in the standard VLM prompt. This does not affect the Python engine's mock path, but means the TypeScript `npm run diagnose:evidence` CLI cannot run until the guard is updated.

Once these are resolved, the benchmark will be run with:
```powershell
python benchmark.py --data "artifacts/visual-evidence/<run_id>" --labels ground_truth.json --output results.json
```

## Failure Mode Analysis

### Known Failure Modes (from mock + unit test coverage)

| Failure Mode | How the Engine Handles It | Test Coverage |
|---|---|---|
| Model returns empty response | `ValueError` raised, caught, returns `error` response with `has_defect: false` | `test_defect_analyzer.py` |
| Model returns malformed JSON | `repair_json()` attempts recovery; if it fails, returns error response | `test_defect_analyzer.py` |
| Model returns valid JSON but wrong schema | Missing fields default to safe values; unknown categories become `other` | `test_schemas.py` |
| Model returns truncated response | `_close_truncated()` adds missing brackets/quotes; finding flagged for review | `test_defect_analyzer.py` |
| Model returns Python literals (`True`/`False`/`None`) | Converted to JSON equivalents before parsing | `test_defect_analyzer.py` |
| Model returns trailing commas | Stripped by `_fix_trailing_commas()` | `test_defect_analyzer.py` |
| Model says `has_defect: true` but gives no findings | A placeholder finding with `confidence: 0.3` and `requires_human_review: true` is created | `test_defect_analyzer.py` |
| Model returns a finding with `category: none` | Filtered out — treated as "no defect for this element" | `test_defect_analyzer.py` |
| Model returns confidence outside [0, 1] | Clamped to `[0.0, 1.0]` | `test_defect_analyzer.py` |
| Model invents a CSS selector not in the evidence | Selector is kept as-is (not validated against DOM), but flagged if confidence is low | `test_uncertainty.py` |
| Screenshot file missing or too large | `FileNotFoundError` / `ValueError` raised before any model call | `test_defect_analyzer.py` |
| VLM provider returns 429 | Retried with exponential backoff up to `VLM_MAX_RETRIES` | `test_vlm_client.py` |
| VLM provider returns 401/403 | Immediate failure, no retry | `test_vlm_client.py` |
| DOM snippet contains script injection | Scripts, styles, comments stripped; event handlers removed | `test_dom_utils.py` |
| Raw DOM fallback triggered | Falls back to sanitised visible-text summary, never raw HTML | `test_dom_utils.py` |

### Anticipated Failure Modes (for live provider)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Model detects the right defect but names the wrong category | Medium | Category normalisation handles aliases; human review flag on low confidence |
| Model hallucinates a defect on a clean page | Medium | Benchmark FP rate will quantify this; human review is always required for proposals |
| Model misses a subtle defect (e.g. low contrast) | Medium-High | Low contrast defects may be below the model's visual sensitivity threshold |
| Model response exceeds token limit and is truncated | Low | `_close_truncated()` repairs the JSON; finding flagged for review |
| Prompt injection from page content | Low | DOM sanitisation + system prompt instruction + worked example covering this case |

## Accuracy Targets

The following targets are aspirational — they will be confirmed or revised after the first live benchmark run:

| Metric | Target | Rationale |
|---|---|---|
| Detection accuracy (4 seeded defects) | ≥ 75% (3/4 detected) | The four defects are visually obvious to a human |
| False positive rate (clean baselines) | ≤ 25% | One false alarm out of four clean pages is acceptable with human review |
| Category classification accuracy | ≥ 75% | Normalisation aliases handle common mismatches |
| Inconclusive rate | ≤ 10% | JSON repair handles most model formatting issues |

## How to Run the Benchmark

```powershell
cd ai-engine
.\.venv\Scripts\Activate.ps1

# With mock provider (verifies pipeline, not accuracy):
python benchmark.py --data "../artifacts/visual-evidence/<run_id>" --mock

# With live Gemini (measures real accuracy):
python benchmark.py --data "../artifacts/visual-evidence/<run_id>" --labels labels.json --output results.json
```

The `--labels` file maps scenario IDs to expected categories:
```json
{
  "product-image-distortion": {"has_defect": true, "category": "image_distortion"},
  "product-card-layout-break": {"has_defect": true, "category": "layout_breakage"},
  "low-contrast-text": {"has_defect": true, "category": "low_contrast"},
  "mobile-nav-overflow": {"has_defect": true, "category": "responsive_overflow"}
}
```

## Limitations

- **No live-model results yet.** All numbers above are from the deterministic mock. Real accuracy is unknown until a Gemini run is completed.
- **Small dataset.** Four defect scenarios and four clean baselines are enough to verify the pipeline but not enough for statistically significant accuracy claims.
- **Single snapshot per scenario.** The benchmark tests one viewport per defect. Real-world defects may appear only at specific breakpoints or interaction states.
- **No cross-model comparison.** Only `mock` and `gemini` are implemented. Comparing against a second provider would strengthen the evaluation.
