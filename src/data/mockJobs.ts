import type { BadgeStatus } from "../components/dashboard";
import heroImg from "../assets/hero.png";

export type ValidationStatus =
  | "passed"
  | "failed"
  | "needs-review"
  | "pending"
  | "not-applicable";

export type DefectSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "major"
  | "minor"
  | "cosmetic";

export type DefectStatus =
  | "open"
  | "under-review"
  | "resolved"
  | "fix-staged"
  | "pending-review";

export interface DefectFinding {
  id: string;
  title: string;
  category: string;
  severity: DefectSeverity;
  affectedComponent: string;
  status: DefectStatus;
  description: string;
  selector?: string;
  evidenceRef?: string;
  jobId?: string;
  targetRoute?: string;
}

export interface InspectionEvidence {
  id: string;
  type: "screenshot" | "dom-snapshot" | "playwright-trace" | "visual-comparison";
  title: string;
  viewport: string;
  capturedAt: string;
  dimensions?: string;
  description?: string;
  imageUrl?: string;
  baselineImageUrl?: string;
  defectiveImageUrl?: string;
  diffImageUrl?: string;
  defectId?: string;
  jobId?: string;
  devicePixelRatio?: number;
  browser?: string;
  selector?: string;
  baselineLabel?: string;
  defectiveLabel?: string;
}

export interface InspectionJob {
  id: string;
  application: string;
  targetRoute: string;
  timestamp: string;
  startedAt: string;
  status: BadgeStatus;
  defectsCount: number;
  validationStatus: ValidationStatus;
  duration: string;
  viewport: string;
  defectSummary?: string;
  defects?: DefectFinding[];
  evidence?: InspectionEvidence[];
}

