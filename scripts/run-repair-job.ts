import fs from 'fs';
import path from 'path';
import { RepairExecutionService } from './repair/repair-execution-service';
import { RepairJobContract, RepairExecutionReport } from './repair/repair-job-schema';
import { findPatchForDefect, getRegisteredPatch } from './repair/patch-registry';
import { validateRepairProposalSchema, RepairProposal } from './vlm/repair-proposal-schema';

export interface RunRepairJobCliArgs {
  proposalPath?: string;
  jobId?: string;
  baseCommit?: string;
  patchId?: string;
}

/**
 * Parses and strictly validates CLI arguments for running an isolated repair job.
 */
export function parseRepairJobCliArgs(argv: string[]): RunRepairJobCliArgs {
  const result: RunRepairJobCliArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--proposal') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('Missing value for --proposal');
      }
      result.proposalPath = argv[++i];
    } else if (arg.startsWith('--proposal=')) {
      const val = arg.slice('--proposal='.length);
      if (!val) throw new Error('Missing value for --proposal');
      result.proposalPath = val;
    } else if (arg === '--job-id') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('Missing value for --job-id');
      }
      result.jobId = argv[++i];
    } else if (arg.startsWith('--job-id=')) {
      const val = arg.slice('--job-id='.length);
      if (!val) throw new Error('Missing value for --job-id');
      result.jobId = val;
    } else if (arg === '--base-commit') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('Missing value for --base-commit');
      }
      result.baseCommit = argv[++i];
    } else if (arg.startsWith('--base-commit=')) {
      const val = arg.slice('--base-commit='.length);
      if (!val) throw new Error('Missing value for --base-commit');
      result.baseCommit = val;
    } else if (arg === '--patch') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('Missing value for --patch');
      }
      result.patchId = argv[++i];
    } else if (arg.startsWith('--patch=')) {
      const val = arg.slice('--patch='.length);
      if (!val) throw new Error('Missing value for --patch');
      result.patchId = val;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: '${arg}'`);
    } else {
      throw new Error(`Unexpected argument: '${arg}'`);
    }
  }

  // Validate jobId if provided: alphanumeric, hyphen, underscore only, no path traversal
  if (result.jobId !== undefined) {
    const trimmed = result.jobId.trim();
    if (!trimmed || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      throw new Error(`Invalid --job-id: '${result.jobId}'. Must contain only alphanumeric, hyphen, or underscore characters.`);
    }
    result.jobId = trimmed;
  }

  // Validate baseCommit if provided: hexadecimal sha or valid ref (no spaces or command injections)
  if (result.baseCommit !== undefined) {
    const trimmed = result.baseCommit.trim();
    if (!trimmed || !/^[A-Za-z0-9_.-]+$/.test(trimmed) || trimmed.startsWith('-')) {
      throw new Error(`Invalid --base-commit: '${result.baseCommit}'. Must be a valid commit SHA or ref.`);
    }
    result.baseCommit = trimmed;
  }

  // Validate patchId if provided
  if (result.patchId !== undefined) {
    const trimmed = result.patchId.trim();
    if (!trimmed || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      throw new Error(`Invalid --patch: '${result.patchId}'. Must be a valid patch ID string.`);
    }
    result.patchId = trimmed;
  }

  return result;
}

/**
 * Loads and validates a proposal from disk or discovers the latest approved one.
 */
export function loadAndValidateProposal(
  proposalPath?: string,
  repoRoot: string = process.cwd()
): { proposal: RepairProposal; resolvedPath: string } {
  let resolvedPath = '';

  if (proposalPath) {
    const trimmed = proposalPath.trim();
    if (!trimmed) {
      throw new Error('Proposal path cannot be empty.');
    }
    const target = path.resolve(repoRoot, trimmed);
    // Security check: ensure path is within repository root or explicitly allowed directory
    if (trimmed.includes('..') && !target.startsWith(path.resolve(repoRoot))) {
      throw new Error(`Invalid --proposal path '${proposalPath}': Path traversal outside repository root is forbidden.`);
    }
    if (!fs.existsSync(target)) {
      throw new Error(`Proposal file not found at ${target}`);
    }
    resolvedPath = target;
  } else {
    // If no path passed, look for the latest generated proposal artifact
    const artifactsDir = path.resolve(repoRoot, 'artifacts', 'repair-proposals');
    if (fs.existsSync(artifactsDir)) {
      const runs = fs.readdirSync(artifactsDir).sort().reverse();
      if (runs.length > 0) {
        const candidate = path.join(artifactsDir, runs[0], 'repair_proposals.json');
        if (fs.existsSync(candidate)) {
          resolvedPath = candidate;
        }
      }
    }
  }

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    throw new Error('No proposal found. Provide --proposal=<path-to-json>');
  }

  let rawContent: any;
  try {
    rawContent = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
  } catch (err: any) {
    throw new Error(`Malformed proposal JSON in ${resolvedPath}: ${err.message}`);
  }

  let proposal: any = rawContent;
  if (Array.isArray(rawContent)) {
    proposal = rawContent.find((p: any) => p.humanReviewStatus === 'approved') || rawContent[0];
  } else if (rawContent && typeof rawContent === 'object' && !rawContent.schemaVersion && rawContent.results) {
    // Support proposal run manifest wrapper
    const list = Object.values(rawContent.results);
    proposal = list.find((p: any) => p.humanReviewStatus === 'approved') || list[0];
  } else if (rawContent && typeof rawContent === 'object' && !rawContent.schemaVersion) {
    // Support scenario-keyed proposal map (e.g. { "product-image-distortion": { ... } })
    const list = Object.values(rawContent);
    if (list.length > 0 && typeof list[0] === 'object' && (list[0] as any)?.schemaVersion) {
      proposal = list.find((p: any) => (p as any).humanReviewStatus === 'approved') || list[0];
    }
  }

  if (!proposal || typeof proposal !== 'object') {
    throw new Error(`No valid proposal object could be read from ${resolvedPath}`);
  }

  const schemaValidation = validateRepairProposalSchema(proposal);
  if (!schemaValidation.valid) {
    throw new Error(`Invalid proposal schema in ${resolvedPath}: ${schemaValidation.errors.join('; ')}`);
  }

  return { proposal, resolvedPath };
}

/**
 * Main execution function callable directly or via CLI.
 */
export async function runRepairJob(
  argv: string[] = process.argv.slice(2),
  repoRoot: string = process.cwd()
): Promise<{ success: boolean; report: RepairExecutionReport; reportPath: string }> {
  const cliArgs = parseRepairJobCliArgs(argv);
  const { proposal, resolvedPath } = loadAndValidateProposal(cliArgs.proposalPath, repoRoot);

  const jobId = cliArgs.jobId || `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const targetBaseCommit = cliArgs.baseCommit || (proposal as any).baseCommitSha || 'HEAD';

  // 1. Resolve registered patch
  const patch = cliArgs.patchId
    ? getRegisteredPatch(cliArgs.patchId)
    : findPatchForDefect(proposal.defectCategory);

  if (!patch) {
    const errorMsg = cliArgs.patchId
      ? `Specified patch '${cliArgs.patchId}' not found in registered patch catalog.`
      : `No registered patch found for defect category: ${proposal.defectCategory}`;

    // Return structured rejection report without executing
    const service = new RepairExecutionService(repoRoot);
    const rejectionReport: RepairExecutionReport = {
      jobId,
      proposalId: proposal.proposalId,
      defectCategory: proposal.defectCategory,
      targetBaseCommit,
      isolatedWorktreePath: '',
      isolatedBranch: '',
      patchId: cliArgs.patchId || 'unknown',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      finalState: 'REJECTED',
      approvalValidation: {
        approved: proposal.humanReviewStatus === 'approved',
        reviewStatus: proposal.humanReviewStatus,
        sourceFreshnessVerified: false,
        recordedSourceHash: proposal.localization?.fileHash || '',
        currentSourceHash: '',
        baseCommitVerified: false,
        targetBaseCommit,
        rejectionReason: errorMsg,
      },
      cleanupStatus: { cleaned: true, worktreeRemoved: false, branchRemoved: false },
      failureReason: errorMsg,
    };
    const reportPath = service.saveReport(jobId, rejectionReport);
    return { success: false, report: rejectionReport, reportPath };
  }

  // 2. Strict Pre-flight Human Approval Enforcement
  if (proposal.humanReviewStatus !== 'approved') {
    const reason = `Human review validation failed: Proposal '${proposal.proposalId}' has review status '${proposal.humanReviewStatus}', must be 'approved' before code repair.`;
    const service = new RepairExecutionService(repoRoot);
    const rejectionReport: RepairExecutionReport = {
      jobId,
      proposalId: proposal.proposalId,
      defectCategory: proposal.defectCategory,
      targetBaseCommit,
      isolatedWorktreePath: '',
      isolatedBranch: '',
      patchId: patch.patchId,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      finalState: 'REJECTED',
      approvalValidation: {
        approved: false,
        reviewStatus: proposal.humanReviewStatus,
        reviewedBy: (proposal as any).reviewedBy,
        reviewedAt: (proposal as any).reviewedAt,
        approvalNotes: (proposal as any).reviewNotes,
        sourceFreshnessVerified: false,
        recordedSourceHash: proposal.localization?.fileHash || '',
        currentSourceHash: '',
        baseCommitVerified: false,
        targetBaseCommit,
        rejectionReason: reason,
      },
      cleanupStatus: { cleaned: true, worktreeRemoved: false, branchRemoved: false },
      failureReason: reason,
    };
    const reportPath = service.saveReport(jobId, rejectionReport);
    return { success: false, report: rejectionReport, reportPath };
  }

  // 3. Assemble verified contract
  const targetSourcePath = proposal.localization?.filePath || (proposal as any).sourceFilePath || 'src/index.css';
  const contract: RepairJobContract = {
    jobId,
    proposalId: proposal.proposalId,
    proposal,
    approvedSourcePaths: [targetSourcePath],
    approvedPatchId: patch.patchId,
    targetRepositoryPath: repoRoot,
    targetBaseCommit,
    createdAt: new Date().toISOString(),
    state: 'PENDING',
  };

  console.error(`[OmniSight Repair CLI] Starting isolated repair job ${jobId} for proposal ${proposal.proposalId}...`);
  console.error(`[OmniSight Repair CLI] Source: ${targetSourcePath} | Patch: ${patch.patchId} | Base: ${targetBaseCommit}`);

  // 4. Execute inside isolated worktree via RepairExecutionService
  const service = new RepairExecutionService(repoRoot);
  const report = await service.executeRepairJob(contract);
  const reportPath = path.join(repoRoot, 'artifacts', 'repair-executions', jobId, 'repair_execution_report.json');

  const success = report.finalState === 'PASSED';
  return { success, report, reportPath };
}

async function main() {
  try {
    const { success, report, reportPath } = await runRepairJob();

    // Print machine-readable JSON summary to stdout
    console.log(JSON.stringify({
      jobId: report.jobId,
      proposalId: report.proposalId,
      patchId: report.patchId,
      finalState: report.finalState,
      approved: report.approvalValidation?.approved ?? false,
      buildPassed: report.buildExecution?.passed ?? false,
      visualPassed: report.visualValidation?.passed ?? false,
      reportPath,
      failureReason: report.failureReason,
    }, null, 2));

    if (!success) {
      console.error(`\n[OmniSight Repair CLI] Repair job ${report.jobId} did not pass: ${report.failureReason || report.finalState}`);
      process.exit(1);
    }

    console.error(`\n[OmniSight Repair CLI] Repair job ${report.jobId} completed successfully!`);
    process.exit(0);
  } catch (err: any) {
    console.error(`\n[OmniSight Repair CLI] Fatal error: ${err.message}`);
    // Emit minimal error JSON to stdout for machine consumption
    console.log(JSON.stringify({
      finalState: 'FAILED',
      approved: false,
      failureReason: err.message,
    }, null, 2));
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('run-repair-job.ts')) {
  main();
}
