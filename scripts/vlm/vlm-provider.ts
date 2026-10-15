import fs from "fs";
import { type StructuredDiagnosis, type ValidationResult, parseAndValidateDiagnosis } from "./diagnosis-schema";

export interface VlmMessageContent {
  type: "text" | "image";
  text?: string;
  imageBytesBase64?: string;
  mimeType?: string;
}

export interface VlmRequestPayload {
  prompt: string;
  baselineImageBase64?: string;
  defectiveImageBase64?: string;
  systemInstruction?: string;
}

export interface VlmProvider {
  name: string;
  model: string;
  diagnose(payload: VlmRequestPayload): Promise<StructuredDiagnosis>;
}

export interface ProviderConfig {
  providerName?: string;
  modelName?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Standard prompt used identically across all scenarios without revealing scenario labels.
 */
export const STANDARD_VLM_PROMPT = `
You are OmniSight, an expert multimodal UI quality assurance and visual defect analysis engine.
You are inspecting a web page comparison containing a baseline (clean/intended) screenshot and a test screenshot, along with sanitized DOM context and viewport metadata.

TASK:
1. Examine the visual evidence (and optional DOM excerpt) comparing the baseline and test UI states.
2. Determine if an observable UI defect or visual failure is present in the test state compared to baseline.
3. Categorize any detected defect into ONE of the following supported categories:
   - "image_distortion" (e.g. aspect ratio distortion, extreme stretch or skew, improper object-fit)
   - "layout_breakage" (e.g. elements overlapping abnormally, action buttons pushed outside container bounds, broken positioning)
   - "low_contrast" (e.g. text color too pale against background, violating readability or WCAG contrast)
   - "responsive_overflow" (e.g. layout elements forcing horizontal scrolling beyond the mobile screen width)
   - "unknown" (if a clear defect exists but does not fit the above categories)

4. If no defect is found or the evidence is inconclusive, report status as "no_defect_detected" or "inconclusive".
5. Return your diagnosis strictly as a JSON object adhering to this schema:
{
  "schema_version": "1.0",
  "status": "diagnosed" | "no_defect_detected" | "inconclusive",
  "summary": "<one sentence overview>",
  "defects": [
    {
      "category": "image_distortion" | "layout_breakage" | "low_contrast" | "responsive_overflow" | "unknown",
      "severity": "low" | "medium" | "high" | "critical",
      "confidence": <number between 0.0 and 1.0>,
      "description": "<detailed visual symptom>",
      "evidence": ["<specific visual detail 1>", "<specific visual detail 2>"],
      "affected_element": {
        "description": "<natural language element description>",
        "selector": "<CSS selector or null>"
      },
      "suspected_cause": "<probable CSS / HTML root cause>",
      "suggested_fix": "<actionable CSS / code repair hint>"
    }
  ],
  "limitations": ["<any observability or rendering limitation>"]
}

IMPORTANT RULES:
- Output ONLY valid JSON. Do not include markdown preamble or trailing explanations.
- Never output executable code or malicious patches.
- Rely strictly on observable visual differences and DOM symptoms.
`;

/**
 * Mock VLM Provider for offline, deterministic pipeline validation and automated testing.
 * Provides realistic diagnoses without requiring live API keys or network requests.
 */
export class MockVlmProvider implements VlmProvider {
  public name = "mock";
  public model: string;
  private customMockResponses: Map<string, StructuredDiagnosis> = new Map();

  constructor(model: string = "mock-vlm-v1") {
    this.model = model;
  }

  public setMockResponse(key: string, response: StructuredDiagnosis): void {
    this.customMockResponses.set(key, response);
  }

