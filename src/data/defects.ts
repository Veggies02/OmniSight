export type DefectCategory =
  | "visual-distortion"
  | "layout-shift"
  | "color-contrast"
  | "responsive-overflow";

export interface DefectDefinition {
  id: string;
  name: string;
  description: string;
  targetRoute: string;
  targetComponent: string;
  category: DefectCategory;
  expectedSymptom: string;
  cssClass: string;
}

export const DEFECT_REGISTRY: Record<string, DefectDefinition> = {
  "product-image-distortion": {
    id: "product-image-distortion",
    name: "Product Image Distortion",
    description:
      "Forces product image to stretch disproportionately with abnormal aspect ratio and skewed object fit.",
    targetRoute: "/products",
    targetComponent: "ProductCard",
    category: "visual-distortion",
    expectedSymptom:
      "The product image aspect ratio is distorted with extreme height skew and unnatural object stretch.",
    cssClass: "defect-product-image-distortion",
  },
  "product-card-layout-break": {
    id: "product-card-layout-break",
    name: "Product Card Layout Breakage",
    description:
      "Breaks the internal flex alignment and padding of product cards, causing text overlap and misplaced footer actions.",
    targetRoute: "/products",
    targetComponent: "ProductCard",
    category: "layout-shift",
    expectedSymptom:
      "Card body items overlap vertically and action buttons overflow out of the card boundaries.",
    cssClass: "defect-product-card-layout-break",
  },
  "low-contrast-text": {
    id: "low-contrast-text",
    name: "Low-Contrast Text Element",
    description:
      "Renders product description and pricing in low-contrast light grey (#cbd5e1) against a white background, violating WCAG AA accessibility standards.",
    targetRoute: "/products",
    targetComponent: "ProductCard",
    category: "color-contrast",
    expectedSymptom:
      "Product description text and prices have contrast ratios well below 3:1 on light backgrounds.",
    cssClass: "defect-low-contrast-text",
  },
  "mobile-nav-overflow": {
    id: "mobile-nav-overflow",
    name: "Mobile Navigation Overflow",
    description:
      "Forces horizontal inline spacing and unconstrained minimum width on navigation items, resulting in horizontal scrolling on mobile viewports (<640px).",
    targetRoute: "/*",
    targetComponent: "Navbar",
    category: "responsive-overflow",
    expectedSymptom:
      "document.documentElement.scrollWidth exceeds clientWidth at 390px mobile viewport.",
    cssClass: "defect-mobile-nav-overflow",
  },
};

export function isDefectInjectionEnabled(): boolean {
  // If explicitly overridden via window / sessionStorage (e.g. during test run or manual simulation), check that first
  if (typeof window !== "undefined") {
    try {
      const stored = window.sessionStorage.getItem("omnisight:enable-defects");
      if (stored === "true") return true;
      if (stored === "false") return false;
    } catch {
      // Ignore sessionStorage access errors (e.g. privacy mode)
    }
  }

  // Vite environment variables:
  // In development (import.meta.env.DEV === true), defect injection is enabled by default.
  // In production builds (import.meta.env.PROD === true), it is DISABLED by default unless explicitly
  // enabled via VITE_ENABLE_DEFECTS === "true".
  if (import.meta.env?.VITE_ENABLE_DEFECTS !== undefined) {
    return import.meta.env.VITE_ENABLE_DEFECTS === "true";
  }

  return Boolean(import.meta.env?.DEV);
}

export function getDefect(defectId: string | null): DefectDefinition | null {
  if (!defectId) return null;
  if (!isDefectInjectionEnabled()) return null;
  return DEFECT_REGISTRY[defectId] || null;
}
