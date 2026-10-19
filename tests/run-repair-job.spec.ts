import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  parseRepairJobCliArgs,
  loadAndValidateProposal,
  runRepairJob,
} from '../scripts/run-repair-job';
import { computeFileHash } from '../scripts/vlm/source-path-security';

test.describe('Step 4.6 run-repair-job CLI & Contract Validation Tests', () => {
  const repoRoot = process.cwd();
  const validCssPath = path.resolve(repoRoot, 'src/index.css');
  const validHash = computeFileHash(validCssPath);

  // Helper fixture for a valid approved proposal
  const makeProposal = (overrides: Record<string, any> = {}) => ({
    schemaVersion: '1.0',
    proposalId: `prop_test_${Date.now()}`,
    scenarioId: 'product-image-distortion',
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
        expect(result.report.finalState).toBe('REJECTED');
        expect(result.report.failureReason).toContain("not found in registered patch catalog");
      } finally {
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
      }
    });
  });
});
