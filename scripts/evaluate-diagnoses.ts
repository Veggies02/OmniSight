import fs from "fs";
import path from "path";
import { DiagnosisEvaluator } from "./vlm/diagnosis-evaluator";

async function main() {
  const args = process.argv.slice(2);
  let runId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run-id" && args[i + 1]) {
      runId = args[++i];
    }
  }

  const evidenceBaseDir = path.resolve(process.cwd(), "artifacts/visual-evidence");

  if (!runId) {
    if (!fs.existsSync(evidenceBaseDir)) {
      console.error(`Error: artifacts directory '${evidenceBaseDir}' does not exist.`);
      process.exit(1);
    }
    const runs = fs
      .readdirSync(evidenceBaseDir)
      .filter((d) => d.startsWith("run-") && fs.statSync(path.join(evidenceBaseDir, d)).isDirectory())
      .sort()
      .reverse();

    if (runs.length === 0) {
      console.error("Error: No evidence runs found in 'artifacts/visual-evidence/'.");
      process.exit(1);
    }
    runId = runs[0];
  }

  const targetRunDir = path.join(evidenceBaseDir, runId);
  const diagnosesManifestPath = path.join(targetRunDir, "diagnoses", "diagnoses-manifest.json");
  const groundTruthPath = path.join(targetRunDir, "ground_truth_eval.json");

  if (!fs.existsSync(diagnosesManifestPath)) {
    console.error(`Error: diagnoses manifest not found at '${diagnosesManifestPath}'. Run 'npm run diagnose:evidence' first.`);
    process.exit(1);
  }

  if (!fs.existsSync(groundTruthPath)) {
    console.error(`Error: ground truth evaluation record not found at '${groundTruthPath}'.`);
    process.exit(1);
  }

  const diagnosisManifest = JSON.parse(fs.readFileSync(diagnosesManifestPath, "utf8"));
  const groundTruthData = JSON.parse(fs.readFileSync(groundTruthPath, "utf8"));

  console.log("==================================================");
  console.log("OmniSight VLM Diagnosis Evaluation Pipeline");
  console.log("==================================================");
  console.log(`Evaluating Run: ${runId}`);
  console.log(`Model Diagnosed: ${diagnosisManifest.provider} (${diagnosisManifest.model})`);

  const evaluator = new DiagnosisEvaluator();
  const report = evaluator.evaluate(diagnosisManifest, groundTruthData, path.join(targetRunDir, "diagnoses"));

  console.log("\n==================================================");
  console.log("EVALUATION RESULTS SUMMARY");
  console.log("==================================================");
  console.log(`Total Scenarios:               ${report.totalScenarios}`);
  console.log(`Successfully Diagnosed:        ${report.successfullyDiagnosed}/${report.totalScenarios}`);
  console.log(`Correct Category Predictions:  ${report.correctCategoryPredictions}/${report.totalScenarios} (${report.overallAccuracyPercent}%)`);
  console.log(`Incorrect Predictions:         ${report.incorrectCategoryPredictions}`);
  console.log(`Inconclusive / Errors:         ${report.inconclusive + report.failedOrError}`);
  console.log(`Average Model Confidence:      ${(report.averageConfidence * 100).toFixed(1)}%`);

  console.log("\nPER-SCENARIO RESULTS:");
  for (const s of report.scenarioResults) {
    const mark = s.verdict === "correct" ? "PASS" : "FAIL";
    console.log(
      `  [${mark}] ${s.scenarioId}: predicted '${s.predictedCategory}' vs expected '${s.expectedCategory}' (confidence: ${(s.modelConfidence * 100).toFixed(0)}%)`
    );
  }

  console.log("\nEvaluation report saved to:");
  console.log(report.evaluationArtifactPath);
  process.exit(0);
}

main();
