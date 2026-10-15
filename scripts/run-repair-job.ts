import fs from 'fs';
import path from 'path';
import { RepairExecutionService } from './repair/repair-execution-service';
import { RepairJobContract } from './repair/repair-job-schema';
import { findPatchForDefect } from './repair/patch-registry';

async function main() {
  const args = process.argv.slice(2);
  const proposalPathArg = args.find((a) => a.startsWith('--proposal='));
  const patchIdArg = args.find((a) => a.startsWith('--patch='));

  let proposal: any;

  if (proposalPathArg) {
    const rawPath = proposalPathArg.split('=')[1];
    const resolvedPath = path.resolve(process.cwd(), rawPath);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Error: Proposal file not found at ${resolvedPath}`);
      process.exit(1);
    }
    proposal = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
    if (Array.isArray(proposal)) {
      proposal = proposal[0];
    }
  } else {
    // If no path passed, look for the latest generated proposal artifact or use a standard approved one
    const artifactsDir = path.resolve(process.cwd(), 'artifacts', 'repair-proposals');
    if (fs.existsSync(artifactsDir)) {
      const runs = fs.readdirSync(artifactsDir).sort().reverse();
      if (runs.length > 0) {
        const candidate = path.join(artifactsDir, runs[0], 'repair_proposals.json');
        if (fs.existsSync(candidate)) {
          const raw = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
          const list = Array.isArray(raw) ? raw : Object.values(raw);
          proposal = list.find((p: any) => p.humanReviewStatus === 'approved') || list[0];
        }
      }
    }
  }

  if (!proposal) {
    console.error('No proposal found. Provide --proposal=<path-to-json>');
    process.exit(1);
  }

  const patch = patchIdArg
    ? { patchId: patchIdArg.split('=')[1] }
    : findPatchForDefect(proposal.defectCategory);

  if (!patch) {
    console.error(`No registered patch found for defect category: ${proposal.defectCategory}`);
    process.exit(1);
  }

  const jobId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const contract: RepairJobContract = {
    jobId,
    proposalId: proposal.proposalId,
    proposal,
    approvedSourcePaths: [proposal.sourceFilePath],
    approvedPatchId: patch.patchId,
    targetRepositoryPath: process.cwd(),
    targetBaseCommit: proposal.baseCommitSha || 'HEAD',
    createdAt: new Date().toISOString(),
    state: 'PENDING',
  };

  console.log(`Starting isolated repair job ${jobId} for proposal ${proposal.proposalId}...`);
  const service = new RepairExecutionService(process.cwd());
  const report = await service.executeRepairJob(contract);

  console.log('\n================ REPAIR EXECUTION REPORT ================');
  console.log(`Job ID:         ${report.jobId}`);
  console.log(`Final State:    ${report.finalState}`);
  console.log(`Approval Check: ${report.approvalValidation.approved ? 'APPROVED' : 'REJECTED'}`);
  console.log(`Patch Applied:  ${report.patchApplication?.appliedSuccessfully ? 'SUCCESS' : 'NO'}`);
  console.log(`Build Passed:   ${report.buildExecution?.passed ? 'YES' : 'NO'}`);
  console.log(`Visual Passed:  ${report.visualValidation?.passed ? 'YES' : 'NO'}`);
  console.log(`Worktree Clean: ${report.cleanupStatus.cleaned ? 'CLEANED' : 'WARNING'}`);
  if (report.failureReason) {
    console.log(`Failure Reason: ${report.failureReason}`);
  }
  console.log('=========================================================\n');
}

main().catch((err) => {
  console.error('Fatal repair execution error:', err);
  process.exit(1);
});
