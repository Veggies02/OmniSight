import type { BadgeStatus } from "../components/dashboard";

export type ValidationStatus =
  | "passed"
  | "failed"
  | "needs-review"
  | "pending"
  | "not-applicable";

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
    duration: "45s",
    viewport: "Desktop (1440 × 900)",
    defectSummary: "Visual scan executing on catalog grid...",
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
  },
];