  public async diagnose(payload: VlmRequestPayload): Promise<StructuredDiagnosis> {
    // Check if a custom mock response was registered
    for (const [key, response] of this.customMockResponses.entries()) {
      if (payload.prompt.includes(key)) {
        return response;
      }
    }

    // Default mock response: inspects neutral prompt tokens (like object-fit, contrast, overflow, position)
    // present in the test DOM, viewport metadata, or computed metrics to simulate a vision model identifying anomalies.
    const p = payload.prompt.toLowerCase();

    if (p.includes('"scrollwidth": 650') || p.includes('scrollwidth: 650') || p.includes("390 x 844") || p.includes("650px")) {
      return {
        schema_version: "1.0",
        status: "diagnosed",
        summary: "Mobile navigation exceeds device screen width causing horizontal scrolling.",
        defects: [
          {
            category: "responsive_overflow",
            severity: "high",
            confidence: 0.95,
            description: "Navigation bar width exceeds 390px mobile viewport, causing horizontal page overflow.",
            evidence: [
              "Navbar container is constrained to 650px min-width on a 390px mobile viewport.",
              "Document scroll width exceeds client width by 260px.",
            ],
            affected_element: {
              description: "Header navigation container on mobile viewport",
              selector: ".navbar-container",
            },
            suspected_cause: "Hardcoded 650px min-width in mobile media query.",
            suggested_fix: "Remove fixed min-width and wrap navigation links or implement a mobile hamburger drawer.",
          },
        ],
        limitations: ["Captured at 390x844 viewport."],
      };
    }

    if (p.includes("color: #cbd5e1") || p.includes("rgb(203, 213, 225)") || p.includes("snippet.color")) {
      return {
        schema_version: "1.0",
        status: "diagnosed",
        summary: "Product description text has insufficient color contrast against white card surface.",
        defects: [
          {
            category: "low_contrast",
            severity: "medium",
            confidence: 0.92,
            description: "Product snippet text is rendered in very light grey (#cbd5e1), failing WCAG readability standards.",
            evidence: [
              "Text color #cbd5e1 against #ffffff results in a contrast ratio of ~1.48:1, well below 4.5:1.",
              "Visual legibility is severely compromised under standard ambient lighting.",
            ],
            affected_element: {
              description: "Product description snippet and secondary text elements",
              selector: ".product-snippet",
            },
            suspected_cause: "Text color overridden with high-luminance slate grey.",
            suggested_fix: "Update text color to a darker tone such as var(--color-text-secondary) or #475569.",
          },
        ],
        limitations: [],
      };
    }

    if (p.includes("bottom: -45px") || p.includes("margin-top: -40px") || p.includes("footer.position")) {
      return {
        schema_version: "1.0",
        status: "diagnosed",
        summary: "Product card layout broken with footer action buttons protruding outside card boundary.",
        defects: [
          {
            category: "layout_breakage",
            severity: "high",
            confidence: 0.96,
            description: "Footer buttons are displaced outside the card body and overlap subsequent grid items.",
            evidence: [
              "Footer element has absolute positioning displacing it -45px below card container.",
              "Card body content has negative top margin overlapping the image.",
            ],
            affected_element: {
              description: "Product card footer action container",
              selector: ".product-card-footer",
            },
            suspected_cause: "Absolute bottom positioning with negative offset overriding flex layout.",
            suggested_fix: "Remove absolute positioning and rely on parent flexbox alignment.",
          },
        ],
        limitations: [],
      };
    }

    if (p.includes("object-fit") || p.includes("height: 380px") || p.includes("media.height")) {
      return {
        schema_version: "1.0",
        status: "diagnosed",
        summary: "Product image appears vertically stretched with distorted aspect ratio.",
        defects: [
          {
            category: "image_distortion",
            severity: "medium",
            confidence: 0.94,
            description: "Product card image is vertically distorted with distorted aspect ratio and unnatural fill.",
            evidence: [
              "Rendered image height is significantly stretched compared to baseline.",
              "Computed object-fit is set to fill instead of maintaining aspect ratio.",
            ],
            affected_element: {
              description: "Product card hero image in catalogue grid",
              selector: ".product-image",
            },
            suspected_cause: "Container height override and object-fit: fill style applied to image.",
            suggested_fix: "Restore object-fit: cover and retain 1:1 square aspect ratio on media container.",
          },
        ],
        limitations: ["Evaluated from single desktop viewport capture."],
      };
    }

    // Fallback: no defect detected
    return {
      schema_version: "1.0",
      status: "no_defect_detected",
      summary: "No significant UI defects or visual regressions detected between baseline and test state.",
      defects: [],
      limitations: [],
    };
  }
}

/**
 * Gemini VLM Provider implementation calling Google Generative Language API
 * using standard HTTPS fetch without external SDK dependencies.
 */
export class GeminiVlmProvider implements VlmProvider {
  public name = "gemini";
  public model: string;
  private apiKey: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: ProviderConfig = {}) {
    this.model = config.modelName || process.env.OMNISIGHT_VLM_MODEL || "gemini-1.5-flash";
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || "";
    this.timeoutMs = config.timeoutMs || Number(process.env.OMNISIGHT_VLM_TIMEOUT_MS) || 30000;
    this.maxRetries = config.maxRetries || Number(process.env.OMNISIGHT_VLM_MAX_RETRIES) || 2;

    if (!this.apiKey) {
      throw new Error(
        "Gemini API key is missing. Set GEMINI_API_KEY in your environment or select the 'mock' provider."
      );
    }
  }

  public async diagnose(payload: VlmRequestPayload): Promise<StructuredDiagnosis> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const parts: any[] = [{ text: payload.prompt }];

    if (payload.baselineImageBase64) {
      parts.push({
        inline_data: {
          mime_type: "image/png",
          data: payload.baselineImageBase64,
        },
      });
    }

    if (payload.defectiveImageBase64) {
      parts.push({
        inline_data: {
          mime_type: "image/png",
          data: payload.defectiveImageBase64,
        },
      });
    }

    const requestBody = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: "application/json",
      },
    };

    let attempt = 0;
    let lastError: any = null;

    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Gemini API error (status ${response.status}): ${errorText}`);
        }

        const data: any = await response.json();
        const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawContent) {
          throw new Error("Gemini returned an empty candidate response.");
        }

        const validation = parseAndValidateDiagnosis(rawContent);
        if (!validation.valid || !validation.diagnosis) {
          throw new Error(`Invalid diagnosis structure from Gemini: ${validation.errors.join("; ")}`);
        }

        return validation.diagnosis;
      } catch (err: any) {
        lastError = err;
        if (attempt <= this.maxRetries) {
          // Bounded exponential backoff: 1s, 2s
          await new Promise((res) => setTimeout(res, 1000 * attempt));
        }
      }
    }

    throw lastError || new Error(`Gemini provider failed after ${this.maxRetries} retries.`);
  }
}

/**
 * Factory creating configured VLM provider instance based on environment variables or explicit config.
 */
export function createVlmProvider(config: ProviderConfig = {}): VlmProvider {
  const providerName = (config.providerName || process.env.OMNISIGHT_VLM_PROVIDER || "mock").toLowerCase();

  switch (providerName) {
    case "mock":
      return new MockVlmProvider(config.modelName || process.env.OMNISIGHT_VLM_MODEL || "mock-vlm-v1");
    case "gemini":
      return new GeminiVlmProvider(config);
    default:
      throw new Error(
        `Unsupported VLM provider '${providerName}'. Supported providers: 'mock', 'gemini'.`
      );
  }
}
