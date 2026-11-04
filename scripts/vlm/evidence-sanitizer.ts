import { stripInspectionMetadataFromDom } from "../evidence-helpers";

export interface SanitizedScenarioEvidence {
  scenarioAlias: string;
  route: string;
  viewport: { width: number; height: number };
  baselineScreenshotPath: string;
  defectiveScreenshotPath: string;
  baselineDomExcerpt: string;
  defectiveDomExcerpt: string;
  pageTitle: string;
  consoleErrors: {
    baseline: string[];
    defective: string[];
  };
}

export interface SanitizedModelInput {
  runAlias: string;
  scenarios: SanitizedScenarioEvidence[];
}

/**
 * Sanitizes a full DOM HTML snapshot document for model-facing evaluation datasets.
 * Preserves the full DOM structure and CSS declarations while removing:
 * - All CSS comments (including defect explanations and numbers)
 * - Absolute local development paths (e.g. /Users/...)
 * - Vite development-only metadata attributes (e.g. data-vite-dev-id)
 * - Vite / React refresh script tags
 * - Inspection metadata elements and data-defect-* attributes
 * - Defect class name labels (e.g. defect-product-image-distortion)
 */
export function sanitizeDomSnapshot(rawHtml: string): string {
  let cleaned = rawHtml;

  // 1. Remove hidden inspection metadata element and attributes
  cleaned = cleaned.replace(/<div[^>]*id="omnisight-defect-metadata"[^>]*>[\s\S]*?<\/div>/gi, "");
  cleaned = cleaned.replace(/<div[^>]*id="omnisight-defect-metadata"[^>]*\/>/gi, "");
  cleaned = cleaned.replace(/\s*data-defect-[a-z-]+="[^"]*"/gi, "");
  cleaned = cleaned.replace(/\s*data-defect-applied="[^"]*"/gi, "");
  cleaned = cleaned.replace(/\s*data-defect-injection-enabled="[^"]*"/gi, "");

  // 2. Remove Vite development-only metadata attributes and local machine paths
  cleaned = cleaned.replace(/\s*data-vite-dev-id="[^"]*"/gi, "");
  cleaned = cleaned.replace(/\/Users\/[^\s"'>]+/gi, "");

  // 3. Remove Vite and React refresh scripts
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // 4. Remove all CSS comments (eliminates /* Defect 1: ... */, /* Controlled UI ... */, etc.)
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");

  // 5. Remove defect class identifiers from attributes and CSS selectors
  cleaned = cleaned.replace(/\bdefect-[a-z0-9-]+\b/gi, "");

  // 6. Repair any broken selectors created by removing defect class prefixes
  cleaned = cleaned.replace(/\.\s+\./g, ".product-card");
  cleaned = cleaned.replace(/\.navbar\.\s+/g, ".navbar ");

  // 7. Remove any defect testids
  cleaned = cleaned.replace(/data-testid="[^"]*defect[^"]*"/gi, "");

  return cleaned.trim();
}

/**
 * Sanitizes a DOM string to retain the most informative main-content excerpts
 * for prompt injection while guaranteeing zero leakage of test tags, inspection metadata, or defect IDs.
 */
export function sanitizeDomForVlm(rawHtml: string): string {
  // First run DOM snapshot sanitizer to eliminate comments, paths, and metadata
  let cleaned = sanitizeDomSnapshot(rawHtml);

  // Strip style and head tags for focused prompt token efficiency
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  cleaned = cleaned.replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, "");

  // Extract body or app container if present
  const bodyMatch = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    cleaned = bodyMatch[1];
  }

  // Truncate cleanly to at most ~4,000 characters to prevent prompt bloat while retaining all relevant elements
  if (cleaned.length > 4000) {
    cleaned = cleaned.substring(0, 4000) + "\n<!-- [DOM excerpt truncated for brevity] -->";
  }

  return cleaned.trim();
}

/**
 * Maps any scenario ID to an opaque alias (e.g. scenario_01, scenario_02)
 * so the model prompt NEVER sees names like 'product-image-distortion' or 'mobile-nav-overflow'.
 */
export function createNeutralScenarioAlias(index: number): string {
  return `scenario_${String(index + 1).padStart(2, "0")}`;
}

/**
 * List of forbidden ground-truth tokens and patterns.
 * Specific terms are checked to prevent false positives against legitimate
 * diagnostic evidence (e.g. "overflow: hidden" or "calculateContrastRatio").
 */
export const FORBIDDEN_LEAKAGE_TOKENS = [
  // Scenario Identifiers
  "product-image-distortion",
  "product-card-layout-break",
  "low-contrast-text",
  "mobile-nav-overflow",

  // Defect Registry Categories
  "visual-distortion",
  "layout-shift",
  "color-contrast",
  "responsive-overflow",

  // Canonical VLM Categories
  "image_distortion",
  "layout_breakage",
  "low_contrast",
  "responsive_overflow",

  // Test-bed Comments & Annotations
  "Controlled UI Defect Scenarios",
  "Defect 1",
  "Defect 2",
  "Defect 3",
  "Defect 4",

  // Ground Truth & Scoring Metadata
  "ground_truth",
  "groundTruth",
  "expected_category",
  "expectedCategory",
  "expected_symptom",
  "expectedSymptom",

  // Development Environment Paths & Vite Metadata
  "/Users/",
  "data-vite-dev-id",

  // Internal Defect Inspection Tags & Selectors
  "omnisight-defect-metadata",
  "data-defect-applied",
  "data-defect-injection-enabled",
  "defect-product-image-distortion",
  "defect-product-card-layout-break",
  "defect-low-contrast-text",
  "defect-mobile-nav-overflow",
];

/**
 * Validates that an evidence payload (JSON string or DOM HTML) is completely
 * free of ground-truth leakage and development metadata.
 * Throws an Error if any forbidden token or pattern is discovered.
 */
export function assertNoGroundTruthLeakage(payloadString: string): void {
  for (const token of FORBIDDEN_LEAKAGE_TOKENS) {
    if (payloadString.includes(token)) {
      throw new Error(`CRITICAL LEAKAGE DETECTED: Ground-truth token '${token}' found in model input payload!`);
    }
  }

  // Also check case-insensitive match for Defect 1-4 comments
  const defectCommentMatch = payloadString.match(/Defect\s+[1-4]\b/i);
  if (defectCommentMatch) {
    throw new Error(`CRITICAL LEAKAGE DETECTED: Defect comment '${defectCommentMatch[0]}' found in model input payload!`);
  }

  // Check case-insensitive match for Controlled UI Defect Scenarios
  if (/controlled\s+ui\s+defect\s+scenarios/i.test(payloadString)) {
    throw new Error("CRITICAL LEAKAGE DETECTED: 'Controlled UI Defect Scenarios' comment found in model input payload!");
  }
}
