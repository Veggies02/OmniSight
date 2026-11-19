import fs from "fs";
import path from "path";
import { DiagnosisService } from "../../scripts/vlm/diagnosis-service";

async function main() {
  const [runDirectory, outputDirectory, delayText, signalPath] = process.argv.slice(2);
  const service = new DiagnosisService({ providerName: "mock" });
  (service as any).provider = {
    name: "mock",
    model: "lock-worker",
    diagnose: async () => {
      if (signalPath) fs.writeFileSync(signalPath, "started");
      await new Promise((resolve) => setTimeout(resolve, Number(delayText)));
      return {
        schema_version: "1.0", status: "diagnosed", summary: "Detected a visible issue.", limitations: [],
        defects: [{ category: "image_distortion", severity: "medium", confidence: 0.9, description: "Image is stretched.", evidence: ["Aspect ratio differs."], affected_element: { description: "Product image" }, suspected_cause: "Invalid object fit.", suggested_fix: "Use cover." }],
      };
    },
  };
  const result = await service.diagnoseRun({ runDirectory, outputDirectory });
  const manifestPath = path.join(outputDirectory, "diagnoses-manifest.json");
  if (JSON.parse(fs.readFileSync(manifestPath, "utf8")).attemptId !== result.attemptId) process.exitCode = 3;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
