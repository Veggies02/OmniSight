export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DefectMeasurement {
  defectId: string;
  category: string;
  route: string;
  viewport: { width: number; height: number };
  state: "baseline" | "defective";
  elementBoundingBoxes: Record<string, BoundingBox | null>;
  computedStyles: Record<string, string | null>;
  specificMetrics: Record<string, any>;
  hasHorizontalOverflow: boolean;
  documentMetrics: {
    clientWidth: number;
    scrollWidth: number;
    clientHeight: number;
    scrollHeight: number;
  };
}

export interface ScenarioEvidence {
  scenarioId: string;
  defectId: string;
  route: string;
  viewport: { width: number; height: number };
  baseline: {
    screenshotPath: string;
    domPath: string;
    measurementsPath: string;
    title: string;
    url: string;
    consoleErrors: string[];
  };
  defective: {
    screenshotPath: string;
    domPath: string;
    measurementsPath: string;
    title: string;
    url: string;
    consoleErrors: string[];
  };
}

export interface ModelFacingEvidence {
  runId: string;
  timestamp: string;
  browser: string;
  scenarios: Array<{
    scenarioId: string;
    route: string;
    viewport: { width: number; height: number };
    baselineScreenshot: string;
    defectiveScreenshot: string;
    baselineDom: string;
    defectiveDom: string;
    pageTitle: string;
    consoleErrors: {
      baseline: string[];
      defective: string[];
    };
  }>;
}

export interface GroundTruthRecord {
  runId: string;
  timestamp: string;
  scenarios: Record<
    string,
    {
      defectId: string;
      expectedCategory: string;
      expectedSymptom: string;
      targetComponent: string;
      targetRoute: string;
      baselineMeasurements: DefectMeasurement;
      defectiveMeasurements: DefectMeasurement;
      measuredDelta: Record<string, any>;
    }
  >;
}

export interface HarnessManifest {
  runId: string;
  timestamp: string;
  browser: string;
  scenariosCaptured: number;
  totalScenarios: number;
  success: boolean;
  artifactsDirectory: string;
  scenarios: Record<string, ScenarioEvidence>;
}

/**
 * Calculates WCAG 2.1 relative luminance for an sRGB component.
 */
function sRgbLuminanceComponent(c: number): number {
  const norm = c / 255;
  return norm <= 0.03928 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

/**
 * Parses an rgb or rgba CSS color string into [r, g, b, a].
 */
export function parseCssColor(colorStr: string): { r: number; g: number; b: number; a: number } | null {
  if (!colorStr) return null;
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] !== undefined ? Number(match[4]) : 1.0,
  };
}

/**
 * Calculates WCAG 2.1 relative luminance for [r, g, b].
 */
export function calculateRelativeLuminance(r: number, g: number, b: number): number {
  const rLum = sRgbLuminanceComponent(r);
  const gLum = sRgbLuminanceComponent(g);
  const bLum = sRgbLuminanceComponent(b);
  return 0.2126 * rLum + 0.7152 * gLum + 0.0722 * bLum;
}

/**
 * Computes contrast ratio between two colors according to WCAG 2.1 guidelines.
 * Returns ratio in format (L1 + 0.05) / (L2 + 0.05).
 */
export function calculateContrastRatio(
  fgColor: { r: number; g: number; b: number },
  bgColor: { r: number; g: number; b: number }
): number {
  const l1 = calculateRelativeLuminance(fgColor.r, fgColor.g, fgColor.b);
  const l2 = calculateRelativeLuminance(bgColor.r, bgColor.g, bgColor.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Number(ratio.toFixed(2));
}

/**
 * Resolves an effective background color by alpha-blending if translucent,
 * defaulting against white (#ffffff) if transparent.
 */
export function resolveEffectiveColor(
  colorStr: string,
  defaultBacking: { r: number; g: number; b: number } = { r: 255, g: 255, b: 255 }
): { r: number; g: number; b: number } {
  const parsed = parseCssColor(colorStr);
  if (!parsed || parsed.a === 0) {
    return defaultBacking;
  }
  if (parsed.a === 1) {
    return { r: parsed.r, g: parsed.g, b: parsed.b };
  }
  // Alpha blend over default backing
  const a = parsed.a;
  return {
    r: Math.round(parsed.r * a + defaultBacking.r * (1 - a)),
    g: Math.round(parsed.g * a + defaultBacking.g * (1 - a)),
    b: Math.round(parsed.b * a + defaultBacking.b * (1 - a)),
  };
}

/**
 * Strips inspection metadata and internal test defect IDs from a DOM HTML string
 * so the model-facing DOM snapshot is completely clean of ground-truth test labels.
 */
export function stripInspectionMetadataFromDom(rawHtml: string): string {
  let cleaned = rawHtml;
  // Remove the hidden metadata element
  cleaned = cleaned.replace(/<div[^>]*id="omnisight-defect-metadata"[^>]*>[\s\S]*?<\/div>/gi, "");
  cleaned = cleaned.replace(/<div[^>]*id="omnisight-defect-metadata"[^>]*\/>/gi, "");
  // Remove data-defect-applied and data-defect-injection-enabled attributes
  cleaned = cleaned.replace(/\s*data-defect-applied="[^"]*"/gi, "");
  cleaned = cleaned.replace(/\s*data-defect-injection-enabled="[^"]*"/gi, "");
  // Remove internal defect class names from class attributes to simulate natural un-tagged styling
  cleaned = cleaned.replace(/\s*defect-[a-z0-9-]+/gi, "");
  return cleaned;
}
