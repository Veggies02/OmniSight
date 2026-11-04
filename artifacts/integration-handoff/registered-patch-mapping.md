# OmniSight Integration: Registered Patch Mapping & Registry Specification

**Status:** Verified Specification  
**Source Code:** [`scripts/repair/patch-registry.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/scripts/repair/patch-registry.ts)  
**Date:** 2026-11-03  

---

## 1. Registry Architecture & Guarantees

In OmniSight, **patch IDs originate strictly from the deterministic TypeScript registry**, not from the AI or VLM models.

### Key Architectural Principles
1. **Deterministic Execution:** The AI model (Gemini, GPT-4o, or mock) is responsible for *diagnosing* and *classifying* the visual defect. It does **not** generate arbitrary, untested code directly into production worktrees during automated repair benchmark runs.
2. **Pre-Audited Security:** Every registered patch in `REGISTERED_PATCHES` has been pre-audited, is constrained to whitelisted source files (`src/index.css`), and is verified by automated build and visual regression checks before being merged.
3. **Exact Substring Preconditions:** Patches are applied using `applyDeterministicPatch()`, which verifies that the exact target match string exists in the isolated worktree before applying the fix.

---

## 2. Four Seeded Scenarios to Patch ID Mapping

The four benchmark scenarios, their recognized category aliases, and their corresponding registered patch IDs are:

| Benchmark Scenario ID | Recognized Aliases / Categories | Exact Registered Patch ID | Target File | Version |
| :--- | :--- | :--- | :--- | :--- |
| `product-image-distortion` | `image_distortion`, `product-image-distortion` | **`patch-product-image-distortion-001`** | `src/index.css` | `1.0.0` |
| `product-card-layout-break` | `layout_breakage`, `product-card-layout-break` | **`patch-product-card-layout-break-002`** | `src/index.css` | `1.0.0` |
| `low-contrast-text` | `low_contrast`, `low-contrast-text` | **`patch-low-contrast-text-003`** | `src/index.css` | `1.0.0` |
| `mobile-nav-overflow` | `responsive_overflow`, `mobile-nav-overflow` | **`patch-mobile-nav-overflow-004`** | `src/index.css` | `1.0.1` |

---

## 3. Detailed Patch Specifications

### 3.1 Scenario 1: `product-image-distortion`
* **Patch ID:** `patch-product-image-distortion-001`
* **Target File:** `src/index.css`
* **Description:** Restores natural aspect ratio and cover fit for distorted product images.
* **Target Match String:**
  ```css
  .defect-product-image-distortion .product-card-media {
    aspect-ratio: auto;
    height: 380px;
  }

  .defect-product-image-distortion .product-image {
    object-fit: fill; /* Stretches and distorts aspect ratio */
    width: 100%;
    height: 100%;
    transform: scaleY(1.45) scaleX(0.75);
  }
  ```
* **Replacement String:**
  ```css
  .defect-product-image-distortion .product-card-media {
    aspect-ratio: 4 / 3;
    height: auto;
  }

  .defect-product-image-distortion .product-image {
    object-fit: cover; /* Restored clean aspect ratio */
    width: 100%;
    height: 100%;
    transform: none;
  }
  ```
* **Expected Visual Effect:** Images maintain 4:3 aspect ratio with object-fit cover and identity transform.
* **Verification Check:** `image-object-fit: cover`, `image-transform-identity: none`, `media-container-height: != 380px`.

---

### 3.2 Scenario 2: `product-card-layout-break`
* **Patch ID:** `patch-product-card-layout-break-002`
* **Target File:** `src/index.css`
* **Description:** Removes negative margins and absolute positioning offsets that break card layout flow.
* **Target Match String:**
  ```css
  .defect-product-card-layout-break {
    display: block;
    overflow: visible;
    padding: 0;
  }

  .defect-product-card-layout-break .product-card-body {
    position: relative;
    display: block;
    padding: 0;
    margin-top: -40px; /* Overlaps card image and title */
  }

  .defect-product-card-layout-break .product-card-footer {
    position: absolute;
    bottom: -45px; /* Pushes action buttons outside card boundary */
    left: 0;
    right: -30px;
    background-color: var(--color-surface);
    box-shadow: var(--shadow-md);
  }
  ```
* **Replacement String:**
  ```css
  .defect-product-card-layout-break {
    display: flex;
    overflow: hidden;
    padding: var(--space-4);
  }

  .defect-product-card-layout-break .product-card-body {
    position: static;
    display: flex;
    padding: var(--space-2) 0;
    margin-top: 0; /* Reset overlap */
  }

  .defect-product-card-layout-break .product-card-footer {
    position: static;
    bottom: auto;
    left: auto;
    right: auto;
    background-color: transparent;
    box-shadow: none;
  }
  ```
* **Expected Visual Effect:** Card body and footer return to normal flex flow without overlap or displaced buttons.
* **Verification Check:** `card-display: flex`, `body-position: static`, `footer-position: static`.

---

### 3.3 Scenario 3: `low-contrast-text`
* **Patch ID:** `patch-low-contrast-text-003`
* **Target File:** `src/index.css`
* **Description:** Restores accessible WCAG AAA text contrast tokens for muted product snippets.
* **Target Match String:**
  ```css
  .defect-low-contrast-text .product-snippet,
  .defect-low-contrast-text .product-title-link,
  .defect-low-contrast-text .product-price {
    color: #cbd5e1 !important; /* Low contrast light grey against white */
  }
  ```
* **Replacement String:**
  ```css
  .defect-low-contrast-text .product-snippet,
  .defect-low-contrast-text .product-title-link,
  .defect-low-contrast-text .product-price {
    color: var(--color-text-body) !important; /* Restored WCAG AAA high contrast */
  }
  ```
* **Expected Visual Effect:** Text contrast ratio is restored to $\ge$ 7:1 against card background.
* **Verification Check:** Computed color matches `var(--color-text-body)` (`#475569` or `#0f172a`), contrast ratio $\ge 4.5:1$.

---

### 3.4 Scenario 4: `mobile-nav-overflow`
* **Patch ID:** `patch-mobile-nav-overflow-004`
* **Target File:** `src/index.css`
* **Description:** Constrains mobile navigation width to 100% and resets oversized gaps and link paddings.
* **Target Match String:**
  ```css
  @media (max-width: 640px) {
    .navbar.defect-mobile-nav-overflow .navbar-container {
      width: 650px; /* Intentionally forces container beyond 390px mobile viewport */
      min-width: 650px;
    }

    .navbar.defect-mobile-nav-overflow .navbar-nav {
      gap: 2.5rem;
      min-width: 450px;
    }

    .navbar.defect-mobile-nav-overflow .nav-link {
      white-space: nowrap;
      padding: 0.75rem 1.75rem;
    }
  }
  ```
* **Replacement String:**
  ```css
  @media (max-width: 640px) {
    .navbar.defect-mobile-nav-overflow .navbar-container {
      width: 100%;
      min-width: 0;
    }

    .navbar.defect-mobile-nav-overflow .navbar-nav {
      gap: 0.25rem;
      min-width: 0;
    }

    .navbar.defect-mobile-nav-overflow .nav-link {
      white-space: normal;
      padding: 0.4rem 0.55rem;
    }
  }
  ```
* **Expected Visual Effect:** Mobile navbar container width fits within 100% without horizontal scrollbar overflow.
* **Verification Check:** `scrollWidth <= clientWidth` on viewport 390x844.

---

## 4. Registry Lookup Functions

The registry provides two lookup methods in [`scripts/repair/patch-registry.ts`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/scripts/repair/patch-registry.ts):

1. **Direct Lookup:** `getRegisteredPatch(patchId: string): RegisteredPatch | undefined`
   Retrieves patch directly by its registered ID.
2. **Category / Scenario Lookup:** `findPatchForDefect(defectCategoryOrScenario: string): RegisteredPatch | undefined`
   Queries `CATEGORY_TO_PATCH_MAP` using either the scenario name (`product-image-distortion`) or normalized category name (`image_distortion`).

---

## 5. Behavior on Unknown Patch or Category

If `findPatchForDefect()` or `getRegisteredPatch()` returns `undefined`:
* The repair execution engine transitions immediately to state **`UNSUPPORTED`**.
* It logs: `"No registered patch available for scenario '<scenario>' (patchId: '<patchId>')."`
* **Zero code modifications** are applied.
* Worktree creation is skipped or cleaned up.
* A complete `repair_execution_report.json` with `finalState: "UNSUPPORTED"` is saved to `artifacts/repair-executions/<jobId>/`.

