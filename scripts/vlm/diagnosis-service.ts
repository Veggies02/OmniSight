import fs from "fs";
import path from "path";
import {
  type DiagnosisResult,
  type StructuredDiagnosis,
} from "./diagnosis-schema";
import {
  assertNoGroundTruthLeakage,
  createNeutralScenarioAlias,
  sanitizeDomForVlm,
  sanitizeUrlOrRoute,
} from "./evidence-sanitizer";
import {
  createVlmProvider,
  STANDARD_VLM_PROMPT,
  VlmProviderError,
  type ProviderConfig,
  type VlmProvider,
} from "./vlm-provider";
import { acquireDiagnosisLock } from "./diagnosis-attempt-lock";
import { type DiagnosisScenarioAlias } from "./diagnosis-manifest";

export interface DiagnosisPipelineOptions {
  runId?: string;
  runDirectory?: string;
  scenarioId?: string;
  providerConfig?: ProviderConfig;
  outputDirectory?: string;
}

export interface DiagnosisRunManifest {
  runId: string;
  attemptId: string;
  status: "completed" | "failed";
  timestamp: string;
  provider: string;
  model: string;
  scenariosDiagnosed: number;
  totalScenarios: number;
  results: Record<string, DiagnosisResult>;
  scenarioAliases: DiagnosisScenarioAlias[];
  outputArtifactsDirectory: string;
}

/**
 * Core Diagnosis Service executing blind VLM evaluation across captured evidence.
 */
export class DiagnosisService {
  private provider: VlmProvider;

  constructor(providerConfig: ProviderConfig = {}) {
    this.provider = createVlmProvider(providerConfig);
  }

