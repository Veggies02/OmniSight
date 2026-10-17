/**
 * OmniSight Types & Contracts
 * Compliant with existing repair, diagnosis, and evidence schemas.
 */

export interface WebsiteMonitored {
  id: string;
  name: string;
  url: string;
  targetRepo: string;
  environment: "Production" | "Staging" | "Preview";
  status: "healthy" | "defects_detected" | "inspecting" | "offline";
  lastInspectedAt: string;
  activeDefectsCount: number;
  healthScore: number;
  monitoredRoutes: string[];
}

export interface DefectItem {
  id: string;
  scenarioId: string;
  category: "image_distortion" | "layout_breakage" | "low_contrast" | "responsive_overflow" | "unknown";
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  detectedAt: string;
  route: string;
  targetElement: string;
  sourceFile: string;
  status: "open" | "diagnosed" | "repair_proposed" | "repair_approved" | "repair_verified" | "dismissed";
  baselineScreenshot: string;
  defectiveScreenshot: string;
  viewport: { width: number; height: number };
  evidenceRationale: string[];
  groundTruthLabel?: string; // Kept strictly separate for evaluation only
}

export interface InspectionRun {
  runId: string;
  timestamp: string;
  websiteUrl: string;
  websiteName: string;
  status: "completed" | "in_progress" | "failed";
  durationSeconds: number;
  scenariosInspected: number;
  defectsFound: number;
  healthImpact: string;
  triggerSource: "scheduled" | "ci_webhook" | "manual_request";
}

export interface VerificationItem {
  jobId: string;
  proposalId: string;
  defectCategory: string;
  patchId: string;
  createdAt: string;
  completedAt: string;
  finalState: "PASSED" | "FAILED" | "REJECTED";
  buildPassed: boolean;
  requiredTestsPassed: boolean;
  visualValidationPassed: boolean;
  isolatedWorktree: string;
  verifiedScreenshotUrl: string;
  diffSummary: string;
  failureReason?: string;
}

export interface ActivityLogItem {
  id: string;
  timestamp: string;
  type: "inspection_started" | "defect_detected" | "diagnosis_completed" | "repair_proposed" | "repair_approved" | "repair_rejected" | "repair_executed" | "verification_passed" | "verification_failed";
  title: string;
  details: string;
  userOrAgent: string;
  badgeType: "info" | "warning" | "success" | "danger" | "purple";
  referenceId?: string;
  linkTo?: string;
}
