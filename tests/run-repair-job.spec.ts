import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  parseRepairJobCliArgs,
  loadAndValidateProposal,
  runRepairJob,
} from '../scripts/run-repair-job';
import { WorktreeManager } from '../scripts/repair/worktree-manager';
import { computeFileHash } from '../scripts/vlm/source-path-security';
import crypto from 'crypto';
import { proposalDigestPayload } from '../scripts/vlm/proposal-digest';

test.describe('Step 4.6 run-repair-job CLI & Contract Validation Tests', () => {
  const repoRoot = process.cwd();
  const validCssPath = path.resolve(repoRoot, 'src/index.css');
  const validHash = computeFileHash(validCssPath);
  let proposalFixtureCounter = 0;
  const proposalFixtureDirs: string[] = [];

  // Helper fixture for a valid approved proposal
  const makeProposal = (overrides: Record<string, any> = {}) => {
    const sequence = `${process.pid}-${++proposalFixtureCounter}-${crypto.randomUUID()}`;
    const scenarioId = overrides.scenarioId ?? 'product-image-distortion';
    const runId = `run-test-provenance-${sequence}`;
    const attemptId = `attempt-test-${sequence}`;
    const diagnosisDir = path.join(repoRoot, 'artifacts/visual-evidence', runId, 'diagnoses');
    const manifestPath = path.join(diagnosisDir, 'diagnoses-manifest.json');
    proposalFixtureDirs.push(path.join(repoRoot, 'artifacts/visual-evidence', runId));
    const proposal: any = {
    schemaVersion: '1.0',
    proposalId: overrides.proposalId || `prop_test_${sequence}`,
    runId,
    attemptId,
    diagnosisManifestPath: path.relative(repoRoot, manifestPath),
    registeredPatchId: scenarioId ? 'patch-product-image-distortion-001' : null,
    scenarioId,
    diagnosisRef: {
      diagnosisStatus: 'diagnosed',
      model: 'mock-vision',
      provider: 'mock',
      primaryDefectCategory: 'image_distortion',
      reportedConfidence: 0.95,
    },
    defectCategory: 'image_distortion',
    severity: 'medium',
    localization: {
      status: 'localized',
      filePath: 'src/index.css',
      fileHash: validHash,
      componentOrSelector: '.product-image',
      excerpt: {
        filePath: 'src/index.css',
        startLine: 1,
        endLine: 10,
        content: '.test {}',
        sha256: validHash,
      },
      evidence: [],
      uncertaintyNotes: [],
    },
    suspectedRootCause: 'Stretched aspect ratio on image element',
    evidenceExplanation: ['Aspect ratio distortion detected'],
    proposedCorrection: {
      type: 'css_rule_modification',
      targetSelectorOrComponent: '.product-image',
      currentCode: 'object-fit: fill;',
      proposedCode: 'object-fit: cover;',
      diffSummary: 'Fix object-fit',
    },
    expectedVisualImprovement: 'Natural aspect ratio restored',
    confidence: 'high',
    confidenceScore: 0.95,
    potentialRisks: [],
    requiredValidationTests: ['npm run build'],
    humanReviewStatus: 'approved',
    status: 'proposed',
    createdAt: new Date().toISOString(),
    isMock: true,
    reviewedBy: 'qa-engineer@omnisight.ai',
    reviewedAt: new Date().toISOString(),
    reviewNotes: 'Verified and authorized for automated worktree repair.',
    ...overrides,
    };
    const diagnosisCategory = proposal.diagnosisRef.primaryDefectCategory || 'image_distortion';
    proposal.registeredPatchId = scenarioId === 'product-image-distortion' ? 'patch-product-image-distortion-001' : null;
    proposal.proposalDigest = crypto.createHash('sha256').update(proposalDigestPayload(proposal)).digest('hex');
    if (proposal.humanReviewStatus === 'approved') proposal.approvalDigest = proposal.proposalDigest;
    fs.mkdirSync(diagnosisDir, { recursive: true });
    const diagnosis = {
      schema_version: '1.0', status: 'diagnosed', summary: 'Test diagnosis', limitations: [],
      defects: [{ category: diagnosisCategory, severity: 'medium', confidence: 0.95, description: 'Test defect', evidence: ['Test visual evidence'], affected_element: { description: 'Product image' }, suspected_cause: 'Test cause', suggested_fix: 'Test fix' }],
    };
    fs.writeFileSync(manifestPath, JSON.stringify({ runId, attemptId, status: 'completed', timestamp: new Date().toISOString(), provider: 'mock', model: 'mock', scenariosDiagnosed: 1, totalScenarios: 1, results: { [scenarioId || 'legacy-scenario']: { scenarioId: scenarioId || 'legacy-scenario', status: 'diagnosed', diagnosis, model: 'mock', provider: 'mock' } }, scenarioAliases: [], outputArtifactsDirectory: diagnosisDir }));
    fs.writeFileSync(path.join(diagnosisDir, 'diagnosis-attempt.json'), JSON.stringify({ runId, attemptId, status: 'completed', manifestPath: path.resolve(manifestPath) }));
    return proposal;
  };

  test.afterAll(() => {
    for (const dir of proposalFixtureDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  // A. CLI Argument Parsing Tests
  test.describe('A. CLI Argument Parsing', () => {
    test('parses space-separated syntax', () => {
      const args = parseRepairJobCliArgs([
        '--proposal',
        'artifacts/test.json',
        '--job-id',
        'job-123',
        '--base-commit',
        'HEAD',
        '--patch',
        'patch-product-image-distortion-001',
      ]);
      expect(args.proposalPath).toBe('artifacts/test.json');
      expect(args.jobId).toBe('job-123');
      expect(args.baseCommit).toBe('HEAD');
      expect(args.patchId).toBe('patch-product-image-distortion-001');
    });

    test('parses equals-separated syntax', () => {
      const args = parseRepairJobCliArgs([
        '--proposal=artifacts/test.json',
        '--job-id=job-equals-456',
        '--base-commit=main',
        '--patch=patch-mobile-nav-overflow-004',
      ]);
      expect(args.proposalPath).toBe('artifacts/test.json');
      expect(args.jobId).toBe('job-equals-456');
      expect(args.baseCommit).toBe('main');
      expect(args.patchId).toBe('patch-mobile-nav-overflow-004');
    });

    test('rejects missing argument values', () => {
      expect(() => parseRepairJobCliArgs(['--proposal'])).toThrow(/Missing value for --proposal/);
      expect(() => parseRepairJobCliArgs(['--proposal='])).toThrow(/Missing value for --proposal/);
      expect(() => parseRepairJobCliArgs(['--job-id'])).toThrow(/Missing value for --job-id/);
      expect(() => parseRepairJobCliArgs(['--job-id='])).toThrow(/Missing value for --job-id/);
      expect(() => parseRepairJobCliArgs(['--base-commit'])).toThrow(/Missing value for --base-commit/);
      expect(() => parseRepairJobCliArgs(['--base-commit='])).toThrow(/Missing value for --base-commit/);
      expect(() => parseRepairJobCliArgs(['--patch'])).toThrow(/Missing value for --patch/);
      expect(() => parseRepairJobCliArgs(['--patch='])).toThrow(/Missing value for --patch/);
    });

    test('rejects unknown options and unexpected positionals', () => {
      expect(() => parseRepairJobCliArgs(['--unrecognized-flag'])).toThrow(/Unknown option: '--unrecognized-flag'/);
      expect(() => parseRepairJobCliArgs(['positional-arg'])).toThrow(/Unexpected argument: 'positional-arg'/);
    });

    test('rejects invalid or dangerous job IDs', () => {
      expect(() => parseRepairJobCliArgs(['--job-id', '../escape'])).toThrow(/Invalid --job-id/);
      expect(() => parseRepairJobCliArgs(['--job-id', 'job/123'])).toThrow(/Invalid --job-id/);
      expect(() => parseRepairJobCliArgs(['--job-id', 'job 123'])).toThrow(/Invalid --job-id/);
    });

    test('rejects dangerous base-commit references', () => {
      expect(() => parseRepairJobCliArgs(['--base-commit', '-x'])).toThrow(/Invalid --base-commit/);
      expect(() => parseRepairJobCliArgs(['--base-commit', 'HEAD main'])).toThrow(/Invalid --base-commit/);
    });
  });

  // B. Proposal Loading & Validation Tests
  test.describe('B. Proposal Loading & Validation', () => {
    test('rejects path traversal in proposal path', () => {
      expect(() => loadAndValidateProposal('../../etc/passwd', repoRoot)).toThrow(
        /Path traversal outside repository root is forbidden/
      );
    });

    test('rejects non-existent proposal file', () => {
      expect(() => loadAndValidateProposal('artifacts/non_existent.json', repoRoot)).toThrow(
        /Proposal file not found/
      );
    });

    test('rejects malformed proposal JSON', () => {
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_malformed.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, '{ not valid json');
      try {
        expect(() => loadAndValidateProposal(tempPath, repoRoot)).toThrow(/Malformed proposal JSON/);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('loads a single proposal object successfully', () => {
      const prop = makeProposal({ humanReviewStatus: 'approved' });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_single_prop.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(prop));
      try {
        const { proposal } = loadAndValidateProposal(tempPath, repoRoot);
        expect(proposal.proposalId).toBe(prop.proposalId);
        expect(proposal.humanReviewStatus).toBe('approved');
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('loads a scenario-keyed proposal dictionary successfully', () => {
      const prop = makeProposal({ humanReviewStatus: 'approved' });
      const dictionary = {
        'product-image-distortion': prop,
      };
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_dict_prop.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(dictionary));
      try {
        const { proposal } = loadAndValidateProposal(tempPath, repoRoot);
        expect(proposal.proposalId).toBe(prop.proposalId);
        expect(proposal.scenarioId).toBe('product-image-distortion');
        expect(proposal.humanReviewStatus).toBe('approved');
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('loads a proposal array and selects approved proposal', () => {
      const pendingProp = makeProposal({ proposalId: 'prop_pending_01', humanReviewStatus: 'pending_review' });
      const approvedProp = makeProposal({ proposalId: 'prop_approved_02', humanReviewStatus: 'approved' });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_array_prop.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify([pendingProp, approvedProp]));
      try {
        const { proposal } = loadAndValidateProposal(tempPath, repoRoot);
        expect(proposal.proposalId).toBe('prop_approved_02');
        expect(proposal.humanReviewStatus).toBe('approved');
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('loads from proposal run manifest wrapper object', () => {
      const prop = makeProposal({ humanReviewStatus: 'approved' });
      const manifestWrapper = {
        runId: 'run-test-manifest',
        results: {
          'product-image-distortion': prop,
        },
      };
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_manifest_prop.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(manifestWrapper));
      try {
        const { proposal } = loadAndValidateProposal(tempPath, repoRoot);
        expect(proposal.proposalId).toBe(prop.proposalId);
        expect(proposal.humanReviewStatus).toBe('approved');
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('rejects empty object or dictionary with invalid proposal values', () => {
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_empty_dict.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify({}));
      try {
        expect(() => loadAndValidateProposal(tempPath, repoRoot)).toThrow(/Invalid proposal schema/);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });
  });

  // C. Human Approval Safety Gate Tests
  test.describe('C. Human Approval Safety Gate', () => {
    test('strictly rejects proposal with humanReviewStatus="pending_review"', async () => {
      const pendingProposal = makeProposal({ humanReviewStatus: 'pending_review' });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_pending.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(pendingProposal));

      try {
        const result = await runRepairJob(['--proposal', tempPath, '--job-id', 'test-pending-job'], repoRoot);
        expect(result.success).toBe(false);
        expect(result.report.finalState).toBe('REJECTED');
        expect(result.report.approvalValidation.approved).toBe(false);
        expect(result.report.failureReason).toContain("must be 'approved' before code repair");
        expect(result.report.isolatedWorktreePath).toBe('');
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('strictly rejects proposal with humanReviewStatus="rejected"', async () => {
      const rejectedProposal = makeProposal({ humanReviewStatus: 'rejected' });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_rejected.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(rejectedProposal));

      try {
        const result = await runRepairJob(['--proposal', tempPath, '--job-id', 'test-rejected-job'], repoRoot);
        expect(result.success).toBe(false);
        expect(result.report.finalState).toBe('REJECTED');
        expect(result.report.approvalValidation.approved).toBe(false);
        expect(result.report.failureReason).toContain("must be 'approved' before code repair");
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('rejects explicit and implicit proposals after a newer diagnosis attempt fails', async () => {
      const staleProposal = makeProposal({ humanReviewStatus: 'approved' });
      const tempProposalPath = path.resolve(repoRoot, 'artifacts/temp_superseded_proposal.json');
      const diagnosisManifestPath = path.resolve(repoRoot, staleProposal.diagnosisManifestPath!);
      const statePath = path.join(path.dirname(diagnosisManifestPath), 'diagnosis-attempt.json');
      const previousState = fs.readFileSync(statePath, 'utf8');
      fs.writeFileSync(tempProposalPath, JSON.stringify(staleProposal));
      const implicitDir = path.resolve(repoRoot, 'artifacts/repair-proposals', `zz-stale-repro-${Date.now()}`);
      fs.mkdirSync(implicitDir, { recursive: true });
      fs.writeFileSync(path.join(implicitDir, 'repair_proposals.json'), JSON.stringify({ runId: staleProposal.runId, attemptId: staleProposal.attemptId, status: 'completed', results: { [staleProposal.scenarioId]: staleProposal } }));
      fs.writeFileSync(statePath, JSON.stringify({ runId: staleProposal.runId, attemptId: `attempt-newer-${Date.now()}`, status: 'failed', manifestPath: diagnosisManifestPath }));
      try {
        await expect(runRepairJob(['--proposal', tempProposalPath], repoRoot)).rejects.toThrow(/current attempt/);
        await expect(runRepairJob([], repoRoot)).rejects.toThrow(/current attempt/);
      } finally {
        fs.writeFileSync(statePath, previousState);
        fs.rmSync(tempProposalPath, { force: true });
        fs.rmSync(implicitDir, { recursive: true, force: true });
      }
    });

    test('strictly rejects unknown or unregistered patch ID', async () => {
      const approvedProposal = makeProposal({ humanReviewStatus: 'approved' });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_approved.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(approvedProposal));

      try {
        const result = await runRepairJob(
          ['--proposal', tempPath, '--job-id', 'test-bad-patch-job', '--patch', 'non-existent-patch'],
          repoRoot
        );
        expect(result.success).toBe(false);
        expect(result.report.finalState).toBe('UNSUPPORTED');
        expect(result.report.failureReason).toContain("not found in registered patch catalog");
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('strictly rejects unknown scenario with UNSUPPORTED even when AI defectCategory is valid', async () => {
      // Security check (AUD-SEC-01): Unknown scenario cannot fall back to AI category
      const unsupportedProposal = makeProposal({
        scenarioId: 'unsupported-mystery-defect',
        defectCategory: 'image_distortion', // Valid registered defect category!
        humanReviewStatus: 'approved',
      });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_unsupported_valid_cat.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(unsupportedProposal));

      try {
        const result = await runRepairJob(
          ['--proposal', tempPath, '--job-id', 'test-unsupported-scenario-job'],
          repoRoot
        );
        expect(result.success).toBe(false);
        expect(result.report.finalState).toBe('UNSUPPORTED');
        expect(result.report.failureReason).toContain(
          "No registered patch found for defect category: image_distortion (scenario: 'unsupported-mystery-defect')"
        );
        expect(result.report.isolatedWorktreePath).toBe('');
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('strictly rejects unknown scenario with UNSUPPORTED even when valid explicit CLI --patch is provided', async () => {
      // Security check (AUD-SEC-02): Unknown scenario cannot be rescued by CLI --patch
      const unsupportedProposal = makeProposal({
        scenarioId: 'unsupported-mystery-defect',
        defectCategory: 'image_distortion',
        humanReviewStatus: 'approved',
      });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_unsupported_cli_patch.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(unsupportedProposal));

      try {
        const result = await runRepairJob(
          [
            '--proposal', tempPath,
            '--job-id', 'test-unsupported-rescued-job',
            '--patch', 'patch-product-image-distortion-001',
          ],
          repoRoot
        );
        expect(result.success).toBe(false);
        expect(result.report.finalState).toBe('UNSUPPORTED');
        expect(result.report.failureReason).toContain(
          "No registered patch found for defect category: image_distortion (scenario: 'unsupported-mystery-defect')"
        );
        expect(result.report.isolatedWorktreePath).toBe('');
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('authoritatively resolves patch by scenarioId over mismatched defectCategory and logs advisory note', async () => {
      const originalConsoleError = console.error;
      const loggedErrors: string[] = [];
      console.error = (...args: any[]) => {
        loggedErrors.push(args.join(' '));
      };

      const mismatchedProposal = makeProposal({
        scenarioId: 'product-image-distortion',
        defectCategory: 'responsive_overflow', // Mismatched category!
        humanReviewStatus: 'pending_review', // Ensure safe fast rejection without spinning up worktree
      });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_mismatch_prop.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(mismatchedProposal));

      try {
        const result = await runRepairJob(
          ['--proposal', tempPath, '--job-id', 'test-mismatch-log-job'],
          repoRoot
        );
        // Human review gate rejects execution
        expect(result.success).toBe(false);
        expect(result.report.finalState).toBe('REJECTED');

        // Advisory note logged confirming authoritative resolution
        const advisoryLog = loggedErrors.find((log) =>
          log.includes("Scenario 'product-image-distortion' expected 'image_distortion'")
        );
        expect(advisoryLog).toBeDefined();
        expect(advisoryLog).toContain("proposal defectCategory was 'responsive_overflow'");
        expect(advisoryLog).toContain("Authoritatively resolved patch 'patch-product-image-distortion-001'");
      } finally {
        console.error = originalConsoleError;
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('permits explicit CLI --patch when it matches the scenario authoritative patch', async () => {
      const matchingProposal = makeProposal({
        scenarioId: 'product-image-distortion',
        defectCategory: 'image_distortion',
        humanReviewStatus: 'pending_review',
      });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_matching_patch.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(matchingProposal));

      try {
        const result = await runRepairJob(
          [
            '--proposal', tempPath,
            '--job-id', 'test-matching-patch-job',
            '--patch', 'patch-product-image-distortion-001',
          ],
          repoRoot
        );
        // Matches scenario patch, proceeds past patch validation to human review gate
        expect(result.report.finalState).toBe('REJECTED');
        expect(result.report.failureReason).toContain("must be 'approved' before code repair");
        expect(result.report.patchId).toBe('patch-product-image-distortion-001');
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('strictly rejects explicit CLI --patch when it conflicts with the scenario authoritative patch', async () => {
      // Security check (AUD-SEC-02): CLI --patch must NOT contradict scenarioId
      const proposalData = makeProposal({
        scenarioId: 'product-image-distortion',
        defectCategory: 'image_distortion',
        humanReviewStatus: 'approved',
      });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_conflicting_patch.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(proposalData));

      try {
        const result = await runRepairJob(
          [
            '--proposal', tempPath,
            '--job-id', 'test-conflict-patch-job',
            '--patch', 'patch-mobile-nav-overflow-004', // Conflicting patch!
          ],
          repoRoot
        );
        expect(result.success).toBe(false);
        expect(result.report.finalState).toBe('REJECTED');
        expect(result.report.failureReason).toContain(
          "Explicit CLI patch 'patch-mobile-nav-overflow-004' conflicts with authoritative scenario 'product-image-distortion' patch 'patch-product-image-distortion-001'"
        );
        expect(result.report.isolatedWorktreePath).toBe('');
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    test('rejects legacy executable proposals without a canonical scenarioId', async () => {
      const originalConsoleError = console.error;
      const loggedErrors: string[] = [];
      console.error = (...args: any[]) => {
        loggedErrors.push(args.join(' '));
      };

      // Proposal genuinely lacking scenarioId
      const legacyProposal = makeProposal({
        scenarioId: '',
        defectCategory: 'image_distortion',
        humanReviewStatus: 'pending_review',
      });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_legacy_missing_scenario.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(legacyProposal));

      try {
        await expect(runRepairJob(
          ['--proposal', tempPath, '--job-id', 'test-legacy-fallback-job'],
          repoRoot
        )).rejects.toThrow('canonical scenarioId');
      } finally {
        console.error = originalConsoleError;
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });
  });

  // D. End-to-End Execution with Approved Proposal
  test.describe('D. Approved Proposal Execution in Isolated Worktree', () => {
    test('executes approved proposal end-to-end, performs visual validation, cleans worktree, and returns exit report', async () => {
      const approvedProposal = makeProposal({ humanReviewStatus: 'approved' });
      const tempPath = path.resolve(repoRoot, 'artifacts/temp_approved_exec.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(approvedProposal));

      const jobId = `cli-exec-test-${Date.now()}`;
      try {
        const result = await runRepairJob(
          ['--proposal', tempPath, '--job-id', jobId, '--base-commit', 'HEAD'],
          repoRoot
        );

        expect(result.success).toBe(true);
        expect(result.report.finalState).toBe('PASSED');
        expect(result.report.approvalValidation.approved).toBe(true);
        expect(result.report.patchApplication?.appliedSuccessfully).toBe(true);
        expect(result.report.buildExecution?.passed).toBe(true);
        expect(result.report.visualValidation?.passed).toBe(true);
        expect(result.report.cleanupStatus.cleaned).toBe(true);
        expect(result.report.cleanupStatus.worktreeRemoved).toBe(true);

        // Verify report file was saved to disk
        expect(fs.existsSync(result.reportPath)).toBe(true);
        const savedReport = JSON.parse(fs.readFileSync(result.reportPath, 'utf-8'));
        expect(savedReport.jobId).toBe(jobId);
        expect(savedReport.finalState).toBe('PASSED');
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        // Clean up execution test report folder
        const reportDir = path.resolve(repoRoot, 'artifacts', 'repair-executions', jobId);
        if (fs.existsSync(reportDir)) {
          fs.rmSync(reportDir, { recursive: true, force: true });
        }
        await (new WorktreeManager(repoRoot)).cleanupWorktree(jobId);
      }
    });

    test('executes approved proposal generated by RepairProposalService without manual test alteration', async () => {
      // Allocate generous timeout for worktree creation, build, Playwright test execution, and cleanup
      test.setTimeout(90000);
      const { RepairProposalService } = await import('../scripts/vlm/repair-proposal-service');
      const service = new RepairProposalService({ isMock: true });

      const mockDiagnosis: any = {
        scenarioId: 'product-image-distortion',
        status: 'diagnosed',
        model: 'mock-vlm-v1',
        provider: 'mock',
        diagnosis: {
          schema_version: '1.0',
          summary: 'Product thumbnail image distortion detected',
          defects: [
            {
              id: 'def-1',
              category: 'image_distortion',
              severity: 'medium',
              confidence: 0.95,
              description: 'Product image is distorted',
              evidence: ['Aspect ratio distortion'],
              suspected_cause: 'object-fit: fill with distorting scale transform',
              suggested_fix: 'object-fit: cover',
              affected_element: { description: 'Product image', selector: '.product-image' },
            },
          ],
        },
      };

      // Generate through the authoritative manifest path so the proposal has
      // verifiable run and attempt provenance at execution time.
      const runId = `run-generated-proposal-${crypto.randomUUID()}`;
      const attemptId = `attempt-generated-${crypto.randomUUID()}`;
      const diagnosisDir = path.resolve(repoRoot, 'artifacts', 'visual-evidence', runId, 'diagnoses');
      const diagnosisManifestPath = path.join(diagnosisDir, 'diagnoses-manifest.json');
      proposalFixtureDirs.push(path.dirname(diagnosisDir));
      fs.mkdirSync(diagnosisDir, { recursive: true });
      fs.writeFileSync(diagnosisManifestPath, JSON.stringify({
        runId, attemptId, status: 'completed', timestamp: new Date().toISOString(),
        provider: 'mock', model: 'mock-vlm-v1', scenariosDiagnosed: 1, totalScenarios: 1,
        results: { [mockDiagnosis.scenarioId]: { ...mockDiagnosis, diagnosis: { ...mockDiagnosis.diagnosis, status: 'diagnosed', limitations: [] } } }, scenarioAliases: [],
        outputArtifactsDirectory: diagnosisDir,
      }));
      fs.writeFileSync(path.join(diagnosisDir, 'diagnosis-attempt.json'), JSON.stringify({
        runId, attemptId, status: 'completed', manifestPath: path.resolve(diagnosisManifestPath),
      }));
      const proposalRun = service.generateProposalsForRun(diagnosisManifestPath, undefined, runId);
      const generated = proposalRun.results[mockDiagnosis.scenarioId];
      expect(generated.requiredValidationTests).not.toContain('tests/defect-injection.spec.ts');
      expect(generated.requiredValidationTests).toContain('tests/responsive.spec.ts');

      // 2. Grant explicit human approval
      const approved = {
        ...generated,
        humanReviewStatus: 'approved' as const,
        reviewedBy: 'qa-engineer@omnisight.ai',
        reviewedAt: new Date().toISOString(),
        reviewNotes: 'Authorized for execution',
      };
      approved.approvalDigest = approved.proposalDigest;

      const tempPath = path.resolve(repoRoot, 'artifacts/temp_gen_approved.json');
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(approved));

      const jobId = `gen-exec-test-${Date.now()}`;
      try {
        const result = await runRepairJob(
          ['--proposal', tempPath, '--job-id', jobId, '--base-commit', 'HEAD'],
          repoRoot
        );

        expect(result.success).toBe(true);
        expect(result.report.finalState).toBe('PASSED');
        expect(result.report.approvalValidation.approved).toBe(true);
        expect(result.report.buildExecution?.passed).toBe(true);
        expect(result.report.testExecution?.passed).toBe(true);
        expect(result.report.visualValidation?.passed).toBe(true);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        const reportDir = path.resolve(repoRoot, 'artifacts', 'repair-executions', jobId);
        if (fs.existsSync(reportDir)) {
          fs.rmSync(reportDir, { recursive: true, force: true });
        }
        await (new WorktreeManager(repoRoot)).cleanupWorktree(jobId);
      }
    });
  });
});
