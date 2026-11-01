/**
 * Multi-Scenario Frontend Data Contracts (Day 14 Prototype Foundation)
 *
 * Models a single Capture Job containing multiple detected UI defects/scenarios,
 * enabling independent diagnosis, proposals, human approvals, and repair simulations.
 *
 * NOTE: These are isolated frontend prototype types designed to be swapped
 * with the finalized backend multi-scenario contract once Person 2 & 3 finalize Week 3 schemas.
 */

export type ScenarioStatus =
  | "pending"
  | "proposal_ready"
  | "approved"
  | "rejected"
  | "repairing"
  | "repaired"
  | "failed"
  | "unsupported";

export type ScenarioApprovalStatus = "pending" | "approved" | "rejected";

export type ScenarioRepairStatus = "idle" | "in_progress" | "completed" | "failed";

export type ScenarioValidationStatus = "passed" | "failed" | "inconclusive" | "untested";

export type ScenarioDefectSeverity = "low" | "medium" | "high" | "critical";

export interface ScenarioTimestamps {
  detectedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  repairedAt?: string;
}

export interface ScenarioRepairReport {
  simulated: true;
  stepsCompleted: string[];
  durationSeconds: number;
  buildPassed: boolean;
  visualValidationPassed: boolean;
  message: string;
}

export interface ScenarioItem {
  scenarioId: string;
  title: string;
  description: string;
  defectType: string;
  severity: ScenarioDefectSeverity;
  confidence: number; // 0.0 to 1.0
  diagnosis: string;
  proposedFix: string;
  patchId: string;
  targetFile: string;
  status: ScenarioStatus;
  approvalStatus: ScenarioApprovalStatus;
  repairStatus: ScenarioRepairStatus;
  validationStatus: ScenarioValidationStatus;
  reviewedBy?: string;
  rejectionReason?: string;
  timestamps: ScenarioTimestamps;
  repairReport?: ScenarioRepairReport;
}

export interface CaptureJob {
  jobId: string;
  title: string;
  targetUrl: string;
  createdAt: string;
  updatedAt: string;
  overallStatus: "analyzing" | "proposals_ready" | "in_progress" | "completed";
  scenarios: ScenarioItem[];
}

export interface CaptureJobSummary {
  totalScenarios: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  repairingCount: number;
  repairedCount: number;
  failedCount: number;
  unsupportedCount: number;
}

/**
 * Pure selector to compute aggregate statistics from scenarios reactively.
 * Avoids storing duplicated summary fields that could desynchronize.
 */
export function computeJobSummary(scenarios: ScenarioItem[]): CaptureJobSummary {
  let pendingCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let repairingCount = 0;
  let repairedCount = 0;
  let failedCount = 0;
  let unsupportedCount = 0;

  for (const s of scenarios) {
    if (s.status === "repairing") {
      repairingCount++;
    } else if (s.status === "repaired") {
      repairedCount++;
    } else if (s.status === "failed") {
      failedCount++;
    } else if (s.status === "unsupported") {
      unsupportedCount++;
    } else if (s.approvalStatus === "approved") {
      approvedCount++;
    } else if (s.approvalStatus === "rejected") {
      rejectedCount++;
    } else {
      pendingCount++;
    }
  }

  return {
    totalScenarios: scenarios.length,
    pendingCount,
    approvedCount,
    rejectedCount,
    repairingCount,
    repairedCount,
    failedCount,
    unsupportedCount,
  };
}