  /**
   * Diagnoses a single scenario from a run directory without revealing ground-truth labels.
   */
  public async diagnoseScenario(
    runDir: string,
    scenarioEntry: any,
    scenarioIndex: number
  ): Promise<DiagnosisResult> {
    const startTime = Date.now();
    const scenarioId = scenarioEntry.scenarioId;
    const neutralAlias = createNeutralScenarioAlias(scenarioIndex);

    // 1. Resolve paths
    const baselineImgPath = path.join(runDir, scenarioEntry.baselineScreenshot);
    const defectiveImgPath = path.join(runDir, scenarioEntry.defectiveScreenshot);
    const baselineDomPath = path.join(runDir, scenarioEntry.baselineDom);
    const defectiveDomPath = path.join(runDir, scenarioEntry.defectiveDom);

    if (!fs.existsSync(baselineImgPath) || !fs.existsSync(defectiveImgPath)) {
      throw new Error(`Screenshot artifacts not found for scenario '${scenarioId}' in '${runDir}'.`);
    }

    // 2. Read images and convert to base64
    const baselineImgBase64 = fs.readFileSync(baselineImgPath).toString("base64");
    const defectiveImgBase64 = fs.readFileSync(defectiveImgPath).toString("base64");

    // 3. Read and sanitize DOM snapshots
    let baselineDomExcerpt = "";
    let defectiveDomExcerpt = "";
    if (fs.existsSync(baselineDomPath)) {
      baselineDomExcerpt = sanitizeDomForVlm(fs.readFileSync(baselineDomPath, "utf8"));
    }
    if (fs.existsSync(defectiveDomPath)) {
      defectiveDomExcerpt = sanitizeDomForVlm(fs.readFileSync(defectiveDomPath, "utf8"));
    }

    // 4. Also inspect sanitized layout delta from measurements if available (neutralized)
    let layoutHints = "";
    let measurementsPath = path.join(runDir, scenarioId, "measurements.json");
    if (!fs.existsSync(measurementsPath) && scenarioEntry.baselineScreenshot) {
      measurementsPath = path.join(runDir, path.dirname(scenarioEntry.baselineScreenshot), "measurements.json");
    }
    if (fs.existsSync(measurementsPath)) {
      try {
        const rawM = JSON.parse(fs.readFileSync(measurementsPath, "utf8"));
        // Neutralize: extract only raw numbers without defect tags
        layoutHints = JSON.stringify(
          {
            viewport: rawM.baseline?.viewport,
            baselineDocument: rawM.baseline?.documentMetrics,
            testDocument: rawM.defective?.documentMetrics,
            testComputedStyles: rawM.defective?.computedStyles,
          },
          null,
          2
        );
      } catch {
        // Ignore optional hints
      }
    }

    const cleanRoute = sanitizeUrlOrRoute(scenarioEntry.route);

    // 5. Build neutral model prompt
    const neutralPrompt = `
${STANDARD_VLM_PROMPT}

EVIDENCE METADATA:
- Inspection Scenario Alias: ${neutralAlias}
- Target Route: ${cleanRoute}
- Viewport: ${scenarioEntry.viewport.width} x ${scenarioEntry.viewport.height}
- Page Title: ${scenarioEntry.pageTitle}
- Client Console Errors: Baseline [${scenarioEntry.consoleErrors.baseline.length}], Test [${scenarioEntry.consoleErrors.defective.length}]

TECHNICAL CONTEXT & COMPUTED METRICS:
${layoutHints || "Standard web rendering."}

SANITIZED TEST DOM EXCERPT:
${defectiveDomExcerpt.substring(0, 2000)}

DIAGNOSIS INSTRUCTIONS:
Carefully compare the baseline and test images provided, correlate with the layout metrics and DOM excerpt, and output the structured JSON diagnosis.
`;

    // 6. Strict Leakage Verification across evidence components (including pageTitle)
    assertNoGroundTruthLeakage(defectiveDomExcerpt);
    if (baselineDomExcerpt) assertNoGroundTruthLeakage(baselineDomExcerpt);
    if (layoutHints) assertNoGroundTruthLeakage(layoutHints);
    assertNoGroundTruthLeakage(cleanRoute);
    if (scenarioEntry.pageTitle) assertNoGroundTruthLeakage(scenarioEntry.pageTitle);

    // 7. Call VLM Provider
    let diagnosis: StructuredDiagnosis;
    let errorMessage: string | undefined;
    let errorCode: string | undefined;

    try {
      diagnosis = await this.provider.diagnose({
        prompt: neutralPrompt,
        baselineImageBase64: baselineImgBase64,
        defectiveImageBase64: defectiveImgBase64,
      });
    } catch (err: any) {
      const safeError = safeErrorDetails(err);
      errorMessage = safeError.message;
      errorCode = safeError.code;
      diagnosis = {
        schema_version: "1.0",
        status: "error",
        summary: `Diagnosis failed due to provider error: ${errorMessage}`,
        defects: [],
        limitations: [`Error: ${errorMessage}`],
      };
    }

    const executionTimeMs = Date.now() - startTime;

    return {
      scenarioId,
      status: diagnosis.status,
      diagnosis,
      model: this.provider.model,
      provider: this.provider.name,
      executionTimeMs,
      sanitizedEvidenceRef: {
        baselineScreenshot: scenarioEntry.baselineScreenshot,
        defectiveScreenshot: scenarioEntry.defectiveScreenshot,
        viewport: scenarioEntry.viewport,
      },
      error: errorMessage,
      errorCode,
    };
  }

