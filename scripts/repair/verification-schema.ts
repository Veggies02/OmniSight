/**
 * Strongly typed post-repair UI verification schema.
 * Supports granular verification checks, three-state status model (passed, failed, inconclusive),
 * baseline/defective/repaired evidence tracking, and artifact persistence.
 */

export type VerificationStatus = 'passed' | 'failed' | 'inconclusive';

export interface VerificationCheck {
  name: string;
  expected: string | number | boolean;
  actual: string | number | boolean | null;
  passed: boolean;
  details?: string;
}

export interface VerificationEvidencePaths {
  screenshotPath?: string;
  domPath?: string;
  measurementsPath?: string;
}

export interface PostRepairVerificationResult {
  runId: string;
  scenarioId: string;
  defectCategory: string;
  verificationStatus: VerificationStatus;
  timestamp: string;
  viewport: {
    width: number;
    height: number;
  };
  checks: VerificationCheck[];
  baselineEvidence?: VerificationEvidencePaths;
  defectiveEvidence?: VerificationEvidencePaths;
  postRepairEvidence: VerificationEvidencePaths;
  baselineMetrics?: Record<string, any>;
  defectiveMetrics?: Record<string, any>;
  repairedMetrics?: Record<string, any>;
  failureReasons: string[];
  durationMs: number;
  unrelatedRegressionsDetected: boolean;
  assertionSummary: string;
}

export interface VerificationOptions {
  runId?: string;
  scenarioId: string;
  defectCategory?: string;
  targetUrl: string;
  viewport?: { width: number; height: number };
  artifactsDir?: string;
  repoRoot?: string;
  timeoutMs?: number;
}
