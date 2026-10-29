import fs from "fs";
import path from "path";
import { DiagnosisService } from "./vlm/diagnosis-service";

async function main() {
  const args = process.argv.slice(2);
  let runId: string | undefined;
  let runDir: string | undefined;
  let outputDir: string | undefined;
  let scenarioId: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run-id" && args[i + 1]) {
      runId = args[++i];
    } else if ((args[i] === "--run-dir" || args[i] === "--input") && args[i + 1]) {
      runDir = args[++i];
    } else if (args[i] === "--output" && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === "--scenario" && args[i + 1]) {
      scenarioId = args[++i];
    } else if (args[i] === "--provider" && args[i + 1]) {
      provider = args[++i];
    } else if (args[i] === "--model" && args[i + 1]) {
      model = args[++i];
    }
  }

  console.log("==================================================");
  console.log("OmniSight VLM Defect Diagnosis Pipeline");
  console.log("==================================================");

  const service = new DiagnosisService({
    providerName: provider,
    modelName: model,
  });

  try {
    const manifest = await service.diagnoseRun({
      runId,
      runDirectory: runDir,
      outputDirectory: outputDir,
      scenarioId,
    });

    console.log("\nDiagnosis Run Completed Successfully!");
    console.log(`- Run ID: ${manifest.runId}`);
    console.log(`- Provider: ${manifest.provider}`);
    console.log(`- Model: ${manifest.model}`);
    console.log(`- Scenarios Diagnosed: ${manifest.scenariosDiagnosed}/${manifest.totalScenarios}`);
    console.log(`- Diagnoses Saved in: ${manifest.outputArtifactsDirectory}`);
    process.exit(0);
  } catch (err: any) {
    console.error("\nDiagnosis pipeline failed:", err.message);
    process.exit(1);
  }
}

main();