  /**
   * Runs diagnosis over an entire evidence run or specified scenario.
   */
  public async diagnoseRun(options: DiagnosisPipelineOptions = {}): Promise<DiagnosisRunManifest> {
    const evidenceBaseDir = path.resolve(process.cwd(), "artifacts/visual-evidence");
    let targetRunDir = options.runDirectory;

    if (!targetRunDir) {
      if (options.runId) {
        targetRunDir = path.join(evidenceBaseDir, options.runId);
      } else {
        // Find most recent run directory
        if (!fs.existsSync(evidenceBaseDir)) {
          throw new Error(`Evidence artifacts base directory '${evidenceBaseDir}' does not exist.`);
        }
        const runs = fs
          .readdirSync(evidenceBaseDir)
          .filter((d) => d.startsWith("run-") && fs.statSync(path.join(evidenceBaseDir, d)).isDirectory())
          .sort()
          .reverse();

        if (runs.length === 0) {
          throw new Error("No previous evidence runs found in 'artifacts/visual-evidence/'. Run 'npm run capture:evidence' first.");
        }
        targetRunDir = path.join(evidenceBaseDir, runs[0]);
      }
    }

    targetRunDir = path.resolve(targetRunDir);
    const outputDir = path.resolve(options.outputDirectory || path.join(targetRunDir, "diagnoses"));
    const lock = acquireDiagnosisLock(outputDir);
    try {
    // Invalidate the previous published result before touching the new input. Even a
    // missing or malformed evidence manifest must make the prior result unusable.
    fs.mkdirSync(outputDir, { recursive: true });
    const attemptId = lock.attemptId;
    const attemptsDir = path.join(outputDir, "attempts");
    const attemptDir = path.join(attemptsDir, attemptId);
    fs.mkdirSync(attemptDir, { recursive: true });
    const statePath = path.join(outputDir, "diagnosis-attempt.json");
    let state = { runId: options.runId || "__pending__", attemptId, status: "running" as const, updatedAt: new Date().toISOString() };
    const stateTemp = `${statePath}.${attemptId}.tmp`;
    fs.writeFileSync(stateTemp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(stateTemp, statePath);
    const markAttemptFailed = () => {
      lock.assertOwned();
      const failedState = { ...state, status: "failed", updatedAt: new Date().toISOString() };
      fs.writeFileSync(stateTemp, JSON.stringify(failedState, null, 2), "utf8");
      fs.renameSync(stateTemp, statePath);
    };

    const modelEvidencePath = path.join(targetRunDir, "model_facing_evidence.json");
    if (!fs.existsSync(modelEvidencePath)) {
      markAttemptFailed();
      throw new Error(`Model-facing evidence manifest '${modelEvidencePath}' was not found.`);
    }

    let modelEvidence: any;
    try {
      modelEvidence = JSON.parse(fs.readFileSync(modelEvidencePath, "utf8"));
    } catch {
      markAttemptFailed();
      throw new Error(`Model-facing evidence manifest is not valid JSON: '${modelEvidencePath}'.`);
    }
    if (typeof modelEvidence.runId !== "string" || !modelEvidence.runId.trim()) {
      markAttemptFailed();
      throw new Error("Model-facing evidence is missing a valid runId.");
    }
    if (options.runId && options.runId !== modelEvidence.runId) {
      markAttemptFailed();
      throw new Error(`Requested run ID '${options.runId}' does not match evidence run ID '${modelEvidence.runId}'.`);
    }
    if (!Array.isArray(modelEvidence.scenarios) || modelEvidence.scenarios.length === 0) {
      markAttemptFailed();
      throw new Error("Model-facing evidence has no diagnosis scenarios.");
    }
    state = { ...state, runId: modelEvidence.runId };
    fs.writeFileSync(stateTemp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(stateTemp, statePath);

    // Read internal orchestration manifest if present to maintain correlation for evaluation
    const internalManifestPath = path.join(targetRunDir, "manifest.json");
    let internalManifest: any = null;
    try {
      internalManifest = fs.existsSync(internalManifestPath)
        ? JSON.parse(fs.readFileSync(internalManifestPath, "utf8"))
        : null;
    } catch {
      markAttemptFailed();
      throw new Error("Internal evidence manifest is not valid JSON.");
    }
    const internalScenarioIds = internalManifest?.scenarios ? Object.keys(internalManifest.scenarios) : [];

    const manifest: DiagnosisRunManifest = {
      runId: modelEvidence.runId,
      attemptId,
      status: "completed",
      timestamp: new Date().toISOString(),
      provider: this.provider.name,
      model: this.provider.model,
      scenariosDiagnosed: 0,
      totalScenarios: options.scenarioId
        ? modelEvidence.scenarios.filter((scenario: any) => scenario.scenarioId === options.scenarioId).length
        : modelEvidence.scenarios.length,
      results: {},
      scenarioAliases: [],
      outputArtifactsDirectory: outputDir,
    };
    if (manifest.totalScenarios === 0) {
      markAttemptFailed();
      throw new Error(`Scenario '${options.scenarioId}' was not found in run '${modelEvidence.runId}'.`);
    }

    let scenarioIndex = 0;
    const canonicalIds = new Set<string>();
    for (const [evidenceIndex, scenario] of modelEvidence.scenarios.entries()) {
      if (options.scenarioId && scenario.scenarioId !== options.scenarioId) {
        continue;
      }

      console.log(`Diagnosing scenario '${scenario.scenarioId}' using ${this.provider.name} (${this.provider.model})...`);
      const currentIdx = scenarioIndex++;
      const internalId = internalScenarioIds[evidenceIndex];
      const canonicalScenarioId = internalId || scenario.scenarioId;
      if (typeof canonicalScenarioId !== "string" || !canonicalScenarioId.trim() || canonicalIds.has(canonicalScenarioId)) {
        markAttemptFailed();
        throw new Error("Evidence contains duplicate or invalid canonical scenario identities.");
      }
      canonicalIds.add(canonicalScenarioId);
      let result: DiagnosisResult;
      try {
        result = await this.diagnoseScenario(targetRunDir, scenario, currentIdx);
      } catch (error: any) {
        const safeError = safeErrorDetails(error);
        result = {
          scenarioId: scenario.scenarioId,
          status: "error",
          diagnosis: { schema_version: "1.0", status: "error", summary: "Diagnosis analysis failed.", defects: [], limitations: [safeError.code] },
          model: this.provider.model,
          provider: this.provider.name,
          executionTimeMs: 0,
          sanitizedEvidenceRef: { baselineScreenshot: scenario.baselineScreenshot, defectiveScreenshot: scenario.defectiveScreenshot, viewport: scenario.viewport },
          error: safeError.message,
          errorCode: safeError.code,
        };
      }
      result.scenarioId = canonicalScenarioId;
      manifest.results[canonicalScenarioId] = result;
      if (canonicalScenarioId !== scenario.scenarioId) {
        manifest.scenarioAliases.push({ alias: scenario.scenarioId, canonicalScenarioId });
      }
      manifest.scenariosDiagnosed++;

      // Save individual scenario diagnosis artifact
      lock.assertOwned();
      const scenarioOutputPath = path.join(attemptDir, `${canonicalScenarioId}-diagnosis.json`);
      fs.writeFileSync(scenarioOutputPath, JSON.stringify(result, null, 2), "utf8");
    }

    const failures = Object.values(manifest.results).filter((result) => result.status === "error" || result.diagnosis.status === "error");
    if (manifest.scenariosDiagnosed !== manifest.totalScenarios || failures.length > 0) {
      manifest.status = "failed";
      const attemptManifestPath = path.join(attemptDir, "diagnoses-manifest.json");
      fs.writeFileSync(attemptManifestPath, JSON.stringify(manifest, null, 2), "utf8");
      const failedState = { ...state, status: "failed", manifestPath: attemptManifestPath, updatedAt: new Date().toISOString() };
      const failedStateTemp = `${statePath}.${attemptId}.tmp`;
      fs.writeFileSync(failedStateTemp, JSON.stringify(failedState, null, 2), "utf8");
      fs.renameSync(failedStateTemp, statePath);
      throw new Error(`Diagnosis attempt ${attemptId} failed for ${failures.length} scenario(s); no completed manifest was published.`);
    }

    const attemptManifestPath = path.join(attemptDir, "diagnoses-manifest.json");
    fs.writeFileSync(attemptManifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const publishedPath = path.join(outputDir, "diagnoses-manifest.json");
    const publishedTemp = `${publishedPath}.${attemptId}.tmp`;
    lock.assertOwned();
    fs.copyFileSync(attemptManifestPath, publishedTemp);
    fs.renameSync(publishedTemp, publishedPath);
    lock.assertOwned();
    const completedState = { ...state, status: "completed", manifestPath: publishedPath, updatedAt: new Date().toISOString() };
    const completedStateTemp = `${statePath}.${attemptId}.tmp`;
    fs.writeFileSync(completedStateTemp, JSON.stringify(completedState, null, 2), "utf8");
    fs.renameSync(completedStateTemp, statePath);

    return manifest;
    } finally {
      lock.release();
    }
  }
}

function safeErrorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof VlmProviderError) return { code: error.code, message: error.code };
  return { code: "analysis_error", message: "Diagnosis analysis failed." };
}
