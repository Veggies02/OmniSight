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
    version: '1.0.0',
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
    gap: 1rem;
    min-width: 0;
  }

  .navbar.defect-mobile-nav-overflow .nav-link {
    white-space: normal;
    padding: 0.5rem 1rem;
  }
}`,
    expectedVisualEffect: 'Mobile navbar container width fits within 100% without horizontal scrollbar overflow',
    requiredTests: ['npm run build'],
  },
};

export function getRegisteredPatch(patchId: string): RegisteredPatch | undefined {
  return REGISTERED_PATCHES[patchId];
}

const CATEGORY_TO_PATCH_MAP: Record<string, string> = {
  'product-image-distortion': 'patch-product-image-distortion-001',
  'image_distortion': 'patch-product-image-distortion-001',
  'product-card-layout-break': 'patch-product-card-layout-break-002',
  'layout_breakage': 'patch-product-card-layout-break-002',
  'low-contrast-text': 'patch-low-contrast-text-003',
  'low_contrast': 'patch-low-contrast-text-003',
  'mobile-nav-overflow': 'patch-mobile-nav-overflow-004',
  'responsive_overflow': 'patch-mobile-nav-overflow-004',
};

export function findPatchForDefect(defectCategoryOrScenario: string): RegisteredPatch | undefined {
  const direct = Object.values(REGISTERED_PATCHES).find((p) => p.defectCategory === defectCategoryOrScenario);
  if (direct) return direct;

  const patchId = CATEGORY_TO_PATCH_MAP[defectCategoryOrScenario];
  if (patchId) return REGISTERED_PATCHES[patchId];

  return undefined;
}