export const MOCK_INSPECTION_JOBS: InspectionJob[] = [
  {
    id: "JOB-1085",
    application: "OmniShop Storefront",
    targetRoute: "/products",
    timestamp: "2026-10-16T22:45:00Z",
    startedAt: "5 mins ago",
    status: "running",
    defectsCount: 0,
    validationStatus: "pending",
    duration: "45s (active)",
    viewport: "Desktop (1440 × 900)",
    defectSummary: "Visual scan executing on catalog grid...",
    defects: [],
    evidence: [],
  },
  {
    id: "JOB-1084",
    application: "OmniShop Storefront",
    targetRoute: "/checkout",
    timestamp: "2026-10-16T22:20:00Z",
    startedAt: "30 mins ago",
    status: "failed",
    defectsCount: 2,
    validationStatus: "needs-review",
    duration: "1m 18s",
    viewport: "Mobile (390 × 844)",
    defectSummary: "2 layout overflow faults on payment card inputs",
    defects: [
      {
        id: "DEF-201",
        title: "Credit Card Expiry input overflows mobile viewport",
        category: "Layout Overflow",
        severity: "critical",
        affectedComponent: "Checkout.tsx (PaymentForm)",
        status: "open",
        description: "The two-column grid in payment form does not wrap under 400px width, causing horizontal scrollbar.",
        selector: ".checkout-form .card-expiry-row",
        evidenceRef: "EVI-301",
        jobId: "JOB-1084",
        targetRoute: "/checkout",
      },
      {
        id: "DEF-202",
        title: "CVV tooltip clipped by screen boundary",
        category: "Clipping Fault",
        severity: "low",
        affectedComponent: "Checkout.tsx (CVVHelper)",
        status: "fix-staged",
        description: "CVV helper badge popup renders with negative right offset on mobile viewports.",
        selector: ".cvv-info-tooltip",
        evidenceRef: "EVI-302",
        jobId: "JOB-1084",
        targetRoute: "/checkout",
      },
    ],
    evidence: [
      {
        id: "EVI-301",
        type: "screenshot",
        title: "Mobile Viewport Checkout Layout Overflow",
        viewport: "Mobile (390 × 844, 2x DPR)",
        capturedAt: "2026-10-16 22:20:14 UTC",
        dimensions: "390 × 844 px",
        description: "Playwright automated capture during checkout payment stage on iPhone 14 viewport.",
        baselineImageUrl: heroImg,
        defectiveImageUrl: heroImg,
        defectId: "DEF-201",
        jobId: "JOB-1084",
        browser: "Chromium Headless (Playwright v1.48.0)",
        selector: ".checkout-form .card-expiry-row",
        devicePixelRatio: 2,
        baselineLabel: "Clean Baseline (Pre-release)",
        defectiveLabel: "Defective Capture (PR #42 Regression)",
      },
      {
        id: "EVI-302",
        type: "playwright-trace",
        title: "Browser Execution Trace & DOM Snapshot",
        viewport: "Mobile (390 × 844)",
        capturedAt: "2026-10-16 22:20:18 UTC",
        description: "Full network HAR, console logs, and action timeline from start to failure.",
        jobId: "JOB-1084",
        defectId: "DEF-202",
        browser: "Chromium Headless (Playwright v1.48.0)",
      },
    ],
  },
  {
    id: "JOB-1083",
    application: "OmniShop Storefront",
    targetRoute: "/cart",
    timestamp: "2026-10-16T21:30:00Z",
    startedAt: "1 hour ago",
    status: "failed",
    defectsCount: 1,
    validationStatus: "passed",
    duration: "52s",
    viewport: "Desktop (1440 × 900)",
    defectSummary: "Contrast ratio fault on checkout CTA button (self-healed & validated)",
    defects: [
      {
        id: "DEF-188",
        title: "Proceed to Checkout button low contrast ratio",
        category: "Accessibility / Contrast",
        severity: "high",
        affectedComponent: "Cart.tsx (CartSummary)",
        status: "resolved",
        description: "Text color #94a3b8 on background #dbeafe provides only 2.4:1 contrast (WCAG AA requires 4.5:1).",
        selector: ".cart-summary .btn-checkout",
        evidenceRef: "EVI-288",
        jobId: "JOB-1083",
        targetRoute: "/cart",
      },
    ],
    evidence: [
      {
        id: "EVI-288",
        type: "screenshot",
        title: "Cart Summary Contrast Baseline vs Fix",
        viewport: "Desktop (1440 × 900)",
        capturedAt: "2026-10-16 21:30:45 UTC",
        dimensions: "1440 × 900 px",
        description: "Pre-patch visual capture showing muted low-contrast button state.",
        baselineImageUrl: heroImg,
        defectId: "DEF-188",
        jobId: "JOB-1083",
        browser: "Chromium Headless (Playwright v1.48.0)",
        selector: ".cart-summary .btn-checkout",
        baselineLabel: "WCAG AA Baseline (Expected)",
        defectiveLabel: "Uncaptured Defective State",
      },
    ],
  },
  {
    id: "JOB-1082",
    application: "OmniShop Storefront",
    targetRoute: "/products/1",
    timestamp: "2026-10-16T20:15:00Z",
    startedAt: "2 hours ago",
    status: "passed",
    defectsCount: 0,
    validationStatus: "not-applicable",
    duration: "48s",
    viewport: "Desktop (1440 × 900)",
    defectSummary: "Zero defects detected across product details specification sheet",
    defects: [],
    evidence: [],
  },
  {
    id: "JOB-1081",
    application: "OmniShop Storefront",
    targetRoute: "/",
    timestamp: "2026-10-16T18:00:00Z",
    startedAt: "4 hours ago",
    status: "passed",
    defectsCount: 0,
    validationStatus: "not-applicable",
    duration: "1m 02s",
    viewport: "Desktop (1440 × 900)",
    defectSummary: "Hero section, navbar, and featured cards fully aligned",
    defects: [],
    evidence: [],
  },
  {
    id: "JOB-1080",
    application: "OmniShop Storefront",
    targetRoute: "/checkout",
    timestamp: "2026-10-16T14:30:00Z",
    startedAt: "8 hours ago",
    status: "failed",
    defectsCount: 3,
    validationStatus: "failed",
    duration: "1m 45s",
    viewport: "Tablet (768 × 1024)",
    defectSummary: "Shipping form text cutoff and button alignment fault",
    defects: [
      {
        id: "DEF-145",
        title: "Postal code field label overlapped by input border",
        category: "Alignment Fault",
        severity: "high",
        affectedComponent: "Checkout.tsx (ShippingForm)",
        status: "under-review",
        description: "Floating label animation clips top input border when prefilled on tablet width.",
        selector: ".shipping-form #zip-input",
        evidenceRef: "EVI-145",
        jobId: "JOB-1080",
        targetRoute: "/checkout",
      },
      {
        id: "DEF-146",
        title: "Standard Shipping radio button text truncated",
        category: "Text Truncation",
        severity: "medium",
        affectedComponent: "Checkout.tsx (DeliveryOptions)",
        status: "open",
        description: "Label string 'Delivered within 3 business days' truncated with ellipsis unnecessarily.",
        selector: ".delivery-options .radio-label",
        evidenceRef: "EVI-145",
        jobId: "JOB-1080",
        targetRoute: "/checkout",
      },
      {
        id: "DEF-147",
        title: "Back to Cart button misplaced below page fold",
        category: "Layout Misalignment",
        severity: "low",
        affectedComponent: "Checkout.tsx (NavigationControls)",
        status: "open",
        description: "Secondary navigation button margins push action 180px below the viewport bottom fold.",
        selector: ".checkout-actions .btn-back",
        jobId: "JOB-1080",
        targetRoute: "/checkout",
      },
    ],
    evidence: [
      {
        id: "EVI-145",
        type: "screenshot",
        title: "Tablet 768px Viewport Shipping Form Scan",
        viewport: "Tablet (768 × 1024)",
        capturedAt: "2026-10-16 14:31:10 UTC",
        dimensions: "768 × 1024 px",
        description: "Tablet viewport Playwright snapshot highlighting layout overlap errors.",
        defectiveImageUrl: "/assets/simulated-missing-artifact.png", // purposefully tests failed image loading handling
        defectId: "DEF-145",
        jobId: "JOB-1080",
        browser: "WebKit (Playwright v1.48.0)",
        selector: ".shipping-form #zip-input",
        defectiveLabel: "Fault Ingestion Snapshot",
      },
    ],
  },
  {
    id: "JOB-1079",
    application: "OmniShop Storefront",
    targetRoute: "/products",
    timestamp: "2026-10-15T23:00:00Z",
    startedAt: "Yesterday",
    status: "passed",
    defectsCount: 0,
    validationStatus: "not-applicable",
    duration: "56s",
    viewport: "Desktop (1440 × 900)",
    defectSummary: "Zero visual regressions on category filter bars",
    defects: [],
    evidence: [],
  },
  {
    id: "JOB-1078",
    application: "OmniShop Storefront",
    targetRoute: "/cart",
    timestamp: "2026-10-15T18:20:00Z",
    startedAt: "Yesterday",
    status: "pending",
    defectsCount: 0,
    validationStatus: "pending",
    duration: "Queued",
    viewport: "Mobile (390 × 844)",
    defectSummary: "Queued for automated Playwright multi-viewport scan",
    defects: [],
    evidence: [],
  },
];

export function getInspectionJobById(id: string): InspectionJob | undefined {
  const cleanId = id.replace(/^#/, "").trim().toLowerCase();
  return MOCK_INSPECTION_JOBS.find(
    (job) => job.id.toLowerCase() === cleanId || job.id.toLowerCase() === `job-${cleanId}`
  );
}

export function getAllDefectFindings(): DefectFinding[] {
  const all: DefectFinding[] = [];
  MOCK_INSPECTION_JOBS.forEach((job) => {
    if (job.defects) {
      job.defects.forEach((defect) => {
        all.push({
          ...defect,
          jobId: job.id,
          targetRoute: job.targetRoute,
        });
      });
    }
  });
  return all;
}

export function getAllEvidence(): InspectionEvidence[] {
  const all: InspectionEvidence[] = [];
  const seen = new Set<string>();
  MOCK_INSPECTION_JOBS.forEach((job) => {
    if (job.evidence) {
      job.evidence.forEach((evi) => {
        if (!seen.has(evi.id)) {
          seen.add(evi.id);
          all.push(evi);
        }
      });
    }
  });
  return all;
}
