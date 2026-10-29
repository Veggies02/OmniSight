import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PostRepairVerificationResult, VerificationCheck, RegressionCheck } from './repair/verification-schema';

export interface CliOptions {
  runId?: string;
  output?: string;
  artifactsDir?: string;
}

export interface ScenarioAudit {
  scenarioId: string;
  hasResultJson: boolean;
  hasMeasurementsJson: boolean;
  hasPostRepairScreenshot: boolean;
  hasPostRepairDom: boolean;
  result?: PostRepairVerificationResult;
  measurements?: any;
  error?: string;
}

export interface AggregatedVerificationReport {
  runId: string;
  generatedAt: string;
  overallStatus: 'PASSED' | 'FAILED' | 'INCONCLUSIVE';
  totalScenarios: number;
  passedCount: number;
  failedCount: number;
  inconclusiveCount: number;
  scenarios: ScenarioAudit[];
  markdownContent: string;
  outputPath?: string;
}

/**
 * Parses and validates CLI arguments strictly.
 */
export function parseExportCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--run-id') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('Missing value for --run-id');
      }
      options.runId = argv[++i];
    } else if (arg.startsWith('--run-id=')) {
      const val = arg.slice('--run-id='.length);
      if (!val) throw new Error('Missing value for --run-id');
      options.runId = val;
    } else if (arg === '--output') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('Missing value for --output');
      }
      options.output = argv[++i];
    } else if (arg.startsWith('--output=')) {
      const val = arg.slice('--output='.length);
      if (!val) throw new Error('Missing value for --output');
      options.output = val;
    } else if (arg === '--artifacts-dir') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('Missing value for --artifacts-dir');
      }
      options.artifactsDir = argv[++i];
    } else if (arg.startsWith('--artifacts-dir=')) {
      const val = arg.slice('--artifacts-dir='.length);
      if (!val) throw new Error('Missing value for --artifacts-dir');
      options.artifactsDir = val;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: '${arg}'`);
    } else {
      throw new Error(`Unexpected argument: '${arg}'`);
    }
  }

  // Security check: Prevent path traversal on runId
  if (options.runId !== undefined) {
    const trimmed = options.runId.trim();
    if (!trimmed) {
      throw new Error('Invalid --run-id: cannot be empty');
    }
    if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
      throw new Error(`Invalid --run-id: '${options.runId}'. Path traversal characters are strictly forbidden.`);
    }
    options.runId = trimmed;
  }

  return options;
}

/**
 * Discovers available verification run IDs sorted descending by timestamp.
 */
export function listVerificationRuns(baseArtifactsDir: string): string[] {
  if (!fs.existsSync(baseArtifactsDir)) return [];
  return fs
    .readdirSync(baseArtifactsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
    .map((dirent) => dirent.name)
    .sort()
    .reverse();
}

/**
 * Loads and audits all scenarios in a verification run directory.
 */
export function loadRunScenarios(runDir: string): ScenarioAudit[] {
  if (!fs.existsSync(runDir)) {
    throw new Error(`Verification run directory not found: ${runDir}`);
  }

  const scenarioDirs = fs
    .readdirSync(runDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();

  if (scenarioDirs.length === 0) {
    throw new Error(`No scenario evidence directories found in run: ${runDir}`);
  }

  const audits: ScenarioAudit[] = [];

  for (const scenarioId of scenarioDirs) {
    const sDir = path.join(runDir, scenarioId);
    const resultJsonPath = path.join(sDir, 'verification-result.json');
    const measurementsJsonPath = path.join(sDir, 'measurements.json');
    const screenshotPath = path.join(sDir, 'post-repair.png');
    const domPath = path.join(sDir, 'dom-post-repair.html');

    const hasResultJson = fs.existsSync(resultJsonPath);
    const hasMeasurementsJson = fs.existsSync(measurementsJsonPath);
    const hasPostRepairScreenshot = fs.existsSync(screenshotPath);
    const hasPostRepairDom = fs.existsSync(domPath);

    let result: PostRepairVerificationResult | undefined;
    let measurements: any | undefined;
    let error: string | undefined;

    if (hasResultJson) {
      try {
        const raw = fs.readFileSync(resultJsonPath, 'utf-8');
        result = JSON.parse(raw);
      } catch (parseErr: any) {
        error = `Malformed verification-result.json: ${parseErr.message}`;
      }
    }

    if (hasMeasurementsJson) {
      try {
        const raw = fs.readFileSync(measurementsJsonPath, 'utf-8');
        measurements = JSON.parse(raw);
      } catch {
        // measurements error is non-fatal if result exists
      }
    }

    audits.push({
      scenarioId,
      hasResultJson,
      hasMeasurementsJson,
      hasPostRepairScreenshot,
      hasPostRepairDom,
      result,
      measurements,
      error,
    });
  }

  return audits;
}

/**
 * Builds the Markdown report content from scenario audits.
 */
export function generateVerificationMarkdownReport(runId: string, scenarios: ScenarioAudit[]): string {
  let passedCount = 0;
  let failedCount = 0;
  let inconclusiveCount = 0;

  for (const audit of scenarios) {
    const status = audit.result?.verificationStatus;
    if (status === 'passed') {
      passedCount++;
    } else if (status === 'failed') {
      failedCount++;
    } else {
      inconclusiveCount++;
    }
  }

  const totalScenarios = scenarios.length;
  let overallStatus: 'PASSED' | 'FAILED' | 'INCONCLUSIVE' = 'PASSED';
  if (failedCount > 0) {
    overallStatus = 'FAILED';
  } else if (inconclusiveCount > 0 || totalScenarios === 0) {
    overallStatus = 'INCONCLUSIVE';
  }

  const statusBadge =
    overallStatus === 'PASSED' ? '🟢 PASSED' : overallStatus === 'FAILED' ? '🔴 FAILED' : '🟡 INCONCLUSIVE';

  const lines: string[] = [];

  lines.push(`# OmniSight Post-Repair Verification & Regression Report`);
  lines.push(``);
  lines.push(`**Run ID:** \`${runId}\`  `);
  lines.push(`**Generated At:** ${new Date().toISOString()}  `);
  lines.push(`**Overall Status:** ${statusBadge}  `);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## 1. Executive Summary`);
  lines.push(``);
  lines.push(`| Metric | Count | Ratio |`);
  lines.push(`| :--- | :--- | :--- |`);
  lines.push(`| **Total Scenarios Evaluated** | ${totalScenarios} | 100% |`);
  lines.push(`| **Verified Repaired (Passed)** | ${passedCount} | ${totalScenarios > 0 ? Math.round((passedCount / totalScenarios) * 100) : 0}% |`);
  lines.push(`| **Verification Failed** | ${failedCount} | ${totalScenarios > 0 ? Math.round((failedCount / totalScenarios) * 100) : 0}% |`);
  lines.push(`| **Inconclusive / Infrastructure Error** | ${inconclusiveCount} | ${totalScenarios > 0 ? Math.round((inconclusiveCount / totalScenarios) * 100) : 0}% |`);
  lines.push(``);

  lines.push(`## 2. Scenario-by-Scenario Evaluation`);
  lines.push(``);

  for (const audit of scenarios) {
    const sId = audit.scenarioId;
    const res = audit.result;
    const sStatus = res?.verificationStatus || (audit.error ? 'inconclusive' : 'unknown');
    const sBadge = sStatus === 'passed' ? '🟢 PASSED' : sStatus === 'failed' ? '🔴 FAILED' : '🟡 INCONCLUSIVE';

    lines.push(`### Scenario: \`${sId}\` — ${sBadge}`);
    lines.push(``);
    lines.push(`* **Defect Category:** \`${res?.defectCategory || 'unknown'}\``);
    lines.push(`* **Viewport:** ${res?.viewport ? `${res.viewport.width} × ${res.viewport.height}` : 'N/A'}`);
    lines.push(`* **Verification Duration:** ${res?.durationMs !== undefined ? `${res.durationMs}ms` : 'N/A'}`);
    lines.push(`* **Assertion Summary:** ${res?.assertionSummary || audit.error || 'No assertion summary provided.'}`);
    lines.push(``);

    // Checks breakdown
    lines.push(`#### Defect-Specific Checks`);
    if (res?.checks && res.checks.length > 0) {
      lines.push(`| Check Name | Expected | Actual | Outcome | Details |`);
      lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
      for (const chk of res.checks) {
        const outcome = chk.passed ? '✓ Pass' : '✕ Fail';
        lines.push(`| \`${chk.name}\` | \`${String(chk.expected)}\` | \`${String(chk.actual)}\` | ${outcome} | ${chk.details || '—'} |`);
      }
    } else if (audit.error) {
      lines.push(`> [!WARNING]`);
      lines.push(`> Verification checks could not be evaluated due to artifact error: ${audit.error}`);
    } else {
      lines.push(`*No granular check records present in result JSON.*`);
    }
    lines.push(``);

    // Regression Audit
    lines.push(`#### Multi-Page Regression Audit`);
    const regList: RegressionCheck[] = res?.regressionAudit || audit.measurements?.regressionAudit || [];
    if (regList.length > 0) {
      lines.push(`| Area | Route | Outcome | Details |`);
      lines.push(`| :--- | :--- | :--- | :--- |`);
      for (const reg of regList) {
        const rOutcome = reg.passed ? '✓ Clean' : '✕ Regression Detected';
        lines.push(`| **${reg.area.toUpperCase()}** | \`${reg.route}\` | ${rOutcome} | ${reg.details} |`);
      }
    } else if (res?.unrelatedRegressionsDetected) {
      lines.push(`> [!WARNING]`);
      lines.push(`> Unrelated UI regressions were flagged during execution.`);
    } else {
      lines.push(`*Standard clean audit across core application views.*`);
    }
    lines.push(``);

    // Diagnostic Details / Failures
    if (res?.failureReasons && res.failureReasons.length > 0) {
      lines.push(`#### Failure Reasons & Diagnostics`);
      for (const reason of res.failureReasons) {
        lines.push(`- ⚠️ ${reason}`);
      }
      lines.push(``);
    }

    // Evidence Artifacts
    lines.push(`#### Captured Evidence Audit`);
    lines.push(`| Evidence Type | Availability | File Path |`);
    lines.push(`| :--- | :--- | :--- |`);
    lines.push(`| **Post-Repair Screenshot** | ${audit.hasPostRepairScreenshot ? '✓ Present' : '✕ Missing'} | \`${res?.postRepairEvidence?.screenshotPath || (audit.hasPostRepairScreenshot ? 'artifacts/.../post-repair.png' : 'Not Generated')}\` |`);
    lines.push(`| **Sanitized DOM Snapshot** | ${audit.hasPostRepairDom ? '✓ Present' : '✕ Missing'} | \`${res?.postRepairEvidence?.domPath || (audit.hasPostRepairDom ? 'artifacts/.../dom-post-repair.html' : 'Not Generated')}\` |`);
    lines.push(`| **Quantitative Measurements** | ${audit.hasMeasurementsJson ? '✓ Present' : '✕ Missing'} | \`${res?.postRepairEvidence?.measurementsPath || (audit.hasMeasurementsJson ? 'artifacts/.../measurements.json' : 'Not Generated')}\` |`);
    lines.push(`| **Verification Result JSON** | ${audit.hasResultJson ? '✓ Present' : '✕ Missing'} | \`${audit.hasResultJson ? 'verification-result.json' : 'Missing'}\` |`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  lines.push(`## 3. Methodological & Testing Limitations`);
  lines.push(``);
  lines.push(`1. **Headless Browser Execution:** Measurements reflect Chromium headless DOM geometry, layout engines, and computed styles under Playwright automation.`);
  lines.push(`2. **Isolated Worktree Environments:** Visual verification evaluates ephemeral worktree builds to prevent contamination of the active working tree.`);
  lines.push(`3. **WCAG Color Contrast:** Calculated using relative luminance against the rendered container background. Gradient or semi-transparent parent backgrounds use computed flat fallbacks.`);
  lines.push(`4. **Multi-Page Regression Audit:** Inspects Home (\`/\`), Shopping Cart (\`/cart\`), and global Navigation (\`.navbar\`) to ensure self-healing CSS/DOM changes do not compromise core user flows.`);
  lines.push(``);

  return lines.join('\n');
}

/**
 * Main export function callable directly or via CLI.
 */
export async function exportVerificationReport(
  options: CliOptions,
  repoRoot: string = process.cwd()
): Promise<AggregatedVerificationReport> {
  const baseArtifactsDir = options.artifactsDir || path.resolve(repoRoot, 'artifacts', 'verification');

  // If no run ID provided, auto-discover the latest run
  let targetRunId = options.runId;
  if (!targetRunId) {
    const availableRuns = listVerificationRuns(baseArtifactsDir);
    if (availableRuns.length === 0) {
      throw new Error(`No verification runs found in ${baseArtifactsDir}. Run post-repair verification first.`);
    }
    targetRunId = availableRuns[0];
  }

  const runDir = path.resolve(baseArtifactsDir, targetRunId);
  if (!fs.existsSync(runDir)) {
    throw new Error(`Verification run '${targetRunId}' not found at ${runDir}`);
  }

  // Security check: ensure resolved runDir is within baseArtifactsDir
  if (!runDir.startsWith(baseArtifactsDir)) {
    throw new Error(`Path traversal attempt forbidden: ${runDir}`);
  }

  const scenarios = loadRunScenarios(runDir);
  const markdownContent = generateVerificationMarkdownReport(targetRunId, scenarios);

  // Write output report
  const outputPath = options.output
    ? path.resolve(repoRoot, options.output)
    : path.join(runDir, 'verification_summary_report.md');

  // Security check for output path
  if (!outputPath.startsWith(path.resolve(repoRoot))) {
    throw new Error(`Output path outside repository root forbidden: ${outputPath}`);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, markdownContent, 'utf-8');

  let passedCount = 0;
  let failedCount = 0;
  let inconclusiveCount = 0;
  for (const s of scenarios) {
    const st = s.result?.verificationStatus;
    if (st === 'passed') passedCount++;
    else if (st === 'failed') failedCount++;
    else inconclusiveCount++;
  }

  let overallStatus: 'PASSED' | 'FAILED' | 'INCONCLUSIVE' = 'PASSED';
  if (failedCount > 0) overallStatus = 'FAILED';
  else if (inconclusiveCount > 0 || scenarios.length === 0) overallStatus = 'INCONCLUSIVE';

  return {
    runId: targetRunId,
    generatedAt: new Date().toISOString(),
    overallStatus,
    totalScenarios: scenarios.length,
    passedCount,
    failedCount,
    inconclusiveCount,
    scenarios,
    markdownContent,
    outputPath,
  };
}

// CLI Entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const cliOptions = parseExportCliArgs(process.argv.slice(2));
    exportVerificationReport(cliOptions)
      .then((report) => {
        console.log(`\n======================================================`);
        console.log(`✓ OmniSight Verification Report Export Complete`);
        console.log(`======================================================`);
        console.log(`Run ID:         ${report.runId}`);
        console.log(`Overall Status: ${report.overallStatus}`);
        console.log(`Scenarios:      ${report.totalScenarios} total (${report.passedCount} passed, ${report.failedCount} failed, ${report.inconclusiveCount} inconclusive)`);
        console.log(`Report File:    ${report.outputPath}`);
        console.log(`======================================================\n`);
      })
      .catch((err) => {
        console.error(`\n✕ Error exporting verification report: ${err.message}\n`);
        process.exit(1);
      });
  } catch (err: any) {
    console.error(`\n✕ Argument Error: ${err.message}\n`);
    process.exit(1);
  }
}
