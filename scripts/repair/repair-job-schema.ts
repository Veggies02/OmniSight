import { RepairProposal } from '../vlm/repair-proposal-schema';

/**
 * Explicit state machine for repair execution jobs.
 * Enforces strict linear progression and terminal state finality.
 */
export type RepairJobState =
  | 'PENDING'
  | 'VALIDATING_APPROVAL'
  | 'PREPARING_WORKTREE'
  | 'PATCH_APPLIED'
  | 'RUNNING_TESTS'
  | 'VISUAL_VALIDATION'
  | 'PASSED'
  | 'FAILED'
  | 'REJECTED'
  | 'CLEANUP_REQUIRED';

/**
 * Valid allowed state transitions.
 */
export const VALID_REPAIR_TRANSITIONS: Record<RepairJobState, RepairJobState[]> = {
  PENDING: ['VALIDATING_APPROVAL', 'REJECTED', 'FAILED'],
  VALIDATING_APPROVAL: ['PREPARING_WORKTREE', 'REJECTED', 'FAILED'],
  PREPARING_WORKTREE: ['PATCH_APPLIED', 'FAILED', 'CLEANUP_REQUIRED'],
  PATCH_APPLIED: ['RUNNING_TESTS', 'FAILED', 'CLEANUP_REQUIRED'],
  RUNNING_TESTS: ['VISUAL_VALIDATION', 'FAILED', 'CLEANUP_REQUIRED'],
  VISUAL_VALIDATION: ['PASSED', 'FAILED', 'CLEANUP_REQUIRED'],
  PASSED: ['CLEANUP_REQUIRED'],
  FAILED: ['CLEANUP_REQUIRED'],
  REJECTED: [], // Terminal
  CLEANUP_REQUIRED: ['PASSED', 'FAILED'], // Final
};

export interface ApprovalValidationResult {
  approved: boolean;
  reviewStatus: 'pending_review' | 'approved' | 'rejected' | 'stale';
  reviewedBy?: string;
  reviewedAt?: string;
  approvalNotes?: string;
  sourceFreshnessVerified: boolean;
  recordedSourceHash: string;
  currentSourceHash: string;
  baseCommitVerified: boolean;
  targetBaseCommit: string;
  rejectionReason?: string;
}

export interface CommandExecutionResult {
  command: string;
  exitCode: number;
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
}

export interface VisualValidationResult {
  passed: boolean;
  verificationStatus?: 'passed' | 'failed' | 'inconclusive';
  defectCategory: string;
  route: string;
  viewport: {
    width: number;
    height: number;
  };
  cleanBaselineMetric?: Record<string, any>;
  defectiveMetric?: Record<string, any>;
  repairedMetric?: Record<string, any>;
  checks?: Array<{
    name: string;
    expected: string | number | boolean;
    actual: string | number | boolean | null;
    passed: boolean;
    details?: string;
  }>;
  failureReasons?: string[];
  assertionSummary: string;
  unrelatedRegressionsDetected: boolean;
  beforeScreenshotPath?: string;
  afterScreenshotPath?: string;
  resultJsonPath?: string;
}

export interface PatchApplicationResult {
  patchId: string;
  appliedSuccessfully: boolean;
  changedFiles: string[];
  diffSummary: string;
  appliedAt: string;
  rejectionReason?: string;
}

export interface RepairJobContract {
  jobId: string;
  proposalId: string;
  proposal: RepairProposal;
  approvedSourcePaths: string[];
  approvedPatchId: string;
  targetRepositoryPath: string;
  targetBaseCommit: string;
  createdAt: string;
  state?: RepairJobState;
}

export interface RepairExecutionReport {
  jobId: string;
  proposalId: string;
  defectCategory: string;
  targetBaseCommit: string;
  isolatedWorktreePath: string;
  isolatedBranch: string;
  patchId: string;
  createdAt: string;
  completedAt: string;
  finalState: RepairJobState;
  approvalValidation: ApprovalValidationResult;
  patchApplication?: PatchApplicationResult;
  buildExecution?: CommandExecutionResult;
  testExecution?: CommandExecutionResult;
  visualValidation?: VisualValidationResult;
  cleanupStatus: {
    cleaned: boolean;
    worktreeRemoved: boolean;
    branchRemoved: boolean;
    notes?: string;
  };
  failureReason?: string;
}

export function validateRepairJobContract(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Contract must be an object'] };
  }
  if (!data.jobId || typeof data.jobId !== 'string') errors.push('Missing or invalid jobId');
  if (!data.proposalId || typeof data.proposalId !== 'string') errors.push('Missing or invalid proposalId');
  if (!data.proposal || typeof data.proposal !== 'object') errors.push('Missing proposal object');
  if (!Array.isArray(data.approvedSourcePaths) || data.approvedSourcePaths.length === 0)
    errors.push('approvedSourcePaths must be a non-empty array of strings');
  if (!data.approvedPatchId || typeof data.approvedPatchId !== 'string') errors.push('Missing approvedPatchId');
  if (!data.targetBaseCommit || typeof data.targetBaseCommit !== 'string') errors.push('Missing targetBaseCommit');

  return { valid: errors.length === 0, errors };
}
