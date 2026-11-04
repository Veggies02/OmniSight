import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { assertNoGroundTruthLeakage, sanitizeDomSnapshot } from "./vlm/evidence-sanitizer";

export interface EvaluationScenarioMapping {
  caseId: string;
  scenarioId: string;
  expectedCategory: string;
  canonicalCategory: string;
  expectedSymptom: string;
  targetComponent: string;
  targetRoute: string;
  viewport: { width: number; height: number };
  isMobile: boolean;
}

export const EVALUATION_SCENARIOS: EvaluationScenarioMapping[] = [
  {
    caseId: "case_01",
    scenarioId: "product-image-distortion",
    expectedCategory: "visual-distortion",
    canonicalCategory: "image_distortion",
    expectedSymptom: "The product image aspect ratio is distorted with extreme height skew and unnatural object stretch.",
    targetComponent: "ProductCard",
    targetRoute: "/products",
    viewport: { width: 1440, height: 900 },
    isMobile: false,
  },
  {
    caseId: "case_02",
    scenarioId: "product-card-layout-break",
    expectedCategory: "layout-shift",
    canonicalCategory: "layout_breakage",
    expectedSymptom: "Card body items overlap vertically and action buttons overflow out of the card boundaries.",
    targetComponent: "ProductCard",
    targetRoute: "/products",
    viewport: { width: 1440, height: 900 },
    isMobile: false,
  },
  {
    caseId: "case_03",
    scenarioId: "low-contrast-text",
    expectedCategory: "color-contrast",
    canonicalCategory: "low_contrast",
    expectedSymptom: "Product description text and prices have contrast ratios well below 3:1 on light backgrounds.",
    targetComponent: "ProductCard",
    targetRoute: "/products",
    viewport: { width: 1440, height: 900 },
    isMobile: false,
  },
  {
    caseId: "case_04",
    scenarioId: "mobile-nav-overflow",
    expectedCategory: "responsive-overflow",
    canonicalCategory: "responsive_overflow",
    expectedSymptom: "document.documentElement.scrollWidth exceeds clientWidth at 390px mobile viewport.",
    targetComponent: "Navbar",
    targetRoute: "/*",
    viewport: { width: 390, height: 844 },
    isMobile: true,
  },
];

export interface PrepareOptions {
  sourceRunDir?: string;
  outputDir?: string;
  copyImages?: boolean;
  createArchives?: boolean;
}

export interface PrepareResult {
  success: boolean;
  totalCases: number;
  defectiveCases: number;
  baselineCases: number;
  outputDir: string;
  modelOnlyZipPath?: string;
  metadataZipPath?: string;
}

/**
 * Creates two isolated ZIP archives:
 * 1. omnisight-yuvraj-model-inputs-v2.zip (Contains ONLY model_inputs/ with screenshots, evidence.json, and sanitized dom.html)
 * 2. omnisight-yuvraj-evaluation-metadata-v2.zip (Contains scoring/ground_truth.json, dataset_manifest.json, and DATASET_README.md)
 */
export function createEvaluationZipArchives(
  bundleDir: string = path.join(process.cwd(), "omnisight-yuvraj-evaluation"),
  targetDir: string = process.cwd()
): { modelOnlyZipPath: string; metadataZipPath: string } {
  const modelOnlyZipPath = path.join(targetDir, "omnisight-yuvraj-model-inputs-v2.zip");
  const metadataZipPath = path.join(targetDir, "omnisight-yuvraj-evaluation-metadata-v2.zip");

  // Remove existing archives if present
  if (fs.existsSync(modelOnlyZipPath)) fs.unlinkSync(modelOnlyZipPath);
  if (fs.existsSync(metadataZipPath)) fs.unlinkSync(metadataZipPath);

  // Archive A: Model-only package (Strictly model_inputs/ ONLY)
  execSync(`cd "${bundleDir}" && zip -r "${modelOnlyZipPath}" model_inputs/`, { stdio: "pipe" });

  // Archive B: Evaluator metadata package (Ground truth, manifest, documentation ONLY)
  execSync(
    `cd "${bundleDir}" && zip -r "${metadataZipPath}" scoring/ground_truth.json dataset_manifest.json DATASET_README.md`,
    { stdio: "pipe" }
  );

  return { modelOnlyZipPath, metadataZipPath };
}

