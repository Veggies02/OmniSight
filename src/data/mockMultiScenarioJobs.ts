import type { CaptureJob } from "../types/multi-scenario-types";

export const INITIAL_MULTI_SCENARIO_JOBS: CaptureJob[] = [
  {
    jobId: "job-1024",
    title: "Storefront Multi-Viewport Inspection Run #1024",
    targetUrl: "http://localhost:5173/products",
    createdAt: "2026-11-01T08:30:00.000Z",
    updatedAt: "2026-11-01T08:31:15.000Z",
    overallStatus: "proposals_ready",
    scenarios: [
      {
        scenarioId: "scenario-img-distortion-01",
        title: "Product Image Distortion",
        description: "Catalogue hero images render stretched and distorted across widescreen viewports.",
        defectType: "image_distortion",
        severity: "critical",
        confidence: 0.98,
        diagnosis:
          "CSS .product-card-image specifies forced height with non-proportional scaling, causing aspect ratio distortion on cards.",
        proposedFix:
          "Apply aspect-ratio: 1 / 1 and object-fit: contain to enforce proportional image rendering without distorting product bounds.",
        patchId: "patch-product-image-distortion-001",
        targetFile: "src/index.css",
        status: "proposal_ready",
        approvalStatus: "pending",
        repairStatus: "idle",
        validationStatus: "untested",
        timestamps: {
          detectedAt: "2026-11-01T08:30:12.000Z",
        },
      },
      {
        scenarioId: "scenario-missing-cart-btn-02",
        title: "Missing Add to Cart Action Button",
        description: "Primary action button is clipped and inaccessible on compact tablet viewports.",
        defectType: "layout_breakage",
        severity: "high",
        confidence: 0.95,
        diagnosis:
          "Product card footer container has overflow: hidden and fixed container height, pushing the 'Add to Cart' button outside viewable bounds.",
        proposedFix:
          "Restructure card footer grid-template-rows and set overflow: visible with min-height constraints so CTA buttons remain visible.",
        patchId: "patch-product-card-layout-002",
        targetFile: "src/index.css",
        status: "proposal_ready",
        approvalStatus: "pending",
        repairStatus: "idle",
        validationStatus: "untested",
        timestamps: {
          detectedAt: "2026-11-01T08:30:24.000Z",
        },
      },
      {
        scenarioId: "scenario-mobile-nav-overflow-03",
        title: "Mobile Navigation Horizontal Overflow",
        description: "Header navigation container exceeds viewport width at 390x844 mobile resolution.",
        defectType: "responsive_overflow",
        severity: "medium",
        confidence: 0.92,
        diagnosis:
          "Navigation item row has fixed min-width and lacks flex-wrap, causing 43px horizontal overflow on iPhone viewports.",
        proposedFix:
          "Set max-width: 100vw, gap: 0.25rem, and compact navigation link padding in mobile media query.",
        patchId: "patch-mobile-nav-overflow-004",
        targetFile: "src/index.css",
        status: "proposal_ready",
        approvalStatus: "pending",
        repairStatus: "idle",
        validationStatus: "untested",
        timestamps: {
          detectedAt: "2026-11-01T08:30:35.000Z",
        },
      },
      {
        scenarioId: "scenario-low-contrast-text-04",
        title: "Low-Contrast Category Badge Text",
        description: "Product card category tags fail WCAG AA 4.5:1 contrast requirements.",
        defectType: "low_contrast",
        severity: "low",
        confidence: 0.89,
        diagnosis:
          "Category tag text color #9ca3af on background #f3f4f6 produces a contrast ratio of 2.1:1, failing accessibility standards.",
        proposedFix:
          "Darken badge foreground text to #374151 and set font-weight to 600, elevating contrast ratio to 5.4:1.",
        patchId: "patch-low-contrast-text-003",
        targetFile: "src/index.css",
        status: "proposal_ready",
        approvalStatus: "pending",
        repairStatus: "idle",
        validationStatus: "untested",
        timestamps: {
          detectedAt: "2026-11-01T08:30:45.000Z",
        },
      },
    ],
  },
];
