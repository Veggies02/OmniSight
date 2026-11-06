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
 * Sanitizes a URL or route string by safely removing defect-injection query parameters
 * (e.g. ?defect=..., ?defect-id=..., or &inject-defect=...) while strictly preserving legitimate paths,
 * routing query parameters, and SPA hash routes.
 */
export function sanitizeUrlOrRoute(rawUrlOrRoute: string): string {
  if (!rawUrlOrRoute || typeof rawUrlOrRoute !== "string") return "";

  const trimmed = rawUrlOrRoute.trim();
  if (!trimmed) return "";

  const isAbsolute = /^https?:\/\//i.test(trimmed);
  const dummyBase = "http://localhost";

  const isDefectKey = (key: string) =>
    /^defect([-_]?id)?$/i.test(key) || /^inject[-_]?defect$/i.test(key);

  try {
    const urlObj = new URL(trimmed, dummyBase);

    // 1. Clean standard query parameters
    const paramsToDelete: string[] = [];
    urlObj.searchParams.forEach((_val, key) => {
      if (isDefectKey(key)) {
        paramsToDelete.push(key);
      }
    });

    for (const key of paramsToDelete) {
      urlObj.searchParams.delete(key);
    }

    // 2. Clean SPA hash fragment query parameters (e.g. /products#section?defect=... or /#/products?defect=...)
    if (urlObj.hash && urlObj.hash.includes("?")) {
      const qIndex = urlObj.hash.indexOf("?");
      const hashPath = urlObj.hash.substring(0, qIndex);
      const hashSearch = urlObj.hash.substring(qIndex + 1);
      const hashParams = new URLSearchParams(hashSearch);
      const hashParamsToDelete: string[] = [];

      hashParams.forEach((_val, key) => {
        if (isDefectKey(key)) {
          hashParamsToDelete.push(key);
        }
      });

      for (const key of hashParamsToDelete) {
        hashParams.delete(key);
      }

      const remainingHashSearch = hashParams.toString();
      urlObj.hash = remainingHashSearch ? `${hashPath}?${remainingHashSearch}` : hashPath;
    }

    // 3. Clean encoded ?defect= in pathname if present (e.g. %3Fdefect=...)
    if (/%3f(?:defect|inject)/i.test(urlObj.pathname)) {
      urlObj.pathname = urlObj.pathname.replace(/%3f(?:defect([-_]?id)?|inject[-_]?defect)=[^&/%]*/gi, "");
    }

    if (isAbsolute) {
      return urlObj.toString();
    } else {
      const search = urlObj.search ? urlObj.search : "";
      const hash = urlObj.hash ? urlObj.hash : "";
      return `${urlObj.pathname}${search}${hash}`;
    }
  } catch {
    // Fallback regex if URL parsing encounters unparseable characters
    return trimmed
      .replace(/[?&](?:defect([-_]?id)?|inject[-_]?defect)=[^&#]*/gi, "")
      .replace(/\?$/, "");
  }
}

/**
 * Sanitizes a full DOM HTML snapshot document for model-facing evaluation datasets.
 * Preserves the full DOM structure and CSS declarations while removing:
 * - All CSS comments (including defect explanations and numbers)
 * - Absolute local development paths (macOS /Users, Linux /home, Windows C:\...)
 * - Vite development-only metadata attributes (e.g. data-vite-dev-id)
 * - Vite / React refresh script tags
 * - Inspection metadata elements and wildcard data-defect-* attributes (supporting double, single, unquoted, valueless)
 * - Defect class name labels without corrupting compound CSS selectors or legitimate hyphenated classes
 */
export function sanitizeDomSnapshot(rawHtml: string): string {
  let cleaned = rawHtml;

  // 1. Remove hidden inspection metadata element and wildcard data-defect-* attributes (double, single, unquoted, or valueless)
  cleaned = cleaned.replace(/<div[^>]*id="omnisight-defect-metadata"[^>]*>[\s\S]*?<\/div>/gi, "");
  cleaned = cleaned.replace(/<div[^>]*id="omnisight-defect-metadata"[^>]*\/>/gi, "");
  cleaned = cleaned.replace(/\s*data-defect-[a-z0-9-]+(=("[^"]*"|'[^']*'|[^\s"'>]+))?/gi, "");

  // 2. Remove Vite development-only metadata attributes and local machine paths (macOS, Linux, Windows)
  cleaned = cleaned.replace(/\s*data-vite-dev-id="[^"]*"/gi, "");
  cleaned = cleaned.replace(/(?:\/Users|\/home|\/root|\/workspace|[A-Za-z]:[\\\/])[^\s"'<>]+/gi, "");

  // 3. Remove Vite and React refresh scripts
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // 4. Remove all CSS comments (eliminates /* Defect 1: ... */, /* Controlled UI ... */, etc.)
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");

  // 5. Clean CSS compound selectors:
  // e.g. .navbar.defect-mobile-nav-overflow -> .navbar (removes chained defect class without leaving trailing dot)
  cleaned = cleaned.replace(/(\.[a-zA-Z0-9_-]+)\.defect-[a-z0-9-]+\b/gi, "$1");

  // Map standalone benchmark defect classes to scoped component selectors so diagnostic CSS remains scoped
  cleaned = cleaned.replace(/\.defect-(product-image-distortion|product-card-layout-break|low-contrast-text)\b/gi, ".product-card");
  cleaned = cleaned.replace(/\.defect-mobile-nav-overflow\b/gi, ".navbar");

  // Remove any remaining standalone .defect-[name] selectors cleanly (only when not preceded by identifier char or hyphen)
  cleaned = cleaned.replace(/(?<![a-zA-Z0-9_-])\.defect-[a-z0-9-]+\b/gi, "");

  // 6. Remove defect class identifiers from HTML class attributes safely without corrupting hyphenated classes
  cleaned = cleaned.replace(/class=(["'])([\s\S]*?)\1/gi, (_match, quote, classVal) => {
    const classes = classVal.split(/\s+/).filter(Boolean);
    const filtered = classes.filter((cls: string) => !/^defect-[a-z0-9-]+$/i.test(cls));
    return `class=${quote}${filtered.join(" ")}${quote}`;
  });

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
 * Helper to decode URI components and HTML decimal/hex entities
 * to detect obfuscated or encoded ground-truth tokens.
 */
export function decodeEntitiesAndUri(str: string): string {
  let decoded = str;
  try {
    decoded = decodeURIComponent(str);
  } catch {
    decoded = str.replace(/%([0-9a-fA-F]{2})/g, (_m, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return _m;
      }
    });
  }

  // HTML numeric entities decimal (&#112;) & hex (&#x70;)
  decoded = decoded.replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)));
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  return decoded;
}

/**
 * Validates that an evidence payload (JSON string or DOM HTML) is completely
 * free of ground-truth leakage and development metadata.
 * Throws an Error if any forbidden token or pattern is discovered.
 */
export function assertNoGroundTruthLeakage(payloadString: string): void {
  const decodedPayload = decodeEntitiesAndUri(payloadString);

  for (const token of FORBIDDEN_LEAKAGE_TOKENS) {
    if (payloadString.includes(token) || decodedPayload.includes(token)) {
      throw new Error(`CRITICAL LEAKAGE DETECTED: Ground-truth token '${token}' found in model input payload!`);
    }
  }

  // Also check case-insensitive match for Defect 1-4 comments
  const defectCommentMatch = payloadString.match(/Defect\s+[1-4]\b/i) || decodedPayload.match(/Defect\s+[1-4]\b/i);
  if (defectCommentMatch) {
    throw new Error(`CRITICAL LEAKAGE DETECTED: Defect comment '${defectCommentMatch[0]}' found in model input payload!`);
  }

  // Check case-insensitive match for Controlled UI Defect Scenarios
  if (/controlled\s+ui\s+defect\s+scenarios/i.test(payloadString) || /controlled\s+ui\s+defect\s+scenarios/i.test(decodedPayload)) {
    throw new Error("CRITICAL LEAKAGE DETECTED: 'Controlled UI Defect Scenarios' comment found in model input payload!");
  }

  // Check for defect query parameters in URLs (defect, defectId, defect_id, defect-id, inject_defect, inject-defect)
  const queryParamRegex = /[\?&](?:defect([-_]?id)?|inject[-_]?defect)=/i;
  if (queryParamRegex.test(payloadString) || queryParamRegex.test(decodedPayload)) {
    throw new Error("CRITICAL LEAKAGE DETECTED: 'defect' query parameter found in model input payload!");
  }
}
