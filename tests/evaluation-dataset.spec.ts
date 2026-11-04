import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import {
  assertNoGroundTruthLeakage,
  FORBIDDEN_LEAKAGE_TOKENS,
  sanitizeDomSnapshot,
  sanitizeUrlOrRoute,
} from "../scripts/vlm/evidence-sanitizer";
import { stripInspectionMetadataFromDom } from "../scripts/evidence-helpers";
import {
  prepareEvaluationBundle,
  createEvaluationZipArchives,
  EVALUATION_SCENARIOS,
} from "../scripts/prepare-evaluation-bundle";

test.describe("OmniSight Evaluation Dataset Bundle Verification", () => {
  // Execute sequentially to prevent race conditions on shared zip archive creation
  test.describe.configure({ mode: "serial" });

  const bundleDir = path.resolve(process.cwd(), "omnisight-yuvraj-evaluation");
  const modelOnlyZip = path.resolve(process.cwd(), "omnisight-yuvraj-model-inputs-v2.zip");
  const metadataZip = path.resolve(process.cwd(), "omnisight-yuvraj-evaluation-metadata-v2.zip");

  test("prepares evaluation bundle and generates isolated ZIP archives", () => {
    const result = prepareEvaluationBundle({ copyImages: true, createArchives: true });
    expect(result.success).toBe(true);
    expect(result.totalCases).toBe(8);
    expect(result.defectiveCases).toBe(4);
    expect(result.baselineCases).toBe(4);
    expect(fs.existsSync(modelOnlyZip)).toBe(true);
    expect(fs.existsSync(metadataZip)).toBe(true);
  });

  test("contains exactly 4 defective and 4 baseline cases (8 total inputs)", () => {
    const defectiveDir = path.join(bundleDir, "model_inputs", "defective");
    const baselineDir = path.join(bundleDir, "model_inputs", "baseline");

    expect(fs.existsSync(defectiveDir)).toBe(true);
    expect(fs.existsSync(baselineDir)).toBe(true);

    const defCases = fs.readdirSync(defectiveDir).filter((d) => d.startsWith("case_")).sort();
    const baseCases = fs.readdirSync(baselineDir).filter((d) => d.startsWith("case_")).sort();

    expect(defCases).toEqual(["case_01", "case_02", "case_03", "case_04"]);
    expect(baseCases).toEqual(["case_01", "case_02", "case_03", "case_04"]);
  });

  test("every case has valid screenshot, DOM snapshot, and evidence JSON files", () => {
    for (const group of ["defective", "baseline"]) {
      for (const caseId of ["case_01", "case_02", "case_03", "case_04"]) {
        const caseDir = path.join(bundleDir, "model_inputs", group, caseId);
        const screenshotPath = path.join(caseDir, "screenshot.png");
        const domPath = path.join(caseDir, "dom.html");
        const evidencePath = path.join(caseDir, "evidence.json");

        expect(fs.existsSync(screenshotPath), `Missing screenshot in ${caseDir}`).toBe(true);
        expect(fs.existsSync(domPath), `Missing dom.html in ${caseDir}`).toBe(true);
        expect(fs.existsSync(evidencePath), `Missing evidence.json in ${caseDir}`).toBe(true);

        const imgStats = fs.statSync(screenshotPath);
        expect(imgStats.size).toBeGreaterThan(10_000); // Valid PNG file

        const domContent = fs.readFileSync(domPath, "utf8");
        expect(domContent.length).toBeGreaterThan(100);
      }
    }
  });

  test("each case provides evidence.json conforming to full normalized schema", () => {
    for (const group of ["defective", "baseline"]) {
      for (const caseId of ["case_01", "case_02", "case_03", "case_04"]) {
        const evidencePath = path.join(bundleDir, "model_inputs", group, caseId, "evidence.json");
        const data = JSON.parse(fs.readFileSync(evidencePath, "utf8"));

        expect(data.case_id).toBe(caseId);
        expect(data.step_name).toBe("not_recorded");
        expect(data.screenshot_path).toBe("screenshot.png");
        expect(data.dom_path).toBe("dom.html");
        expect(data.url).toMatch(/^http:\/\/127\.0\.0\.1:5173\//);
        expect(data.route).toBeDefined();
        expect(typeof data.viewport.width).toBe("number");
        expect(typeof data.viewport.height).toBe("number");
        expect(typeof data.is_mobile).toBe("boolean");
        expect(data.document_metrics).toBeDefined();
        expect(typeof data.document_metrics.clientWidth).toBe("number");
        expect(typeof data.document_metrics.scrollWidth).toBe("number");
        expect(data.element_bounding_boxes).toBeDefined();
        expect(data.computed_styles).toBeDefined();
      }
    }
  });

  test("leakage tests: DOM snapshots and evidence JSON files are free of all forbidden tokens", () => {
    const modelInputsDir = path.join(bundleDir, "model_inputs");

    function walkDir(dir: string, fileList: string[] = []): string[] {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          walkDir(fullPath, fileList);
        } else if (file.endsWith(".json") || file.endsWith(".html")) {
          fileList.push(fullPath);
        }
      }
      return fileList;
    }

    const filesToCheck = walkDir(modelInputsDir);
    expect(filesToCheck.length).toBe(16); // 8 evidence.json + 8 dom.html

    for (const filePath of filesToCheck) {
      const content = fs.readFileSync(filePath, "utf8");

      // Verify no forbidden leakage tokens
      expect(() => assertNoGroundTruthLeakage(content)).not.toThrow();

      // Explicit targeted assertions
      expect(content).not.toContain("/Users/");
      expect(content).not.toContain("data-vite-dev-id");
      expect(content).not.toMatch(/Defect\s+[1-4]\b/i);
      expect(content).not.toMatch(/Controlled UI Defect Scenarios/i);
      expect(content).not.toContain("expected_category");
      expect(content).not.toContain("expected_symptom");
      expect(content).not.toContain("omnisight-defect-metadata");
    }
  });

  test("preservation tests: legitimate diagnostic CSS declarations and DOM structures are intact", () => {
    // case_01 defective: image distortion declarations
    const dom01Def = fs.readFileSync(
      path.join(bundleDir, "model_inputs", "defective", "case_01", "dom.html"),
      "utf8"
    );
    expect(dom01Def).toContain("object-fit: fill;");
    expect(dom01Def).toContain("380px;");
    expect(dom01Def).toContain("product-card");

    // case_02 defective: layout break declarations
    const dom02Def = fs.readFileSync(
      path.join(bundleDir, "model_inputs", "defective", "case_02", "dom.html"),
      "utf8"
    );
    expect(dom02Def).toContain("margin-top: -40px;");
    expect(dom02Def).toContain("bottom: -45px;");

    // case_03 defective: low-contrast color value
    const dom03Def = fs.readFileSync(
      path.join(bundleDir, "model_inputs", "defective", "case_03", "dom.html"),
      "utf8"
    );
    expect(dom03Def).toContain("#cbd5e1");

    // case_04 defective: mobile nav overflow width
    const dom04Def = fs.readFileSync(
      path.join(bundleDir, "model_inputs", "defective", "case_04", "dom.html"),
      "utf8"
    );
    expect(dom04Def).toContain("650px;");
    expect(dom04Def).toContain("navbar");

    // Verify computed styles in evidence.json
    const ev01Def = JSON.parse(
      fs.readFileSync(
        path.join(bundleDir, "model_inputs", "defective", "case_01", "evidence.json"),
        "utf8"
      )
    );
    expect(ev01Def.computed_styles["image.objectFit"]).toBe("fill");
    expect(ev01Def.computed_styles["image.height"]).toBe("380px");

    // Verify baseline computed styles
    const ev01Base = JSON.parse(
      fs.readFileSync(
        path.join(bundleDir, "model_inputs", "baseline", "case_01", "evidence.json"),
        "utf8"
      )
    );
    expect(ev01Base.computed_styles["image.objectFit"]).toBe("cover");
    expect(ev01Base.computed_styles["image.height"]).toBe("265px");
  });

  test("scoring/ground_truth.json is strictly separated and correctly mapped", () => {
    const gtPath = path.join(bundleDir, "scoring", "ground_truth.json");
    expect(fs.existsSync(gtPath)).toBe(true);

    const gt = JSON.parse(fs.readFileSync(gtPath, "utf8"));
    expect(Array.isArray(gt)).toBe(true);
    expect(gt).toHaveLength(4);

    const caseIds = gt.map((g: any) => g.case_id).sort();
    expect(caseIds).toEqual(["case_01", "case_02", "case_03", "case_04"]);

    const expectedScenarios = EVALUATION_SCENARIOS.map((s) => s.scenarioId).sort();
    const actualScenarios = gt.map((g: any) => g.scenario_id).sort();
    expect(actualScenarios).toEqual(expectedScenarios);

    for (const entry of gt) {
      expect(entry.expected_category).toBeDefined();
      expect(entry.canonical_category).toBeDefined();
      expect(entry.expected_symptom).toBeDefined();
    }
  });

  test("dataset_manifest.json indexes all 8 cases and references resolve", () => {
    const manifestPath = path.join(bundleDir, "dataset_manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.total_cases).toBe(8);
    expect(manifest.defective_cases_count).toBe(4);
    expect(manifest.baseline_cases_count).toBe(4);
    expect(manifest.cases).toHaveLength(8);

    for (const c of manifest.cases) {
      expect(c.step_name).toBe("not_recorded");
      const evidenceFullPath = path.join(bundleDir, c.evidence_json_path);
      expect(fs.existsSync(evidenceFullPath)).toBe(true);

      const domFullPath = path.join(bundleDir, c.dom_path);
      expect(fs.existsSync(domFullPath)).toBe(true);
    }
  });

  test("DATASET_README.md documentation covers dual packages, schemas, and usage", () => {
    const readmePath = path.join(bundleDir, "DATASET_README.md");
    expect(fs.existsSync(readmePath)).toBe(true);

    const content = fs.readFileSync(readmePath, "utf8");
    expect(content).toContain("OmniSight Multimodal UI Defect Evaluation Dataset");
    expect(content).toContain("omnisight-yuvraj-model-inputs-v2.zip");
    expect(content).toContain("omnisight-yuvraj-evaluation-metadata-v2.zip");
    expect(content).toContain("step_name");
    expect(content).toContain("Ground-Truth Isolation");
  });

  test("ZIP Archives: Archive A is model-only and Archive B is evaluator metadata only", () => {
    expect(fs.existsSync(modelOnlyZip)).toBe(true);
    expect(fs.existsSync(metadataZip)).toBe(true);

    // Verify integrity
    expect(() => execFileSync("unzip", ["-t", modelOnlyZip], { stdio: "pipe" })).not.toThrow();
    expect(() => execFileSync("unzip", ["-t", metadataZip], { stdio: "pipe" })).not.toThrow();

    // Check Archive A listing: must NOT contain scoring/, ground_truth, manifest, or README
    const modelOnlyListing = execFileSync("unzip", ["-l", modelOnlyZip], { encoding: "utf8" });
    expect(modelOnlyListing).toContain("model_inputs/");
    expect(modelOnlyListing).not.toContain("scoring/");
    expect(modelOnlyListing).not.toContain("ground_truth.json");
    expect(modelOnlyListing).not.toContain("dataset_manifest.json");
    expect(modelOnlyListing).not.toContain("DATASET_README.md");

    // Check Archive B listing: must contain ground_truth, manifest, README, and NO screenshots
    const metadataListing = execFileSync("unzip", ["-l", metadataZip], { encoding: "utf8" });
    expect(metadataListing).toContain("scoring/ground_truth.json");
    expect(metadataListing).toContain("dataset_manifest.json");
    expect(metadataListing).toContain("DATASET_README.md");
    expect(metadataListing).not.toContain(".png");
    expect(metadataListing).not.toContain("model_inputs/");
  });

  test("SEC-01 Regression: sanitizeUrlOrRoute strips defect query parameters and preserves legitimate routes/params", () => {
    // 1. Defective absolute URL
    const url1 = "http://127.0.0.1:5173/products?defect=product-image-distortion";
    expect(sanitizeUrlOrRoute(url1)).toBe("http://127.0.0.1:5173/products");

    // 2. Multi-param URL preserving other params
    const url2 = "http://127.0.0.1:5173/products?category=audio&defect=low-contrast-text&sort=price";
    expect(sanitizeUrlOrRoute(url2)).toBe("http://127.0.0.1:5173/products?category=audio&sort=price");

    // 3. Relative route with defect parameter
    const route1 = "/products?defect=mobile-nav-overflow";
    expect(sanitizeUrlOrRoute(route1)).toBe("/products");

    // 4. Relative route with hash and multiple params
    const route2 = "/products?page=2&defect=product-card-layout-break#section";
    expect(sanitizeUrlOrRoute(route2)).toBe("/products?page=2#section");

    // 5. Clean URL and route unchanged
    expect(sanitizeUrlOrRoute("http://127.0.0.1:5173/products")).toBe("http://127.0.0.1:5173/products");
    expect(sanitizeUrlOrRoute("/products")).toBe("/products");
    expect(sanitizeUrlOrRoute("/*")).toBe("/*");

    // 6. assertNoGroundTruthLeakage catches un-sanitized URLs (both by defect token and by query parameter)
    expect(() => assertNoGroundTruthLeakage(url1)).toThrow(/LEAKAGE DETECTED/);
    expect(() => assertNoGroundTruthLeakage(route1)).toThrow(/LEAKAGE DETECTED/);
    expect(() => assertNoGroundTruthLeakage("/products?defect=unknown_custom_id")).toThrow(/query parameter/);
    expect(() => assertNoGroundTruthLeakage(sanitizeUrlOrRoute(url1))).not.toThrow();

    // 7. SEC-URL-01 & SEC-URL-02: Kebab-case params, inject-defect, and SPA hash queries
    const urlKebab = "http://127.0.0.1:5173/products?defect-id=custom-benchmark&sort=asc";
    expect(sanitizeUrlOrRoute(urlKebab)).toBe("http://127.0.0.1:5173/products?sort=asc");

    const urlInject = "http://127.0.0.1:5173/products?inject-defect=true&category=shoes";
    expect(sanitizeUrlOrRoute(urlInject)).toBe("http://127.0.0.1:5173/products?category=shoes");

    const urlInject2 = "http://127.0.0.1:5173/products?inject_defect=true";
    expect(sanitizeUrlOrRoute(urlInject2)).toBe("http://127.0.0.1:5173/products");

    const urlInject3 = "http://127.0.0.1:5173/products?injectDefect=true";
    expect(sanitizeUrlOrRoute(urlInject3)).toBe("http://127.0.0.1:5173/products");

    const spaHashRoute = "/products#section?defect=product-image-distortion&filter=true";
    expect(sanitizeUrlOrRoute(spaHashRoute)).toBe("/products#section?filter=true");

    const spaHashRoute2 = "/#/products?defect=mobile-nav-overflow&sort=desc";
    expect(sanitizeUrlOrRoute(spaHashRoute2)).toBe("/#/products?sort=desc");

    const encodedPath = "/products%3Fdefect=product-image-distortion";
    expect(sanitizeUrlOrRoute(encodedPath)).toBe("/products");
  });

  test("SEC-02 Regression: stripInspectionMetadataFromDom removes CSS comments and scripts while preserving declarations", () => {
    const rawHtml = `
      <style>
        /* Defect 1: Product Image Distortion */
        /* Controlled UI Defect Scenarios */
        .product-image { object-fit: fill; width: 100%; }
      </style>
      <script>console.log("vite");</script>
      <div class="product-card"></div>
    `;

    const cleaned = stripInspectionMetadataFromDom(rawHtml);
    expect(cleaned).not.toContain("Defect 1");
    expect(cleaned).not.toContain("Controlled UI");
    expect(cleaned).not.toContain("<script>");
    expect(cleaned).toContain("object-fit: fill");
    expect(cleaned).toContain("product-card");
  });

  test("SEC-03 & SEC-DOM-01 Regression: data-defect-* attributes (double, single, unquoted, valueless) are stripped cleanly", () => {
    const rawHtml = `
      <article
        class="product-card"
        data-product-id="prod-1"
        data-defect-applied="mobile-nav-overflow"
        data-defect-single='product-image-distortion'
        data-defect-unquoted=custom-val
        data-defect-custom="val123"
        data-defect-foo
        data-testid="product-card-1"
        aria-label="Product Card"
      >
        <span data-discover="true">Test</span>
      </article>
    `;

    const cleaned = sanitizeDomSnapshot(rawHtml);
    // Defect attributes stripped without orphaned characters or malformed HTML
    expect(cleaned).not.toContain("data-defect-applied");
    expect(cleaned).not.toContain("data-defect-single");
    expect(cleaned).not.toContain("data-defect-unquoted");
    expect(cleaned).not.toContain("data-defect-custom");
    expect(cleaned).not.toContain("data-defect-foo");
    expect(cleaned).not.toContain("='product-image-distortion'");
    expect(cleaned).not.toContain("=custom-val");
    expect(cleaned).not.toContain("<article='");

    // Application attributes preserved
    expect(cleaned).toContain('data-product-id="prod-1"');
    expect(cleaned).toContain('data-testid="product-card-1"');
    expect(cleaned).toContain('aria-label="Product Card"');
    expect(cleaned).toContain('data-discover="true"');
  });

  test("SEC-04 & SEC-DOM-02 Regression: selector cleaning preserves legitimate compound selectors and hyphenated classes", () => {
    const rawCss = `
      .navbar.defect-mobile-nav-overflow .navbar-container { width: 650px; }
      .defect-product-card-layout-break .product-card-body { position: relative; }
      .btn.btn-primary { background: blue; }
      .nav-link.nav-link-active { font-weight: bold; }
      .product-card.non-defect-card { border: 1px solid green; }
    `;

    const cleanedCss = sanitizeDomSnapshot(rawCss);
    // Defect class removed from compound selector without selector corruption or trailing dots
    expect(cleanedCss).toContain(".navbar .navbar-container");
    expect(cleanedCss).not.toContain("defect-mobile-nav-overflow");
    expect(cleanedCss).not.toContain(".navbar.product-cardnavbar-container");
    expect(cleanedCss).not.toContain(".navbar.");

    // Standalone defect selector mapped to component
    expect(cleanedCss).toContain(".product-card .product-card-body");
    expect(cleanedCss).not.toContain("defect-product-card-layout-break");

    // Legitimate adjacent class selectors preserved untouched
    expect(cleanedCss).toContain(".btn.btn-primary");
    expect(cleanedCss).toContain(".nav-link.nav-link-active");
    expect(cleanedCss).toContain(".product-card.non-defect-card");
    expect(cleanedCss).not.toContain(".product-card.non- ");

    // HTML class attributes: preserves legitimate hyphenated classes
    const rawHtml = `<div class="product-card non-defect-card anti-defect-system defect-product-image-distortion active">Content</div>`;
    const cleanedHtml = sanitizeDomSnapshot(rawHtml);
    expect(cleanedHtml).toContain("non-defect-card");
    expect(cleanedHtml).toContain("anti-defect-system");
    expect(cleanedHtml).toContain("active");
    expect(cleanedHtml).not.toContain("defect-product-image-distortion");
    expect(cleanedHtml).not.toContain("non- ");
    expect(cleanedHtml).not.toContain("anti- ");
  });

  test("SEC-CAL-01 Regression: model_facing_evidence.json uses neutral aliases and paths without leakage", () => {
    const runDir = path.resolve(process.cwd(), "artifacts/visual-evidence/run-2026-10-13T17-36-08-002Z");
    const modelEvidencePath = path.join(runDir, "model_facing_evidence.json");
    expect(fs.existsSync(modelEvidencePath)).toBe(true);

    const content = fs.readFileSync(modelEvidencePath, "utf8");
    // Must pass complete ground truth assertion without throwing
    expect(() => assertNoGroundTruthLeakage(content)).not.toThrow();

    const parsed = JSON.parse(content);
    expect(parsed.scenarios).toHaveLength(4);

    for (let i = 0; i < parsed.scenarios.length; i++) {
      const sc = parsed.scenarios[i];
      // Neutral alias check
      expect(sc.scenarioId).toBe(`scenario_${String(i + 1).padStart(2, "0")}`);
      // Case-based folder paths check
      const expectedCase = `case_${String(i + 1).padStart(2, "0")}`;
      expect(sc.baselineScreenshot).toContain(expectedCase);
      expect(sc.defectiveScreenshot).toContain(expectedCase);
      expect(sc.baselineDom).toContain(expectedCase);
      expect(sc.defectiveDom).toContain(expectedCase);

      // Verify files actually exist on disk through the neutral paths
      expect(fs.existsSync(path.join(runDir, sc.baselineScreenshot))).toBe(true);
      expect(fs.existsSync(path.join(runDir, sc.defectiveScreenshot))).toBe(true);
      expect(fs.existsSync(path.join(runDir, sc.baselineDom))).toBe(true);
      expect(fs.existsSync(path.join(runDir, sc.defectiveDom))).toBe(true);
    }
  });

  test("SEC-AST-01 Regression: assertNoGroundTruthLeakage catches encoded tokens and alternative query spellings", () => {
    // 1. URL encoded token
    const encodedUrl = "http://localhost/products?scenario=product%2Dimage%2Ddistortion";
    expect(() => assertNoGroundTruthLeakage(encodedUrl)).toThrow(/LEAKAGE DETECTED/);

    // 2. HTML decimal entity
    const htmlDec = "<div>&#112;roduct-image-distortion</div>";
    expect(() => assertNoGroundTruthLeakage(htmlDec)).toThrow(/LEAKAGE DETECTED/);

    // 3. HTML hex entity
    const htmlHex = "<div>&#x70;roduct-image-distortion</div>";
    expect(() => assertNoGroundTruthLeakage(htmlHex)).toThrow(/LEAKAGE DETECTED/);

    // 4. Alternative parameter spellings
    expect(() => assertNoGroundTruthLeakage("http://localhost?defect-id=custom")).toThrow(/query parameter/);
    expect(() => assertNoGroundTruthLeakage("http://localhost?inject-defect=true")).toThrow(/query parameter/);
    expect(() => assertNoGroundTruthLeakage("http://localhost?inject_defect=true")).toThrow(/query parameter/);
    expect(() => assertNoGroundTruthLeakage("http://localhost?injectDefect=true")).toThrow(/query parameter/);

    // 5. Clean string with legitimate text passes without false positive
    expect(() => assertNoGroundTruthLeakage("http://localhost/products?search=defect-free")).not.toThrow();
  });

  test("SEC-DOM-04 Regression: sanitizeDomSnapshot strips cross-platform local development paths", () => {
    const rawWithPaths = `
      <div data-trace="/Users/ajaykowkuntla/Desktop/OmniSight/src/app.tsx">
        <span>/home/runner/work/OmniSight/dist/main.js</span>
        <p>C:\\Users\\runneradmin\\workspace\\index.ts</p>
      </div>
    `;

    const cleaned = sanitizeDomSnapshot(rawWithPaths);
    expect(cleaned).not.toContain("/Users/");
    expect(cleaned).not.toContain("/home/runner");
    expect(cleaned).not.toContain("C:\\Users");
    expect(cleaned).toContain("<div");
    expect(cleaned).toContain("<span>");
    expect(cleaned).toContain("<p>");
    expect(cleaned).toContain("</div>");
  });
});
