import { type ReviewProposalItem } from "../types/review-types";

/**
 * Deterministic standard repair proposals dataset matching the 4 seeded defect scenarios.
 * Embedded safely for client-side review in the demo environment.
 */
export const INITIAL_REVIEW_PROPOSALS: ReviewProposalItem[] = [
  {
    schemaVersion: "1.0",
    proposalId: "prop_product-image-distortion_001",
    scenarioId: "product-image-distortion",
    diagnosisRef: {
      diagnosisStatus: "diagnosed",
      model: "mock-vlm-v1",
      provider: "mock",
      primaryDefectCategory: "image_distortion",
      reportedConfidence: 0.94,
    },
    defectCategory: "image_distortion",
    severity: "medium",
    localization: {
      status: "localized",
      filePath: "src/index.css",
      fileHash: "588aa17c68bff3d5e47266a022f89b2482c68fbbb64863a3b2fa677e55e128ba",
      componentOrSelector: ".product-image",
      excerpt: {
        filePath: "src/index.css",
        startLine: 452,
        endLine: 470,
        content: `.product-card-media {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  background-color: var(--color-surface-subtle);
  overflow: hidden;
}

.product-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 300ms ease;
  display: block;
}`,
        sha256: "588aa17c68bff3d5e47266a022f89b2482c68fbbb64863a3b2fa677e55e128ba",
      },
      evidence: [
        {
          matchedSelector: ".product-image",
          matchedCategory: "image_distortion",
          sourceType: "css",
          rationale: "Located image dimensions, container height, and object-fit rules in src/index.css.",
          confidence: 0.94,
        },
      ],
      uncertaintyNotes: [],
    },
    suspectedRootCause: "Container height override and object-fit: fill style applied to image.",
    evidenceExplanation: [
      "Rendered image height is significantly stretched compared to baseline.",
      "Computed object-fit is set to fill instead of maintaining aspect ratio.",
    ],
    proposedCorrection: {
      type: "css_rule_modification",
      targetSelectorOrComponent: ".product-card-media, .product-image",
      currentCode: `.product-image {
  object-fit: fill;
  transform: scaleY(1.45) scaleX(0.75);
}`,
      proposedCode: `.product-image {
  object-fit: cover;
  width: 100%;
  height: 100%;
}`,
      diffSummary: "Replace object-fit: fill and distorting transform with object-fit: cover preserving 1:1 aspect ratio.",
    },
    expectedVisualImprovement: "Restore object-fit: cover and retain 1:1 square aspect ratio on media container.",
    confidence: "high",
    confidenceScore: 0.94,
    potentialRisks: ["Ensure image cropping in object-fit: cover does not clip critical product details."],
    requiredValidationTests: [
      "tests/defect-injection.spec.ts",
      "tests/responsive.spec.ts",
      "tests/shopping-cart.spec.ts",
    ],
    humanReviewStatus: "pending_review",
    status: "proposed",
    createdAt: "2026-10-14T17:40:00.000Z",
    isMock: true,
    sourceFreshness: "fresh",
    visualEvidence: {
      scenarioId: "product-image-distortion",
      route: "/products",
      viewport: { width: 1440, height: 900 },
      baselineScreenshotUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'><rect width='400' height='300' fill='%23f1f5f9'/><rect x='100' y='50' width='200' height='200' fill='%2338bdf8' rx='8'/><text x='200' y='155' font-family='sans-serif' font-size='14' font-weight='bold' fill='%230f172a' text-anchor='middle'>Clean Baseline: Square 1:1 Aspect</text></svg>",
      defectiveScreenshotUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'><rect width='400' height='300' fill='%23fef2f2'/><rect x='140' y='20' width='120' height='260' fill='%23ef4444' rx='8'/><text x='200' y='155' font-family='sans-serif' font-size='14' font-weight='bold' fill='%23ffffff' text-anchor='middle'>Defective: Skewed Stretch</text></svg>",
      pageTitle: "OmniShop — Products Catalogue",
      measurements: {
        objectFit: "fill (baseline: cover)",
        renderedHeight: "380px (baseline: 265px)",
      },
    },
  },
  {
    schemaVersion: "1.0",
    proposalId: "prop_product-card-layout-break_002",
    scenarioId: "product-card-layout-break",
    diagnosisRef: {
      diagnosisStatus: "diagnosed",
      model: "mock-vlm-v1",
      provider: "mock",
      primaryDefectCategory: "layout_breakage",
      reportedConfidence: 0.96,
    },
    defectCategory: "layout_breakage",
    severity: "high",
    localization: {
      status: "localized",
      filePath: "src/index.css",
      fileHash: "588aa17c68bff3d5e47266a022f89b2482c68fbbb64863a3b2fa677e55e128ba",
      componentOrSelector: ".product-card-footer",
      excerpt: {
        filePath: "src/index.css",
        startLine: 485,
        endLine: 505,
        content: `.product-card-body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.product-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  font-size: 0.8125rem;
}`,
        sha256: "588aa17c68bff3d5e47266a022f89b2482c68fbbb64863a3b2fa677e55e128ba",
      },
      evidence: [
        {
          matchedSelector: ".product-card-footer",
          matchedCategory: "layout_breakage",
          sourceType: "css",
          rationale: "Located absolute positioning and negative margin overrides displacing footer and card body in src/index.css.",
          confidence: 0.96,
        },
      ],
      uncertaintyNotes: [],
    },
    suspectedRootCause: "Absolute bottom positioning with negative offset overriding flex layout.",
    evidenceExplanation: [
      "Footer element has absolute positioning displacing it -45px below card container.",
      "Card body content has negative top margin overlapping the image.",
    ],
    proposedCorrection: {
      type: "css_rule_modification",
      targetSelectorOrComponent: ".product-card-footer, .product-card-body",
      currentCode: `.product-card-footer {
  position: absolute;
  bottom: -45px;
}`,
      proposedCode: `.product-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}`,
      diffSummary: "Restore relative flexbox positioning for card body and footer, removing out-of-bounds absolute offset.",
    },
    expectedVisualImprovement: "Remove absolute positioning and rely on parent flexbox alignment.",
    confidence: "high",
    confidenceScore: 0.96,
    potentialRisks: ["Verify flex wrapping does not distort action buttons on narrow tablet screens."],
    requiredValidationTests: [
      "tests/defect-injection.spec.ts",
      "tests/responsive.spec.ts",
      "tests/shopping-cart.spec.ts",
    ],
    humanReviewStatus: "pending_review",
    status: "proposed",
    createdAt: "2026-10-14T17:40:00.000Z",
    isMock: true,
    sourceFreshness: "fresh",
    visualEvidence: {
      scenarioId: "product-card-layout-break",
      route: "/products",
      viewport: { width: 1440, height: 900 },
      baselineScreenshotUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'><rect width='400' height='300' fill='%23f1f5f9'/><rect x='60' y='40' width='280' height='220' fill='%23ffffff' stroke='%23cbd5e1' rx='6'/><text x='200' y='155' font-family='sans-serif' font-size='14' font-weight='bold' fill='%230f172a' text-anchor='middle'>Clean Baseline: Contained Footer</text></svg>",
      defectiveScreenshotUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'><rect width='400' height='300' fill='%23fef2f2'/><rect x='60' y='40' width='280' height='200' fill='%23ffffff' stroke='%23cbd5e1' rx='6'/><rect x='60' y='260' width='300' height='35' fill='%23ef4444' rx='4'/><text x='200' y='282' font-family='sans-serif' font-size='12' font-weight='bold' fill='%23ffffff' text-anchor='middle'>Displaced Footer Overhang</text></svg>",
      pageTitle: "OmniShop — Products Catalogue",
      measurements: {
        protrusionDelta: "+28px outside card boundary",
        positionType: "absolute (baseline: static/flex)",
      },
    },
  },
  {
    schemaVersion: "1.0",
    proposalId: "prop_low-contrast-text_003",
    scenarioId: "low-contrast-text",
    diagnosisRef: {
      diagnosisStatus: "diagnosed",
      model: "mock-vlm-v1",
      provider: "mock",
      primaryDefectCategory: "low_contrast",
      reportedConfidence: 0.92,
    },
    defectCategory: "low_contrast",
    severity: "medium",
    localization: {
      status: "localized",
      filePath: "src/index.css",
      fileHash: "588aa17c68bff3d5e47266a022f89b2482c68fbbb64863a3b2fa677e55e128ba",
      componentOrSelector: ".product-snippet",
      excerpt: {
        filePath: "src/index.css",
        startLine: 544,
        endLine: 564,
        content: `.product-snippet {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  line-height: 1.45;
  margin-bottom: 1rem;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}`,
        sha256: "588aa17c68bff3d5e47266a022f89b2482c68fbbb64863a3b2fa677e55e128ba",
      },
      evidence: [
        {
          matchedSelector: ".product-snippet",
          matchedCategory: "low_contrast",
          sourceType: "css",
          rationale: "Located color override rules applying low-luminance contrast (#cbd5e1) in src/index.css.",
          confidence: 0.95,
        },
      ],
      uncertaintyNotes: [],
    },
    suspectedRootCause: "Text color overridden with high-luminance slate grey.",
    evidenceExplanation: [
      "Text color #cbd5e1 against #ffffff results in a contrast ratio of ~1.48:1, well below 4.5:1.",
      "Visual legibility is severely compromised under standard ambient lighting.",
    ],
    proposedCorrection: {
      type: "css_rule_modification",
      targetSelectorOrComponent: ".product-snippet, .product-title-link, .product-price",
      currentCode: `.product-snippet {
  color: #cbd5e1 !important;
}`,
      proposedCode: `.product-snippet {
  color: var(--color-text-muted);
}`,
      diffSummary: "Restore high-contrast text color tokens var(--color-text-muted) and var(--color-text-primary) satisfying WCAG AA.",
    },
    expectedVisualImprovement: "Update text color to a darker tone such as var(--color-text-secondary) or #475569.",
    confidence: "high",
    confidenceScore: 0.92,
    potentialRisks: ["Ensure updated dark text color aligns with dark-mode theme tokens."],
    requiredValidationTests: [
      "tests/defect-injection.spec.ts",
      "tests/responsive.spec.ts",
      "tests/shopping-cart.spec.ts",
    ],
    humanReviewStatus: "pending_review",
    status: "proposed",
    createdAt: "2026-10-14T17:40:00.000Z",
    isMock: true,
    sourceFreshness: "fresh",
    visualEvidence: {
      scenarioId: "low-contrast-text",
      route: "/products",
      viewport: { width: 1440, height: 900 },
      baselineScreenshotUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'><rect width='400' height='300' fill='%23ffffff'/><text x='50' y='140' font-family='sans-serif' font-size='16' font-weight='bold' fill='%230f172a'>Baseline: Legible High-Contrast Text</text><text x='50' y='170' font-family='sans-serif' font-size='12' fill='%2364748b'>Contrast ratio: 4.76:1 (WCAG AA Pass)</text></svg>",
      defectiveScreenshotUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'><rect width='400' height='300' fill='%23ffffff'/><text x='50' y='140' font-family='sans-serif' font-size='16' font-weight='bold' fill='%23cbd5e1'>Defective: Low-Contrast Text Element</text><text x='50' y='170' font-family='sans-serif' font-size='12' fill='%23ef4444'>Contrast ratio: 1.48:1 (WCAG AA Fail)</text></svg>",
      pageTitle: "OmniShop — Products Catalogue",
      measurements: {
        wcagRatio: "1.48:1 (baseline: 4.76:1)",
        textColor: "#cbd5e1 (baseline: #64748b)",
      },
    },
  },
  {
    schemaVersion: "1.0",
    proposalId: "prop_mobile-nav-overflow_004",
    scenarioId: "mobile-nav-overflow",
    diagnosisRef: {
      diagnosisStatus: "diagnosed",
      model: "mock-vlm-v1",
      provider: "mock",
      primaryDefectCategory: "responsive_overflow",
      reportedConfidence: 0.95,
    },
    defectCategory: "responsive_overflow",
    severity: "high",
    localization: {
      status: "localized",
      filePath: "src/index.css",
      fileHash: "588aa17c68bff3d5e47266a022f89b2482c68fbbb64863a3b2fa677e55e128ba",
      componentOrSelector: ".navbar-container",
      excerpt: {
        filePath: "src/index.css",
        startLine: 101,
        endLine: 120,
        content: `.navbar-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.navbar-logo {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}`,
        sha256: "588aa17c68bff3d5e47266a022f89b2482c68fbbb64863a3b2fa677e55e128ba",
      },
      evidence: [
        {
          matchedSelector: ".navbar-container",
          matchedCategory: "responsive_overflow",
          sourceType: "css",
          rationale: "Located hardcoded min-width (650px) inside @media (max-width: 640px) query in src/index.css.",
          confidence: 0.95,
        },
      ],
      uncertaintyNotes: [],
    },
    suspectedRootCause: "Hardcoded 650px min-width in mobile media query.",
    evidenceExplanation: [
      "Navbar container is constrained to 650px min-width on a 390px mobile viewport.",
      "Document scroll width exceeds client width by 260px.",
    ],
    proposedCorrection: {
      type: "responsive_query_update",
      targetSelectorOrComponent: ".navbar-container, @media (max-width: 640px)",
      currentCode: `.navbar-container {
  width: 650px;
  min-width: 650px;
}`,
      proposedCode: `.navbar-container {
  width: 100%;
  max-width: 1200px;
  padding: 0.75rem 0.75rem;
}`,
      diffSummary: "Remove fixed 650px min-width in mobile media query, allowing fluid adaptation to 390px viewports without scroll overflow.",
    },
    expectedVisualImprovement: "Remove fixed min-width and wrap navigation links or implement a mobile hamburger drawer.",
    confidence: "high",
    confidenceScore: 0.95,
    potentialRisks: ["Verify that mobile nav menu items wrap cleanly or collapse into drawer on viewports < 360px."],
    requiredValidationTests: [
      "tests/defect-injection.spec.ts",
      "tests/responsive.spec.ts",
    ],
    humanReviewStatus: "pending_review",
    status: "proposed",
    createdAt: "2026-10-14T17:40:00.000Z",
    isMock: true,
    sourceFreshness: "fresh",
    visualEvidence: {
      scenarioId: "mobile-nav-overflow",
      route: "/products",
      viewport: { width: 390, height: 844 },
      baselineScreenshotUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='390' height='260' viewBox='0 0 390 260'><rect width='390' height='260' fill='%23f8fafc'/><rect x='0' y='0' width='390' height='56' fill='%23ffffff' stroke='%23e2e8f0'/><text x='195' y='140' font-family='sans-serif' font-size='13' font-weight='bold' fill='%230f172a' text-anchor='middle'>Clean Mobile: Fits 390px Viewport</text></svg>",
      defectiveScreenshotUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='500' height='260' viewBox='0 0 500 260'><rect width='500' height='260' fill='%23fef2f2'/><rect x='0' y='0' width='650' height='56' fill='%23ef4444' opacity='0.85'/><text x='250' y='140' font-family='sans-serif' font-size='13' font-weight='bold' fill='%23b91c1c' text-anchor='middle'>Horizontal Overflow: 650px scrollWidth</text></svg>",
      pageTitle: "OmniShop — Products Catalogue",
      measurements: {
        scrollWidth: "650px (baseline: 390px)",
        horizontalOverflow: "+260px",
      },
    },
  },
];
