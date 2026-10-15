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
} from "./evidence-sanitizer";
import {
  createVlmProvider,
  STANDARD_VLM_PROMPT,
  type ProviderConfig,
  type VlmProvider,
} from "./vlm-provider";

export interface DiagnosisPipelineOptions {
  runId?: string;
  runDirectory?: string;
  scenarioId?: string;
  providerConfig?: ProviderConfig;
  outputDirectory?: string;
}

export interface DiagnosisRunManifest {
  runId: string;
  timestamp: string;
  provider: string;
  model: string;
  scenariosDiagnosed: number;
  totalScenarios: number;
  results: Record<string, DiagnosisResult>;
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
    const measurementsPath = path.join(runDir, scenarioId, "measurements.json");
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

    // 5. Build neutral model prompt
    const neutralPrompt = `
${STANDARD_VLM_PROMPT}

EVIDENCE METADATA:
- Inspection Scenario Alias: ${neutralAlias}
- Target Route: ${scenarioEntry.route}
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

    // 6. Strict Leakage Verification
    assertNoGroundTruthLeakage(neutralPrompt);

    // 7. Call VLM Provider
    let diagnosis: StructuredDiagnosis;
    let errorMessage: string | undefined;

    try {
      diagnosis = await this.provider.diagnose({
        prompt: neutralPrompt,
        baselineImageBase64: baselineImgBase64,
        defectiveImageBase64: defectiveImgBase64,
      });
    } catch (err: any) {
      errorMessage = err.message;
      diagnosis = {
        schema_version: "1.0",
        status: "error",
        summary: `Diagnosis failed due to provider error: ${err.message}`,
        defects: [],
        limitations: [`Error: ${err.message}`],
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

    const modelEvidencePath = path.join(targetRunDir, "model_facing_evidence.json");
    if (!fs.existsSync(modelEvidencePath)) {
      throw new Error(`Model-facing evidence manifest '${modelEvidencePath}' was not found.`);
    }

    const modelEvidence = JSON.parse(fs.readFileSync(modelEvidencePath, "utf8"));
    const outputDir = options.outputDirectory || path.join(targetRunDir, "diagnoses");
    fs.mkdirSync(outputDir, { recursive: true });

    const manifest: DiagnosisRunManifest = {
      runId: modelEvidence.runId,
      timestamp: new Date().toISOString(),
      provider: this.provider.name,
      model: this.provider.model,
      scenariosDiagnosed: 0,
      totalScenarios: modelEvidence.scenarios.length,
      results: {},
      outputArtifactsDirectory: outputDir,
    };

    let scenarioIndex = 0;
    for (const scenario of modelEvidence.scenarios) {
      if (options.scenarioId && scenario.scenarioId !== options.scenarioId) {
        continue;
      }

      console.log(`Diagnosing scenario '${scenario.scenarioId}' using ${this.provider.name} (${this.provider.model})...`);
      const result = await this.diagnoseScenario(targetRunDir, scenario, scenarioIndex++);
      manifest.results[scenario.scenarioId] = result;
      manifest.scenariosDiagnosed++;

      // Save individual scenario diagnosis artifact
      const scenarioOutputPath = path.join(outputDir, `${scenario.scenarioId}-diagnosis.json`);
      fs.writeFileSync(scenarioOutputPath, JSON.stringify(result, null, 2), "utf8");
    }

    // Save diagnosis run manifest
    fs.writeFileSync(path.join(outputDir, "diagnoses-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    return manifest;
  }
}
