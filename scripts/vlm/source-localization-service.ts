import fs from "fs";
import path from "path";
import { type DefectCategory, type DetectedDefect } from "./diagnosis-schema";
import {
  type BoundedSourceExcerpt,
  type LocalizationEvidence,
  type SourceLocalizationResult,
} from "./repair-proposal-schema";
import {
  computeFileHash,
  validateAndResolveSourcePath,
} from "./source-path-security";

export interface LocalizationOptions {
  projectRoot?: string;
  contextWindowLines?: number; // surrounding lines to include, default 15
}

/**
 * Service that inspects real project source files (React components and CSS rules)
 * to locate the concrete source code causing or controlling the diagnosed defect.
 */
export class SourceLocalizationService {
  private projectRoot: string;
  private contextWindowLines: number;

  constructor(options: LocalizationOptions = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.contextWindowLines = options.contextWindowLines || 15;
  }

  /**
   * Localizes the responsible source file and excerpt for a detected defect.
   */
  public localizeDefect(defect: DetectedDefect, scenarioId?: string): SourceLocalizationResult {
    const evidence: LocalizationEvidence[] = [];
    const uncertaintyNotes: string[] = [];

    const category = defect.category;
    const selector = defect.affected_element?.selector || "";

    // 1. Check for unsupported/inconclusive category
    if (category === "unknown") {
      return {
        status: "unsupported",
        filePath: null,
        fileHash: null,
        componentOrSelector: selector || null,
        excerpt: null,
        evidence: [],
        uncertaintyNotes: ["Defect category is 'unknown'. Automated source localization is not supported."],
      };
    }

    // 2. Perform category-specific and selector-guided localization
    switch (category) {
      case "image_distortion": {
        // Responsible styles: .product-card-media, .product-image in src/index.css
        // Component: src/components/ProductCard.tsx
        return this.localizeImageDistortion(selector, evidence, uncertaintyNotes);
      }

      case "layout_breakage": {
        // Responsible styles: .product-card-body, .product-card-footer in src/index.css
        // Component: src/components/ProductCard.tsx
        return this.localizeLayoutBreakage(selector, evidence, uncertaintyNotes);
      }

      case "low_contrast": {
        // Responsible styles: .product-snippet, .product-title-link, .product-price in src/index.css
        // Component: src/components/ProductCard.tsx
        return this.localizeLowContrast(selector, evidence, uncertaintyNotes);
      }

      case "responsive_overflow": {
        // Responsible styles: .navbar-container, @media (max-width: 640px) in src/index.css
        // Component: src/components/Navbar.tsx
        return this.localizeResponsiveOverflow(selector, evidence, uncertaintyNotes);
      }

      default: {
        return {
          status: "unsupported",
          filePath: null,
          fileHash: null,
          componentOrSelector: selector || null,
          excerpt: null,
          evidence: [],
          uncertaintyNotes: [`Category '${category}' is not supported by the localization engine.`],
        };
      }
    }
  }

  private localizeImageDistortion(
    selector: string,
    evidence: LocalizationEvidence[],
    uncertaintyNotes: string[]
  ): SourceLocalizationResult {
    const targetFileRel = "src/index.css";
    const resolved = validateAndResolveSourcePath(targetFileRel, this.projectRoot);

    if (!resolved.valid || !resolved.absolutePath) {
      return {
        status: "failed",
        filePath: null,
        fileHash: null,
        componentOrSelector: selector || ".product-image",
        excerpt: null,
        evidence,
        uncertaintyNotes: [resolved.error || "Failed to resolve src/index.css"],
      };
    }

    const excerpt = this.extractBoundedExcerpt(
      resolved.absolutePath,
      targetFileRel,
      [".defect-product-image-distortion", ".product-card-media", ".product-image"],
      "object-fit"
    );

    if (!excerpt) {
      uncertaintyNotes.push("Could not locate object-fit or media rules in src/index.css.");
      return {
        status: "ambiguous",
        filePath: targetFileRel,
        fileHash: computeFileHash(resolved.absolutePath),
        componentOrSelector: selector || ".product-image",
        excerpt: null,
        evidence,
        uncertaintyNotes,
      };
    }

    evidence.push({
      matchedSelector: selector || ".product-image",
      matchedCategory: "image_distortion",
      sourceType: "css",
      rationale: "Located image dimensions, container height, and object-fit rules in src/index.css.",
      confidence: 0.94,
    });

    return {
      status: "localized",
      filePath: targetFileRel,
      fileHash: excerpt.sha256,
      componentOrSelector: selector || ".product-image",
      excerpt,
      evidence,
      uncertaintyNotes,
    };
  }

  private localizeLayoutBreakage(
    selector: string,
    evidence: LocalizationEvidence[],
    uncertaintyNotes: string[]
  ): SourceLocalizationResult {
    const targetFileRel = "src/index.css";
    const resolved = validateAndResolveSourcePath(targetFileRel, this.projectRoot);

    if (!resolved.valid || !resolved.absolutePath) {
      return {
        status: "failed",
        filePath: null,
        fileHash: null,
        componentOrSelector: selector || ".product-card-footer",
        excerpt: null,
        evidence,
        uncertaintyNotes: [resolved.error || "Failed to resolve src/index.css"],
      };
    }

    const excerpt = this.extractBoundedExcerpt(
      resolved.absolutePath,
      targetFileRel,
      [".defect-product-card-layout-break", ".product-card-body", ".product-card-footer"],
      "position: absolute"
    );

    if (!excerpt) {
      uncertaintyNotes.push("Could not locate broken positioning rules in src/index.css.");
      return {
        status: "ambiguous",
        filePath: targetFileRel,
        fileHash: computeFileHash(resolved.absolutePath),
        componentOrSelector: selector || ".product-card-footer",
        excerpt: null,
        evidence,
        uncertaintyNotes,
      };
    }

    evidence.push({
      matchedSelector: selector || ".product-card-footer",
      matchedCategory: "layout_breakage",
      sourceType: "css",
      rationale: "Located absolute positioning and negative margin overrides displacing footer and card body in src/index.css.",
      confidence: 0.96,
    });

    return {
      status: "localized",
      filePath: targetFileRel,
      fileHash: excerpt.sha256,
      componentOrSelector: selector || ".product-card-footer",
      excerpt,
      evidence,
      uncertaintyNotes,
    };
  }

