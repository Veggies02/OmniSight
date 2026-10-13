import path from "path";
import fs from "fs";
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
 * Sanitizes a DOM string to retain the most informative main-content excerpts
 * while guaranteeing zero leakage of test tags, inspection metadata, or defect IDs.
 */
export function sanitizeDomForVlm(rawHtml: string): string {
  // First run base stripper from evidence-helpers
  let cleaned = stripInspectionMetadataFromDom(rawHtml);

  // Strip script, noscript, style, and head tags to keep token count focused on relevant DOM structure
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  cleaned = cleaned.replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, "");

  // Extract body or app container if present
  const bodyMatch = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    cleaned = bodyMatch[1];
  }

  // Remove data-testid that contains "defect"
  cleaned = cleaned.replace(/data-testid="[^"]*defect[^"]*"/gi, "");

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
 * Validates that an evidence payload is completely free of ground-truth leakage.
 * Throws an Error if any forbidden token is discovered.
 */
export function assertNoGroundTruthLeakage(payloadString: string): void {
  const forbiddenTokens = [
    "ground_truth",
    "groundTruth",
    "expectedCategory",
    "expectedSymptom",
    "product-image-distortion",
    "product-card-layout-break",
    "low-contrast-text",
    "mobile-nav-overflow",
    "omnisight-defect-metadata",
    "data-defect-applied",
    "defect-product-image-distortion",
    "defect-product-card-layout-break",
    "defect-low-contrast-text",
    "defect-mobile-nav-overflow",
  ];

  for (const token of forbiddenTokens) {
    if (payloadString.includes(token)) {
      throw new Error(`CRITICAL LEAKAGE DETECTED: Ground-truth token '${token}' found in model input payload!`);
    }
  }
}
