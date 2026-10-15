export type DefectCategory =
  | "image_distortion"
  | "layout_breakage"
  | "low_contrast"
  | "responsive_overflow"
  | "unknown";

export type DefectSeverity = "low" | "medium" | "high" | "critical";

export type DiagnosisStatus = "diagnosed" | "no_defect_detected" | "inconclusive" | "error";

export interface AffectedElementInfo {
  description: string;
  selector?: string | null;
}

export interface DetectedDefect {
  category: DefectCategory;
  severity: DefectSeverity;
  confidence: number;
  description: string;
  evidence: string[];
  affected_element: AffectedElementInfo;
  suspected_cause: string;
  suggested_fix: string;
}

export interface StructuredDiagnosis {
  schema_version: "1.0";
  status: DiagnosisStatus;
  summary: string;
  defects: DetectedDefect[];
  limitations: string[];
}

export interface DiagnosisResult {
  scenarioId: string;
  status: DiagnosisStatus;
  diagnosis: StructuredDiagnosis;
  rawResponse?: string;
  model: string;
  provider: string;
  executionTimeMs: number;
  sanitizedEvidenceRef: {
    baselineScreenshot: string;
    defectiveScreenshot: string;
    viewport: { width: number; height: number };
  };
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  diagnosis?: StructuredDiagnosis;
}

const VALID_CATEGORIES: Set<DefectCategory> = new Set([
  "image_distortion",
  "layout_breakage",
  "low_contrast",
  "responsive_overflow",
  "unknown",
]);

const VALID_SEVERITIES: Set<DefectSeverity> = new Set(["low", "medium", "high", "critical"]);
const VALID_STATUSES: Set<DiagnosisStatus> = new Set(["diagnosed", "no_defect_detected", "inconclusive", "error"]);

/**
 * Validates any parsed JavaScript object against the strict StructuredDiagnosis schema.
 */
export function validateDiagnosisSchema(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, errors: ["Root diagnosis must be a non-null object."] };
  }

  if (data.schema_version !== "1.0") {
    errors.push(`Invalid schema_version: expected '1.0', got '${data.schema_version}'.`);
  }

  if (!VALID_STATUSES.has(data.status)) {
    errors.push(`Invalid status: '${data.status}'. Must be one of: ${Array.from(VALID_STATUSES).join(", ")}.`);
  }

  if (typeof data.summary !== "string" || data.summary.trim() === "") {
    errors.push("Missing or non-string 'summary'.");
  }

  if (!Array.isArray(data.defects)) {
    errors.push("'defects' must be an array.");
  } else {
    data.defects.forEach((defect: any, idx: number) => {
      const prefix = `defects[${idx}]`;

      if (!defect || typeof defect !== "object") {
        errors.push(`${prefix} must be an object.`);
        return;
      }

      if (!VALID_CATEGORIES.has(defect.category)) {
        errors.push(`${prefix}.category '${defect.category}' is invalid. Allowed: ${Array.from(VALID_CATEGORIES).join(", ")}.`);
      }

      if (!VALID_SEVERITIES.has(defect.severity)) {
        errors.push(`${prefix}.severity '${defect.severity}' is invalid. Allowed: ${Array.from(VALID_SEVERITIES).join(", ")}.`);
      }

      if (typeof defect.confidence !== "number" || isNaN(defect.confidence) || defect.confidence < 0 || defect.confidence > 1) {
        errors.push(`${prefix}.confidence must be a number between 0.0 and 1.0 (received: ${defect.confidence}).`);
      }

      if (typeof defect.description !== "string" || defect.description.trim() === "") {
        errors.push(`${prefix}.description must be a non-empty string.`);
      }

      if (!Array.isArray(defect.evidence) || defect.evidence.length === 0) {
        errors.push(`${prefix}.evidence must be a non-empty array of strings.`);
      } else {
        defect.evidence.forEach((ev: any, evIdx: number) => {
          if (typeof ev !== "string" || ev.trim() === "") {
            errors.push(`${prefix}.evidence[${evIdx}] must be a non-empty string.`);
          }
        });
      }

      if (!defect.affected_element || typeof defect.affected_element !== "object") {
        errors.push(`${prefix}.affected_element must be an object.`);
      } else {
        if (typeof defect.affected_element.description !== "string" || defect.affected_element.description.trim() === "") {
          errors.push(`${prefix}.affected_element.description must be a non-empty string.`);
        }
      }

      if (typeof defect.suspected_cause !== "string" || defect.suspected_cause.trim() === "") {
        errors.push(`${prefix}.suspected_cause must be a non-empty string.`);
      }

      if (typeof defect.suggested_fix !== "string" || defect.suggested_fix.trim() === "") {
        errors.push(`${prefix}.suggested_fix must be a non-empty string.`);
      }
    });
  }

  if (!Array.isArray(data.limitations)) {
    errors.push("'limitations' must be an array of strings.");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    diagnosis: data as StructuredDiagnosis,
  };
}

/**
 * Parses raw JSON string returned by a model and validates against StructuredDiagnosis schema.
 */
export function parseAndValidateDiagnosis(rawJson: string): ValidationResult {
  if (!rawJson || rawJson.trim() === "") {
    return { valid: false, errors: ["Model returned an empty response."] };
  }

  if (rawJson.length > 50000) {
    return { valid: false, errors: [`Response size (${rawJson.length} bytes) exceeds safety limit (50,000 bytes).`] };
  }

  // Strip markdown code fences if model enclosed JSON in ```json ... ```
  let sanitized = rawJson.trim();
  if (sanitized.startsWith("```")) {
    sanitized = sanitized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(sanitized);
  } catch (err: any) {
    return { valid: false, errors: [`Malformed JSON syntax: ${err.message}`] };
  }

  return validateDiagnosisSchema(parsed);
}