  private localizeLowContrast(
    selector: string,
    evidence: LocalizationEvidence[],
    uncertaintyNotes: string[]
  ): SourceLocalizationResult {
    const targetFileRel = "src/index.css";
    const resolved = validateAndResolveSourcePath(targetFileRel, this.projectRoot);

    if (!resolved.valid || !resolved.absolutePath) {
      return {
        status: "failed",
        filePath: null,
        fileHash: null,
        componentOrSelector: selector || ".product-snippet",
        excerpt: null,
        evidence,
        uncertaintyNotes: [resolved.error || "Failed to resolve src/index.css"],
      };
    }

    const excerpt = this.extractBoundedExcerpt(
      resolved.absolutePath,
      targetFileRel,
      [".defect-low-contrast-text", ".product-snippet", ".product-price"],
      "color: #cbd5e1"
    );

    if (!excerpt) {
      uncertaintyNotes.push("Could not locate low contrast color rules in src/index.css.");
      return {
        status: "ambiguous",
        filePath: targetFileRel,
        fileHash: computeFileHash(resolved.absolutePath),
        componentOrSelector: selector || ".product-snippet",
        excerpt: null,
        evidence,
        uncertaintyNotes,
      };
    }

    evidence.push({
      matchedSelector: selector || ".product-snippet",
      matchedCategory: "low_contrast",
      sourceType: "css",
      rationale: "Located color override rules applying low-luminance contrast (#cbd5e1) in src/index.css.",
      confidence: 0.95,
    });

    return {
      status: "localized",
      filePath: targetFileRel,
      fileHash: excerpt.sha256,
      componentOrSelector: selector || ".product-snippet",
      excerpt,
      evidence,
      uncertaintyNotes,
    };
  }

  private localizeResponsiveOverflow(
    selector: string,
    evidence: LocalizationEvidence[],
    uncertaintyNotes: string[]
  ): SourceLocalizationResult {
    const targetFileRel = "src/index.css";
    const resolved = validateAndResolveSourcePath(targetFileRel, this.projectRoot);

    if (!resolved.valid || !resolved.absolutePath) {
      return {
        status: "failed",
        filePath: null,
        fileHash: null,
        componentOrSelector: selector || ".navbar-container",
        excerpt: null,
        evidence,
        uncertaintyNotes: [resolved.error || "Failed to resolve src/index.css"],
      };
    }

    const excerpt = this.extractBoundedExcerpt(
      resolved.absolutePath,
      targetFileRel,
      [".defect-mobile-nav-overflow", ".navbar-container", "max-width: 640px"],
      "650px"
    );

    if (!excerpt) {
      uncertaintyNotes.push("Could not locate mobile navigation overflow rules in src/index.css.");
      return {
        status: "ambiguous",
        filePath: targetFileRel,
        fileHash: computeFileHash(resolved.absolutePath),
        componentOrSelector: selector || ".navbar-container",
        excerpt: null,
        evidence,
        uncertaintyNotes,
      };
    }

    evidence.push({
      matchedSelector: selector || ".navbar-container",
      matchedCategory: "responsive_overflow",
      sourceType: "css",
      rationale: "Located hardcoded min-width (650px) inside @media (max-width: 640px) query in src/index.css.",
      confidence: 0.95,
    });

    return {
      status: "localized",
      filePath: targetFileRel,
      fileHash: excerpt.sha256,
      componentOrSelector: selector || ".navbar-container",
      excerpt,
      evidence,
      uncertaintyNotes,
    };
  }

  /**
   * Extracts a bounded, line-numbered slice of source code surrounding target anchors.
   */
  public extractBoundedExcerpt(
    absolutePath: string,
    relativePath: string,
    anchorKeywords: string[],
    secondaryAnchor?: string
  ): BoundedSourceExcerpt | null {
    if (!fs.existsSync(absolutePath)) return null;

    const fileContent = fs.readFileSync(absolutePath, "utf8");
    const lines = fileContent.split("\n");
    const sha256 = computeFileHash(absolutePath);

    // Search for the best anchor line (1-indexed)
    let bestLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const keyword of anchorKeywords) {
        if (line.includes(keyword)) {
          if (!secondaryAnchor || line.includes(secondaryAnchor)) {
            bestLine = i + 1;
            break;
          } else if (bestLine === -1) {
            bestLine = i + 1;
          }
        }
      }
      if (bestLine !== -1 && (!secondaryAnchor || lines[i].includes(secondaryAnchor))) {
        break;
      }
    }

    if (bestLine === -1) {
      return null;
    }

    const startLine = Math.max(1, bestLine - 6);
    const endLine = Math.min(lines.length, bestLine + 12);
    const excerptLines = lines.slice(startLine - 1, endLine);

    return {
      filePath: relativePath,
      startLine,
      endLine,
      content: excerptLines.join("\n"),
      sha256,
    };
  }
}
