import fs from "fs";
import path from "path";
import { RepairProposalService } from "./vlm/repair-proposal-service";

async function main() {
  const args = process.argv.slice(2);
  let runId: string | undefined;
  let diagnosisManifestPath: string | undefined;
  let outputDirectory: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run-id" && args[i + 1]) {
      runId = args[++i];
    } else if (
      (args[i] === "--diagnosis" || args[i] === "--diagnoses" || args[i] === "--input" || args[i] === "--diagnoses-dir") &&
      args[i + 1]
    ) {
      diagnosisManifestPath = args[++i];
    } else if (args[i] === "--output" && args[i + 1]) {
      outputDirectory = args[++i];
    }
  }

  console.log("==================================================");
  console.log("OmniSight Defect Localization & Repair Proposals");
  console.log("==================================================");

  // If a directory was provided for diagnosisManifestPath, check for manifest inside it
  if (diagnosisManifestPath && fs.existsSync(diagnosisManifestPath)) {
    const stat = fs.statSync(diagnosisManifestPath);
    if (stat.isDirectory()) {
      const candidateInside = path.join(diagnosisManifestPath, "diagnoses-manifest.json");
      const candidateUnderDiagnoses = path.join(diagnosisManifestPath, "diagnoses/diagnoses-manifest.json");
      if (fs.existsSync(candidateInside)) {
        diagnosisManifestPath = candidateInside;
      } else if (fs.existsSync(candidateUnderDiagnoses)) {
        diagnosisManifestPath = candidateUnderDiagnoses;
      }
    }
  }

  // If manifest not directly supplied, find by run-id or fallback to latest in visual-evidence runs
  if (!diagnosisManifestPath) {
    const evidenceBase = path.resolve(process.cwd(), "artifacts/visual-evidence");
    if (!fs.existsSync(evidenceBase)) {
      console.error(`Evidence directory '${evidenceBase}' not found. Run 'npm run capture:evidence' first.`);
      process.exit(1);
    }

    let targetRunDir: string;
    if (runId) {
      targetRunDir = path.join(evidenceBase, runId);
    } else {
      const runs = fs
        .readdirSync(evidenceBase)
        .filter((d) => d.startsWith("run-") && fs.statSync(path.join(evidenceBase, d)).isDirectory())
        .sort()
        .reverse();

      if (runs.length === 0) {
        console.error("No evidence runs found. Run 'npm run capture:evidence' and 'npm run diagnose:evidence' first.");
        process.exit(1);
      }
      targetRunDir = path.join(evidenceBase, runs[0]);
    }

    diagnosisManifestPath = path.join(targetRunDir, "diagnoses/diagnoses-manifest.json");
  }

  if (!fs.existsSync(diagnosisManifestPath)) {
    console.error(`Diagnosis manifest not found: '${diagnosisManifestPath}'.`);
    console.error("Run 'npm run diagnose:evidence' before generating repair proposals.");
    process.exit(1);
  }

  console.log(`Reading diagnosis manifest: ${diagnosisManifestPath}`);

  try {
    const service = new RepairProposalService({ isMock: true });
    const runManifest = service.generateProposalsForRun(diagnosisManifestPath, outputDirectory);

    console.log("\nRepair Proposal Generation Completed Successfully!");
    console.log(`- Run ID: ${runManifest.runId}`);
    console.log(`- Total Diagnoses Processed: ${runManifest.totalDiagnosesProcessed}`);
    console.log(`- Proposals Generated: ${runManifest.proposalsGenerated}`);
    console.log(`- Unsupported / Inconclusive: ${runManifest.unsupportedOrInconclusive}`);
    console.log(`- Artifacts Saved in: ${runManifest.outputDirectory}`);
    console.log("  * repair_proposals.json");
    console.log("  * source_localization.json");
    console.log("  * repair_proposal_summary.md");
    process.exit(0);
  } catch (err: any) {
    console.error("\nRepair proposal generation failed:", err.message);
    process.exit(1);
  }
}

main();
