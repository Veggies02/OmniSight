import fs from "fs";
import path from "path";
import { validateDiagnosisSchema } from "./diagnosis-schema";

export interface DiagnosisScenarioAlias {
  alias: string;
  canonicalScenarioId: string;
}

export interface ValidatedDiagnosisManifest {
  runId: string;
  attemptId: string;
  status: "completed";
  timestamp: string;
  provider: string;
  model: string;
  scenariosDiagnosed: number;
  totalScenarios: number;
  results: Record<string, any>;
  scenarioAliases: DiagnosisScenarioAlias[];
  outputArtifactsDirectory: string;
}

export interface DiagnosisAttemptState {
  runId: string;
  attemptId: string;
  status: "running" | "failed" | "completed";
  manifestPath?: string;
  updatedAt?: string;
}

/** Read and validate the published manifest against its authoritative current-attempt state. */
export function readCurrentDiagnosisManifest(manifestPath: string, expectedRunId?: string): ValidatedDiagnosisManifest {
  const resolvedManifestPath = path.resolve(manifestPath);
  if (path.basename(resolvedManifestPath) !== "diagnoses-manifest.json") {
    throw new Error("Only the canonical diagnoses-manifest.json may be consumed.");
  }
  if (!fs.existsSync(resolvedManifestPath)) throw new Error(`Diagnosis manifest not found: '${resolvedManifestPath}'.`);

  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, "utf8"));
  } catch {
    throw new Error(`Diagnosis manifest is not valid JSON: '${resolvedManifestPath}'.`);
  }
  validateDiagnosisManifestShape(manifest, expectedRunId);

  const statePath = path.join(path.dirname(resolvedManifestPath), "diagnosis-attempt.json");
  if (!fs.existsSync(statePath)) throw new Error(`Authoritative diagnosis attempt state is missing: '${statePath}'.`);
  let state: DiagnosisAttemptState;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    throw new Error("Diagnosis attempt state is not valid JSON.");
  }
  if (
    state.runId !== manifest.runId ||
    state.attemptId !== manifest.attemptId ||
    state.status !== "completed" ||
    typeof state.manifestPath !== "string" ||
    path.resolve(state.manifestPath) !== resolvedManifestPath
  ) {
    throw new Error("Diagnosis manifest does not match the completed current attempt state.");
  }
  return manifest as ValidatedDiagnosisManifest;
}

export function validateDiagnosisManifestShape(data: any, expectedRunId?: string): void {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Diagnosis manifest must be a JSON object.");
  if (typeof data.runId !== "string" || !/^[A-Za-z0-9_.:-]+$/.test(data.runId) || data.runId.includes("..")) {
    throw new Error("Diagnosis manifest has a missing or invalid runId.");
  }
  if (expectedRunId && data.runId !== expectedRunId) throw new Error(`Diagnosis manifest runId '${data.runId}' does not match requested runId '${expectedRunId}'.`);
  if (typeof data.attemptId !== "string" || !/^attempt-[A-Za-z0-9-]+$/.test(data.attemptId)) {
    throw new Error("Diagnosis manifest is missing valid attempt provenance.");
  }
  if (data.status !== "completed") throw new Error("Diagnosis manifest does not represent a completed diagnosis attempt.");
  if (typeof data.timestamp !== "string" || typeof data.provider !== "string" || typeof data.model !== "string") {
    throw new Error("Diagnosis manifest is missing required metadata.");
  }
  if (!Number.isInteger(data.totalScenarios) || data.totalScenarios < 1 || data.scenariosDiagnosed !== data.totalScenarios) {
    throw new Error("Diagnosis manifest is incomplete.");
  }
  if (!data.results || typeof data.results !== "object" || Array.isArray(data.results)) throw new Error("Diagnosis manifest has invalid results.");
  const resultEntries = Object.entries<any>(data.results);
  if (resultEntries.length !== data.totalScenarios) throw new Error("Diagnosis manifest result count does not match totalScenarios.");

  const canonicalIds = new Set<string>();
  for (const [key, result] of resultEntries) {
    if (!key.trim()) throw new Error("Diagnosis manifest contains an empty canonical scenario ID.");
    if (!result || typeof result !== "object" || result.scenarioId !== key) {
      throw new Error(`Diagnosis result '${key}' is not keyed by its canonical scenario ID.`);
    }
    if (result.status !== result.diagnosis?.status || !["diagnosed", "no_defect_detected", "inconclusive"].includes(result.status)) {
      throw new Error(`Diagnosis result '${key}' is failed or has an invalid status.`);
    }
    const validation = validateDiagnosisSchema(result.diagnosis);
    if (!validation.valid) throw new Error(`Diagnosis result '${key}' has invalid diagnosis data: ${validation.errors.join("; ")}`);
    canonicalIds.add(key);
  }

  if (!Array.isArray(data.scenarioAliases)) throw new Error("Diagnosis manifest is missing its explicit scenarioAliases mapping.");
  const aliases = new Set<string>();
  for (const entry of data.scenarioAliases) {
    if (!entry || typeof entry.alias !== "string" || !entry.alias || typeof entry.canonicalScenarioId !== "string" || !entry.canonicalScenarioId) {
      throw new Error("Diagnosis manifest contains an invalid scenario alias.");
    }
    if (aliases.has(entry.alias) || canonicalIds.has(entry.alias)) throw new Error(`Duplicate or ambiguous scenario alias '${entry.alias}'.`);
    if (!canonicalIds.has(entry.canonicalScenarioId)) throw new Error(`Scenario alias '${entry.alias}' maps to an unknown canonical scenario.`);
    aliases.add(entry.alias);
  }
}
