/** Stable payload shared by server generation and browser approval code. */
export function proposalDigestPayload(proposal: Record<string, any>): string {
  const fields = [
    "schemaVersion", "proposalId", "runId", "attemptId", "diagnosisManifestPath", "registeredPatchId",
    "scenarioId", "diagnosisRef", "defectCategory", "severity", "localization", "suspectedRootCause",
    "evidenceExplanation", "proposedCorrection", "expectedVisualImprovement", "confidence", "confidenceScore",
    "potentialRisks", "requiredValidationTests", "status", "createdAt", "isMock",
  ];
  const immutable: Record<string, any> = {};
  for (const field of fields) if (Object.prototype.hasOwnProperty.call(proposal, field)) immutable[field] = proposal[field];
  return stableStringify(immutable);
}

function stableStringify(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
