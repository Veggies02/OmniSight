import { test, expect } from "@playwright/test";

test.describe("Step 4.6 Interactive Before-and-After Evidence Viewer Tests", () => {
  const proposalId = "prop_product-image-distortion_001";

  test("1. renders before-and-after images in side-by-side mode", async ({ page }) => {
    await page.goto(`/review/proposals/${proposalId}`);

    const viewer = page.getByTestId("evidence-viewer-root");
    await expect(viewer).toBeVisible();

    // Side-by-side comparison is the default
    await expect(page.getByTestId("comparison-side-by-side")).toBeVisible();
    await expect(page.getByTestId("side-card-before")).toBeVisible();
    await expect(page.getByTestId("side-card-after")).toBeVisible();

    // Verify images rendered
    await expect(page.getByTestId("defective-image")).toBeVisible();
    await expect(page.getByTestId("baseline-image")).toBeVisible();

    // Verify defect category and resolution badges within the viewer
    await expect(page.getByTestId("side-card-before").getByText("image_distortion")).toBeVisible();
    await expect(page.getByTestId("viewer-viewport")).toHaveText("1440 × 900");
  });

  test("2. displays fallback when before-repair evidence is missing", async ({ page }) => {
    // Populate localStorage with a proposal that has empty before screenshot URL
    await page.goto("/review");
    await page.evaluate(() => {
      const stored = localStorage.getItem("omnisight:review-proposals");
      if (stored) {
        const list = JSON.parse(stored);
        const item = list.find((p: any) => p.proposalId === "prop_product-image-distortion_001");
        if (item && item.visualEvidence) {
          item.visualEvidence.defectiveScreenshotUrl = "";
          localStorage.setItem("omnisight:review-proposals", JSON.stringify(list));
        }
      }
    });

    await page.goto(`/review/proposals/${proposalId}`);

    const fallback = page.getByTestId("defective-placeholder");
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText("Before-repair screenshot not available");
  });

  test("3. displays fallback when post-repair evidence is missing", async ({ page }) => {
    // Populate localStorage with a proposal that has empty after screenshot URL
    await page.goto("/review");
    await page.evaluate(() => {
      const stored = localStorage.getItem("omnisight:review-proposals");
      if (stored) {
        const list = JSON.parse(stored);
        const item = list.find((p: any) => p.proposalId === "prop_product-image-distortion_001");
        if (item && item.visualEvidence) {
          item.visualEvidence.baselineScreenshotUrl = "";
          item.visualEvidence.postRepairScreenshotUrl = "";
          localStorage.setItem("omnisight:review-proposals", JSON.stringify(list));
        }
      }
    });

    await page.goto(`/review/proposals/${proposalId}`);

    const fallback = page.getByTestId("baseline-placeholder");
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText("Post-repair screenshot not available");
  });

  test("4. handles image-loading failures with accessible alert states", async ({ page }) => {
    // Set invalid defective image URL to trigger img onError
    await page.goto("/review");
    await page.evaluate(() => {
      const stored = localStorage.getItem("omnisight:review-proposals");
      if (stored) {
        const list = JSON.parse(stored);
        const item = list.find((p: any) => p.proposalId === "prop_product-image-distortion_001");
        if (item && item.visualEvidence) {
          item.visualEvidence.defectiveScreenshotUrl = "https://invalid-host-omnisight.test/broken.png";
          localStorage.setItem("omnisight:review-proposals", JSON.stringify(list));
        }
      }
    });

    await page.goto(`/review/proposals/${proposalId}`);

    const fallback = page.getByTestId("defective-placeholder");
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveText("Failed to load defective screenshot");
  });

  test("5. switches comparison modes across side-by-side, slider, before-only, after-only", async ({ page }) => {
    await page.goto("/review");
    await page.evaluate(() => {
      localStorage.removeItem("omnisight:review-proposals");
    });
    await page.goto(`/review/proposals/${proposalId}`);

    // 1. Default: side-by-side
    await expect(page.getByTestId("comparison-side-by-side")).toBeVisible();

    // 2. Switch to interactive slider mode
    await page.getByTestId("mode-btn-slider").click();
    await expect(page.getByTestId("comparison-slider")).toBeVisible();
    await expect(page.getByTestId("slider-range-input")).toBeVisible();
    await expect(page.getByTestId("slider-handle")).toBeVisible();

    // 3. Switch to before-only mode
    await page.getByTestId("mode-btn-before-only").click();
    await expect(page.getByTestId("comparison-single-before")).toBeVisible();
    await expect(page.getByTestId("single-card-before")).toBeVisible();

    // 4. Switch to after-only mode
    await page.getByTestId("mode-btn-after-only").click();
    await expect(page.getByTestId("comparison-single-after")).toBeVisible();
    await expect(page.getByTestId("single-card-after")).toBeVisible();

    // 5. Switch back to side-by-side
    await page.getByTestId("mode-btn-side-by-side").click();
    await expect(page.getByTestId("comparison-side-by-side")).toBeVisible();
  });

  test("6. responsive layout behavior adapts cleanly on mobile viewport (390x844)", async ({ page }) => {
    await page.goto("/review");
    await page.evaluate(() => {
      localStorage.removeItem("omnisight:review-proposals");
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/review/proposals/${proposalId}`);

    const viewer = page.getByTestId("evidence-viewer-root");
    await expect(viewer).toBeVisible();

    // Mode toggle group should be visible
    const modeToggle = page.getByTestId("mode-toggle-group");
    await expect(modeToggle).toBeVisible();

    // Side-by-side container should be rendered in column flow
    const sideBySide = page.getByTestId("comparison-side-by-side");
    await expect(sideBySide).toBeVisible();

    const beforeCard = page.getByTestId("side-card-before");
    const afterCard = page.getByTestId("side-card-after");
    await expect(beforeCard).toBeVisible();
    await expect(afterCard).toBeVisible();

    // In mobile viewport, cards stack vertically
    const beforeBox = await beforeCard.boundingBox();
    const afterBox = await afterCard.boundingBox();
    expect(beforeBox).not.toBeNull();
    expect(afterBox).not.toBeNull();
    if (beforeBox && afterBox) {
      expect(afterBox.y).toBeGreaterThanOrEqual(beforeBox.y + beforeBox.height - 5);
    }
  });

  test("7. correctly displays authoritative automated verification status and checks", async ({ page }) => {
    await page.goto("/review");
    await page.evaluate(() => {
      localStorage.removeItem("omnisight:review-proposals");
      localStorage.removeItem("omnisight:review-decisions");
    });
    await page.goto(`/review/proposals/${proposalId}`);

    // In default pending state with mock baseline pair, check verification status indicator
    await expect(page.getByTestId("verification-status-pill")).toBeVisible();
    await expect(page.getByTestId("verification-status-pill")).toHaveText("INCONCLUSIVE");

    // Approve the proposal first
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();
    await expect(page.getByTestId("detail-review-status")).toHaveText("APPROVED");

    // Execute isolated repair job
    await page.getByRole("button", { name: "Execute Isolated Repair" }).click();
    await expect(page.getByTestId("repair-execution-dialog")).toBeVisible();

    const confirmBtn = page.getByTestId("btn-confirm-repair-exec");
    await confirmBtn.click();

    // Wait for repair execution to complete and job summary to render
    await expect(page.getByTestId("repair-job-summary")).toBeVisible({ timeout: 10000 });

    // The evidence viewer header verification badge should reflect PASSED
    await expect(page.getByTestId("verification-status-pill")).toHaveText("PASSED");

    // Passed checks summary should be visible in the evidence viewer
    const checksSummary = page.getByTestId("verification-checks-summary");
    await expect(checksSummary).toBeVisible();
    await expect(checksSummary.getByText("defect-symptom-resolved:")).toBeVisible();
    await expect(checksSummary.getByText("wcag-aa-contrast-or-geometry:")).toBeVisible();
  });

  test("8. supports keyboard accessibility for interactive slider controls", async ({ page }) => {
    await page.goto("/review");
    await page.evaluate(() => {
      localStorage.removeItem("omnisight:review-proposals");
    });
    await page.goto(`/review/proposals/${proposalId}`);

    // Switch to slider mode
    await page.getByTestId("mode-btn-slider").click();
    const sliderInput = page.getByTestId("slider-range-input");
    await expect(sliderInput).toBeVisible();

    // Initial value is 50
    await expect(sliderInput).toHaveValue("50");

    // Focus input and test ArrowLeft / ArrowRight navigation
    await sliderInput.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(sliderInput).toHaveValue("49");

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(sliderInput).toHaveValue("51");

    // Test Home (0) and End (100) keys
    await page.keyboard.press("Home");
    await expect(sliderInput).toHaveValue("0");

    await page.keyboard.press("End");
    await expect(sliderInput).toHaveValue("100");
  });
});
