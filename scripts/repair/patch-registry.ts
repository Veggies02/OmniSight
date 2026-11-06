import { type DefectCategory } from '../vlm/diagnosis-schema';

export interface RegisteredPatch {
  patchId: string;
  defectCategory: string;
  version: string;
  description: string;
  approvedSourceFiles: string[];
  targetFile: string;
  // Exact substring matching preconditions
  targetMatchString: string;
  replacementString: string;
  expectedVisualEffect: string;
  requiredTests: string[];
}

/**
 * Normalizes CRLF and CR line endings to LF (\n).
 * Preserves all other whitespace and code semantics.
 */
export function normalizeLineEndings(content: string): string {
  if (typeof content !== 'string') return '';
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Applies a registered patch deterministically to a file content string,
 * handling CRLF/LF line-ending differences transparently.
 * Detects whether the file originally used CRLF, performs normalized matching/replacement,
 * and preserves the original file line-ending convention upon output.
 */
export function applyDeterministicPatch(
  rawContent: string,
  patch: RegisteredPatch
): { success: boolean; updatedContent: string; error?: string } {
  const isCrlf = rawContent.includes('\r\n');
  const normalizedFile = normalizeLineEndings(rawContent);
  const normalizedTarget = normalizeLineEndings(patch.targetMatchString);
  const normalizedReplacement = normalizeLineEndings(patch.replacementString);

  if (!normalizedFile.includes(normalizedTarget)) {
    return {
      success: false,
      updatedContent: rawContent,
      error: `Precondition check failed: Expected target code snippet not found in worktree ${patch.targetFile}`,
    };
  }

  // Replace only the first occurrence of the target match snippet
  const updatedNormalized = normalizedFile.replace(normalizedTarget, normalizedReplacement);

  // Restore original line-ending format if original was CRLF
  const finalContent = isCrlf ? updatedNormalized.replace(/\n/g, '\r\n') : updatedNormalized;

  return {
    success: true,
    updatedContent: finalContent,
  };
}

/**
 * Registry of deterministic, pre-verified patches for seeded UI defects.
 * These are vetted, immutable patches designed specifically for the test-bed.
 */
export const REGISTERED_PATCHES: Record<string, RegisteredPatch> = {
  'patch-product-image-distortion-001': {
    patchId: 'patch-product-image-distortion-001',
    defectCategory: 'product-image-distortion',
    version: '1.0.0',
    description: 'Restores natural aspect ratio and cover fit for distorted product images',
    approvedSourceFiles: ['src/index.css'],
    targetFile: 'src/index.css',
    targetMatchString: `.defect-product-image-distortion .product-card-media {
  aspect-ratio: auto;
  height: 380px;
}

.defect-product-image-distortion .product-image {
  object-fit: fill; /* Stretches and distorts aspect ratio */
  width: 100%;
  height: 100%;
  transform: scaleY(1.45) scaleX(0.75);
}`,
    replacementString: `.defect-product-image-distortion .product-card-media {
  aspect-ratio: 4 / 3;
  height: auto;
}

.defect-product-image-distortion .product-image {
  object-fit: cover; /* Restored clean aspect ratio */
  width: 100%;
  height: 100%;
  transform: none;
}`,
    expectedVisualEffect: 'Images maintain 4:3 aspect ratio with object-fit cover and identity transform',
    requiredTests: ['npm run build'],
  },

  'patch-product-card-layout-break-002': {
    patchId: 'patch-product-card-layout-break-002',
    defectCategory: 'product-card-layout-break',
    version: '1.0.0',
    description: 'Removes negative margins and absolute positioning offsets that break card layout flow',
    approvedSourceFiles: ['src/index.css'],
    targetFile: 'src/index.css',
    targetMatchString: `.defect-product-card-layout-break {
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
}`,
    replacementString: `.defect-product-card-layout-break {
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
}`,
    expectedVisualEffect: 'Card body and footer return to normal flex flow without overlap or displaced buttons',
    requiredTests: ['npm run build'],
  },

  'patch-low-contrast-text-003': {
    patchId: 'patch-low-contrast-text-003',
    defectCategory: 'low-contrast-text',
    version: '1.0.0',
    description: 'Restores accessible WCAG AAA text contrast tokens for muted product snippets',
    approvedSourceFiles: ['src/index.css'],
    targetFile: 'src/index.css',
    targetMatchString: `.defect-low-contrast-text .product-snippet,
.defect-low-contrast-text .product-title-link,
.defect-low-contrast-text .product-price {
  color: #cbd5e1 !important; /* Low contrast light grey against white */
}`,
    replacementString: `.defect-low-contrast-text .product-snippet,
.defect-low-contrast-text .product-title-link,
.defect-low-contrast-text .product-price {
  color: var(--color-text-body) !important; /* Restored WCAG AAA high contrast */
}`,
    expectedVisualEffect: 'Text contrast ratio is restored to >= 7:1 against card background',
    requiredTests: ['npm run build'],
  },

  'patch-mobile-nav-overflow-004': {
    patchId: 'patch-mobile-nav-overflow-004',
    defectCategory: 'mobile-nav-overflow',
    version: '1.0.1',
    description: 'Constrains mobile navigation width to 100% and resets oversized gaps and link paddings',
    approvedSourceFiles: ['src/index.css'],
    targetFile: 'src/index.css',
    targetMatchString: `@media (max-width: 640px) {
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
}`,
    replacementString: `@media (max-width: 640px) {
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
}`,
    expectedVisualEffect: 'Mobile navbar container width fits within 100% without horizontal scrollbar overflow',
    requiredTests: ['npm run build'],
  },
};

export function getRegisteredPatch(patchId: string): RegisteredPatch | undefined {
  return REGISTERED_PATCHES[patchId];
}

export interface ScenarioMapping {
  expectedCategory: DefectCategory;
  patchId: string;
}

/**
 * Authoritative mapping of seeded scenarios, aliases, and evaluation labels to deterministic patches and expected categories.
 */
export const SCENARIO_TO_PATCH_MAP: Record<string, ScenarioMapping> = {
  // Scenario 1: Product Image Distortion
  'product-image-distortion': { expectedCategory: 'image_distortion', patchId: 'patch-product-image-distortion-001' },
  'scenario_01': { expectedCategory: 'image_distortion', patchId: 'patch-product-image-distortion-001' },
  'case_01': { expectedCategory: 'image_distortion', patchId: 'patch-product-image-distortion-001' },
  'visual-distortion': { expectedCategory: 'image_distortion', patchId: 'patch-product-image-distortion-001' },

  // Scenario 2: Product Card Layout Break
  'product-card-layout-break': { expectedCategory: 'layout_breakage', patchId: 'patch-product-card-layout-break-002' },
  'product-card-layout': { expectedCategory: 'layout_breakage', patchId: 'patch-product-card-layout-break-002' },
  'scenario_02': { expectedCategory: 'layout_breakage', patchId: 'patch-product-card-layout-break-002' },
  'case_02': { expectedCategory: 'layout_breakage', patchId: 'patch-product-card-layout-break-002' },
  'layout-shift': { expectedCategory: 'layout_breakage', patchId: 'patch-product-card-layout-break-002' },

  // Scenario 3: Low Contrast Text
  'low-contrast-text': { expectedCategory: 'low_contrast', patchId: 'patch-low-contrast-text-003' },
  'scenario_03': { expectedCategory: 'low_contrast', patchId: 'patch-low-contrast-text-003' },
  'case_03': { expectedCategory: 'low_contrast', patchId: 'patch-low-contrast-text-003' },
  'color-contrast': { expectedCategory: 'low_contrast', patchId: 'patch-low-contrast-text-003' },

  // Scenario 4: Mobile Navigation Overflow
  'mobile-nav-overflow': { expectedCategory: 'responsive_overflow', patchId: 'patch-mobile-nav-overflow-004' },
  'nav-overflow': { expectedCategory: 'responsive_overflow', patchId: 'patch-mobile-nav-overflow-004' },
  'scenario_04': { expectedCategory: 'responsive_overflow', patchId: 'patch-mobile-nav-overflow-004' },
  'case_04': { expectedCategory: 'responsive_overflow', patchId: 'patch-mobile-nav-overflow-004' },
  'responsive-overflow': { expectedCategory: 'responsive_overflow', patchId: 'patch-mobile-nav-overflow-004' },
};

/**
 * Resolves the expected defect category from the authoritative scenario ID.
 */
export function getExpectedCategoryForScenario(scenarioId: string): DefectCategory | undefined {
  if (!scenarioId || typeof scenarioId !== 'string') return undefined;
  return SCENARIO_TO_PATCH_MAP[scenarioId]?.expectedCategory;
}

/**
 * Resolves the registered patch deterministically using the authoritative scenario ID.
 */
export function findPatchForScenario(scenarioId: string): RegisteredPatch | undefined {
  if (!scenarioId || typeof scenarioId !== 'string') return undefined;
  const mapping = SCENARIO_TO_PATCH_MAP[scenarioId];
  if (mapping) {
    return REGISTERED_PATCHES[mapping.patchId];
  }
  return undefined;
}

export interface AuthoritativePatchResolution {
  patch?: RegisteredPatch;
  expectedCategory?: DefectCategory;
  resolutionSource: 'scenario' | 'category' | 'none';
  isMismatch: boolean;
  mismatchWarning?: string;
}

/**
 * Authoritatively resolves the target patch, comparing the scenario expectation with the AI diagnosis.
 */
export function resolveAuthoritativePatch(
  scenarioId?: string,
  diagnosedCategory?: string
): AuthoritativePatchResolution {
  const hasScenarioId = Boolean(scenarioId && scenarioId.trim() !== '');

  if (hasScenarioId) {
    const cleanScenarioId = scenarioId!.trim();
    const scenarioPatch = findPatchForScenario(cleanScenarioId);
    const expectedCat = getExpectedCategoryForScenario(cleanScenarioId);
    if (scenarioPatch && expectedCat) {
      const isMismatch = Boolean(diagnosedCategory && diagnosedCategory !== expectedCat);
      const mismatchWarning = isMismatch
        ? `WARNING: Category mismatch detected. Authoritative scenario '${cleanScenarioId}' expects '${expectedCat}', but AI model diagnosed '${diagnosedCategory}'. Deterministic patch '${scenarioPatch.patchId}' selected based on scenarioId.`
        : undefined;
      return {
        patch: scenarioPatch,
        expectedCategory: expectedCat,
        resolutionSource: 'scenario',
        isMismatch,
        mismatchWarning,
      };
    }

    // Explicitly provided scenario ID is unrecognized.
    // Strictly return 'none' without falling back to AI diagnosed category.
    return {
      patch: undefined,
      expectedCategory: undefined,
      resolutionSource: 'none',
      isMismatch: false,
    };
  }

  // Fallback to diagnosed category ONLY for legacy proposals genuinely lacking scenarioId
  if (diagnosedCategory && diagnosedCategory.trim() !== '') {
    const cleanCategory = diagnosedCategory.trim();
    const categoryPatch = findPatchForDefect(cleanCategory);
    if (categoryPatch) {
      return {
        patch: categoryPatch,
        expectedCategory: undefined,
        resolutionSource: 'category',
        isMismatch: false,
      };
    }
  }

  return {
    patch: undefined,
    expectedCategory: undefined,
    resolutionSource: 'none',
    isMismatch: false,
  };
}

const CATEGORY_TO_PATCH_MAP: Record<string, string> = {
  'product-image-distortion': 'patch-product-image-distortion-001',
  'image_distortion': 'patch-product-image-distortion-001',
  'product-card-layout-break': 'patch-product-card-layout-break-002',
  'layout_breakage': 'patch-product-card-layout-break-002',
  'low-contrast-text': 'patch-low-contrast-text-003',
  'low_contrast': 'patch-low-contrast-text-003',
  'color_contrast': 'patch-low-contrast-text-003',
  'color-contrast': 'patch-low-contrast-text-003',
  'mobile-nav-overflow': 'patch-mobile-nav-overflow-004',
  'responsive_overflow': 'patch-mobile-nav-overflow-004',
};

export function findPatchForDefect(defectCategoryOrScenario: string): RegisteredPatch | undefined {
  // First check if it is a known scenario ID
  const fromScenario = findPatchForScenario(defectCategoryOrScenario);
  if (fromScenario) return fromScenario;

  const direct = Object.values(REGISTERED_PATCHES).find((p) => p.defectCategory === defectCategoryOrScenario);
  if (direct) return direct;

  const patchId = CATEGORY_TO_PATCH_MAP[defectCategoryOrScenario];
  if (patchId) return REGISTERED_PATCHES[patchId];

  return undefined;
}