export function prepareEvaluationBundle(options: PrepareOptions = {}): PrepareResult {
  const baseDir = process.cwd();
  const sourceRunDir =
    options.sourceRunDir ||
    path.join(baseDir, "artifacts/visual-evidence/run-2026-10-13T17-36-08-002Z");
  const outputDir =
    options.outputDir || path.join(baseDir, "omnisight-yuvraj-evaluation");
  const copyImages = options.copyImages ?? true;
  const createArchives = options.createArchives ?? true;

  if (!fs.existsSync(sourceRunDir)) {
    throw new Error(`Source evidence run directory does not exist: ${sourceRunDir}`);
  }

  const defModelInputs = path.join(outputDir, "model_inputs", "defective");
  const baseModelInputs = path.join(outputDir, "model_inputs", "baseline");
  const scoringDir = path.join(outputDir, "scoring");

  fs.mkdirSync(defModelInputs, { recursive: true });
  fs.mkdirSync(baseModelInputs, { recursive: true });
  fs.mkdirSync(scoringDir, { recursive: true });

  const manifestCases: any[] = [];

  for (const sc of EVALUATION_SCENARIOS) {
    const scDir = path.join(sourceRunDir, sc.scenarioId);

    // 1. Defective Case
    const defCaseDir = path.join(defModelInputs, sc.caseId);
    fs.mkdirSync(defCaseDir, { recursive: true });

    if (copyImages) {
      const srcDefPng = path.join(scDir, "defective.png");
      if (fs.existsSync(srcDefPng)) {
        fs.copyFileSync(srcDefPng, path.join(defCaseDir, "screenshot.png"));
      }
    }

    // Read and sanitize defective DOM snapshot before writing
    const srcDefDom = path.join(scDir, "dom-defective.html");
    if (fs.existsSync(srcDefDom)) {
      const rawDefDom = fs.readFileSync(srcDefDom, "utf8");
      const sanitizedDefDom = sanitizeDomSnapshot(rawDefDom);
      assertNoGroundTruthLeakage(sanitizedDefDom);
      fs.writeFileSync(path.join(defCaseDir, "dom.html"), sanitizedDefDom, "utf8");
    }

    const mDefPath = path.join(scDir, "measurements-defective.json");
    const mDef = fs.existsSync(mDefPath) ? JSON.parse(fs.readFileSync(mDefPath, "utf8")) : {};

    const defEvidence = {
      case_id: sc.caseId,
      step_name: "not_recorded",
      screenshot_path: "screenshot.png",
      dom_path: "dom.html",
      page_title: "OmniShop — Modern Curated Essentials",
      route: sc.targetRoute === "/*" ? "/products" : sc.targetRoute,
      url: "http://127.0.0.1:5173/products",
      viewport: sc.viewport,
      is_mobile: sc.isMobile,
      browser: "chromium",
      capture_mode: "viewport",
      document_metrics: mDef.documentMetrics || {},
      element_bounding_boxes: mDef.elementBoundingBoxes || {},
      computed_styles: mDef.computedStyles || {},
      console_errors: [],
    };

    const defEvidenceStr = JSON.stringify(defEvidence, null, 2);
    assertNoGroundTruthLeakage(defEvidenceStr);
    fs.writeFileSync(path.join(defCaseDir, "evidence.json"), defEvidenceStr, "utf8");

    manifestCases.push({
      case_id: sc.caseId,
      designation: "defective",
      step_name: "not_recorded",
      route: defEvidence.route,
      viewport: sc.viewport,
      is_mobile: sc.isMobile,
      screenshot_path: `model_inputs/defective/${sc.caseId}/screenshot.png`,
      screenshot_dimensions: sc.viewport,
      screenshot_format: "PNG",
      capture_mode: "viewport",
      evidence_json_path: `model_inputs/defective/${sc.caseId}/evidence.json`,
      dom_path: `model_inputs/defective/${sc.caseId}/dom.html`,
    });

    // 2. Baseline Case
    const baseCaseDir = path.join(baseModelInputs, sc.caseId);
    fs.mkdirSync(baseCaseDir, { recursive: true });

    if (copyImages) {
      const srcBasePng = path.join(scDir, "baseline.png");
      if (fs.existsSync(srcBasePng)) {
        fs.copyFileSync(srcBasePng, path.join(baseCaseDir, "screenshot.png"));
      }
    }

    // Read and sanitize baseline DOM snapshot before writing
    const srcBaseDom = path.join(scDir, "dom-baseline.html");
    if (fs.existsSync(srcBaseDom)) {
      const rawBaseDom = fs.readFileSync(srcBaseDom, "utf8");
      const sanitizedBaseDom = sanitizeDomSnapshot(rawBaseDom);
      assertNoGroundTruthLeakage(sanitizedBaseDom);
      fs.writeFileSync(path.join(baseCaseDir, "dom.html"), sanitizedBaseDom, "utf8");
    }

    const mBasePath = path.join(scDir, "measurements-baseline.json");
    const mBase = fs.existsSync(mBasePath) ? JSON.parse(fs.readFileSync(mBasePath, "utf8")) : {};

    const baseEvidence = {
      case_id: sc.caseId,
      step_name: "not_recorded",
      screenshot_path: "screenshot.png",
      dom_path: "dom.html",
      page_title: "OmniShop — Modern Curated Essentials",
      route: sc.targetRoute === "/*" ? "/products" : sc.targetRoute,
      url: "http://127.0.0.1:5173/products",
      viewport: sc.viewport,
      is_mobile: sc.isMobile,
      browser: "chromium",
      capture_mode: "viewport",
      document_metrics: mBase.documentMetrics || {},
      element_bounding_boxes: mBase.elementBoundingBoxes || {},
      computed_styles: mBase.computedStyles || {},
      console_errors: [],
    };

    const baseEvidenceStr = JSON.stringify(baseEvidence, null, 2);
    assertNoGroundTruthLeakage(baseEvidenceStr);
    fs.writeFileSync(path.join(baseCaseDir, "evidence.json"), baseEvidenceStr, "utf8");

    manifestCases.push({
      case_id: sc.caseId,
      designation: "baseline",
      step_name: "not_recorded",
      route: baseEvidence.route,
      viewport: sc.viewport,
      is_mobile: sc.isMobile,
      screenshot_path: `model_inputs/baseline/${sc.caseId}/screenshot.png`,
      screenshot_dimensions: sc.viewport,
      screenshot_format: "PNG",
      capture_mode: "viewport",
      evidence_json_path: `model_inputs/baseline/${sc.caseId}/evidence.json`,
      dom_path: `model_inputs/baseline/${sc.caseId}/dom.html`,
    });
  }

  // 3. Isolated Ground Truth Scoring File
  const groundTruth = EVALUATION_SCENARIOS.map((sc) => ({
    case_id: sc.caseId,
    scenario_id: sc.scenarioId,
    expected_category: sc.expectedCategory,
    canonical_category: sc.canonicalCategory,
    expected_symptom: sc.expectedSymptom,
    target_component: sc.targetComponent,
    target_route: sc.targetRoute,
    viewport: sc.viewport,
    is_mobile: sc.isMobile,
  }));
  fs.writeFileSync(
    path.join(scoringDir, "ground_truth.json"),
    JSON.stringify(groundTruth, null, 2),
    "utf8"
  );

  // 4. Dataset Manifest
  const manifestData = {
    dataset_name: "omnisight-yuvraj-evaluation",
    version: "2.0.0",
    source_run_id: path.basename(sourceRunDir),
    created_at: new Date().toISOString(),
    total_cases: manifestCases.length,
    defective_cases_count: 4,
    baseline_cases_count: 4,
    cases: manifestCases,
  };
  fs.writeFileSync(
    path.join(outputDir, "dataset_manifest.json"),
    JSON.stringify(manifestData, null, 2),
    "utf8"
  );

  let modelOnlyZipPath: string | undefined;
  let metadataZipPath: string | undefined;

  if (createArchives) {
    const archives = createEvaluationZipArchives(outputDir, baseDir);
    modelOnlyZipPath = archives.modelOnlyZipPath;
    metadataZipPath = archives.metadataZipPath;
  }

  return {
    success: true,
    totalCases: manifestCases.length,
    defectiveCases: 4,
    baselineCases: 4,
    outputDir,
    modelOnlyZipPath,
    metadataZipPath,
  };
}

// CLI execution
const isDirectCall =
  process.argv[1] &&
  (import.meta.url.endsWith(process.argv[1]) ||
    import.meta.url.endsWith(path.basename(process.argv[1])));

if (isDirectCall) {
  const result = prepareEvaluationBundle();
  console.log(`Successfully prepared evaluation bundle with ${result.totalCases} cases at: ${result.outputDir}`);
  if (result.modelOnlyZipPath && result.metadataZipPath) {
    console.log(`Created model-only package: ${result.modelOnlyZipPath}`);
    console.log(`Created evaluator package:  ${result.metadataZipPath}`);
  }
}
