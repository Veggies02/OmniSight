import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

test.describe("Step 4.5 Human-in-the-Loop Repair Review Dashboard Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure fresh isolated state for each test
    await page.goto("/review");
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.reload();
  });

  // 1. Dashboard loads with proposal data
  test("1. dashboard loads with proposal data and summary statistics", async ({ page }) => {
    await page.goto("/review");
    await expect(page.getByTestId("dashboard-title")).toHaveText("Human-in-the-Loop Repair Review");

    // Check summary cards
    await expect(page.getByTestId("stat-total")).toContainText("4");
    await expect(page.getByTestId("stat-pending")).toContainText("4");
    await expect(page.getByTestId("stat-approved")).toContainText("0");
    await expect(page.getByTestId("stat-rejected")).toContainText("0");

    // Check proposal list table
    await expect(page.getByTestId("proposal-list")).toBeVisible();
    await expect(page.getByTestId("proposal-row-prop_product-image-distortion_001")).toBeVisible();
    await expect(page.getByTestId("proposal-row-prop_product-card-layout-break_002")).toBeVisible();
    await expect(page.getByTestId("proposal-row-prop_low-contrast-text_003")).toBeVisible();
    await expect(page.getByTestId("proposal-row-prop_mobile-nav-overflow_004")).toBeVisible();
  });

  // 2. Proposal filtering by category
  test("2. filters proposals by defect category", async ({ page }) => {
    await page.goto("/review");
    const categorySelect = page.getByTestId("filter-category");

    await categorySelect.selectOption("image_distortion");
    await expect(page.getByTestId("proposal-row-prop_product-image-distortion_001")).toBeVisible();
    await expect(page.getByTestId("proposal-row-prop_product-card-layout-break_002")).not.toBeVisible();
    await expect(page.getByTestId("proposal-row-prop_low-contrast-text_003")).not.toBeVisible();
  });

  // 3. Proposal search field
  test("3. searches proposals by ID, file path, or description", async ({ page }) => {
    await page.goto("/review");
    const searchInput = page.getByTestId("search-input");

    await searchInput.fill("mobile-nav");
    await expect(page.getByTestId("proposal-row-prop_mobile-nav-overflow_004")).toBeVisible();
    await expect(page.getByTestId("proposal-row-prop_product-image-distortion_001")).not.toBeVisible();

    await searchInput.fill("nonexistent_token_xyz");
    await expect(page.getByTestId("empty-proposals")).toBeVisible();
    await expect(page.getByTestId("empty-proposals")).toContainText("No repair proposals match your criteria");

    // Reset filters
    await page.getByTestId("btn-reset-filters").click();
    await expect(page.getByTestId("proposal-row-prop_product-image-distortion_001")).toBeVisible();
  });

  // 4. Detail view navigation and content
  test("4. navigates to proposal detail view and renders all sections", async ({ page }) => {
    await page.goto("/review");
    await page.getByTestId("btn-review-prop_product-image-distortion_001").click();
    await expect(page).toHaveURL(/\/review\/proposals\/prop_product-image-distortion_001/);

    await expect(page.getByTestId("proposal-title")).toHaveText("prop_product-image-distortion_001");
    await expect(page.getByTestId("detail-review-status")).toHaveText("PENDING_REVIEW");
    await expect(page.getByTestId("detail-freshness-status")).toHaveText("FRESH");

    // Panels
    await expect(page.getByTestId("panel-visual-evidence")).toBeVisible();
    await expect(page.getByTestId("baseline-image")).toBeVisible();
    await expect(page.getByTestId("defective-image")).toBeVisible();

    await expect(page.getByTestId("panel-diagnosis")).toBeVisible();
    await expect(page.getByTestId("source-excerpt")).toBeVisible();

    await expect(page.getByTestId("panel-correction")).toBeVisible();
    await expect(page.getByTestId("diff-viewer")).toBeVisible();
    await expect(page.getByTestId("current-code")).toContainText("object-fit: fill");
    await expect(page.getByTestId("proposed-code")).toContainText("object-fit: cover");
  });

  // 5. Approving a pending proposal
  test("5. approves a pending proposal with explicit confirmation", async ({ page }) => {
    await page.goto("/review/proposals/prop_product-image-distortion_001");

    // Click Approve
    await page.getByTestId("btn-approve").click();
    await expect(page.getByTestId("review-dialog-overlay")).toBeVisible();
    await expect(page.getByTestId("approval-notice")).toContainText("Important Non-Destructive Invariant");

    // Confirm
    await page.getByTestId("btn-confirm-dialog").click();

    // Verify approval badge and banner
    await expect(page.getByTestId("notification-banner")).toContainText("successfully approved");
    await expect(page.getByTestId("detail-review-status")).toHaveText("APPROVED");
    await expect(page.getByTestId("decision-banner-approved")).toBeVisible();

    // Verify dashboard stats updated
    await page.goto("/review");
    await expect(page.getByTestId("stat-pending")).toContainText("3");
    await expect(page.getByTestId("stat-approved")).toContainText("1");
    await expect(page.getByTestId("status-prop_product-image-distortion_001")).toHaveText("APPROVED");
  });

  // 6. Cancelling approval dialog
  test("6. cancels approval dialog without altering review status", async ({ page }) => {
    await page.goto("/review/proposals/prop_product-image-distortion_001");
    await page.getByTestId("btn-approve").click();
    await expect(page.getByTestId("review-dialog-overlay")).toBeVisible();

    await page.getByTestId("btn-cancel-dialog").click();
    await expect(page.getByTestId("review-dialog-overlay")).not.toBeVisible();
    await expect(page.getByTestId("detail-review-status")).toHaveText("PENDING_REVIEW");
  });

  // 7. Rejecting a proposal requires reason
  test("7. requires feedback reason when rejecting a proposal", async ({ page }) => {
    await page.goto("/review/proposals/prop_product-card-layout-break_002");

    await page.getByTestId("btn-reject").click();
    await expect(page.getByTestId("review-dialog-overlay")).toBeVisible();

    // Submit empty reason -> should show error
    await page.getByTestId("btn-confirm-dialog").click();
    await expect(page.getByTestId("dialog-error-text")).toContainText("rejection reason is required");

    // Enter reason and submit
    await page.getByTestId("rejection-reason-input").fill("Action buttons still wrap awkwardly on tablet.");
    await page.getByTestId("btn-confirm-dialog").click();

    // Verify rejected badge and banner
    await expect(page.getByTestId("notification-banner")).toContainText("rejected with feedback recorded");
    await expect(page.getByTestId("detail-review-status")).toHaveText("REJECTED");
    await expect(page.getByTestId("decision-banner-rejected")).toBeVisible();

    // Verify dashboard counts
    await page.goto("/review");
    await expect(page.getByTestId("stat-pending")).toContainText("3");
    await expect(page.getByTestId("stat-rejected")).toContainText("1");
    await expect(page.getByTestId("status-prop_product-card-layout-break_002")).toHaveText("REJECTED");
  });

  // 8. Decision persistence after browser page refresh
  test("8. preserves approved and rejected decisions across page refreshes", async ({ page }) => {
    await page.goto("/review/proposals/prop_low-contrast-text_003");
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();
    await expect(page.getByTestId("detail-review-status")).toHaveText("APPROVED");

    // Refresh page
    await page.reload();
    await expect(page.getByTestId("detail-review-status")).toHaveText("APPROVED");
    await expect(page.getByTestId("decision-banner-approved")).toBeVisible();
  });

  // 9. Review history audit trail
  test("9. records decisions in review history audit trail", async ({ page }) => {
    await page.goto("/review/proposals/prop_mobile-nav-overflow_004");
    await page.getByTestId("btn-reject").click();
    await page.getByTestId("rejection-reason-input").fill("Prefer hamburger drawer instead of fluid container.");
    await page.getByTestId("btn-confirm-dialog").click();

    // Check history route
    await page.goto("/review/history");
    await expect(page.getByTestId("history-table")).toBeVisible();
    await expect(page.getByTestId("history-table")).toContainText("prop_mobile-nav-overflow_004");
    await expect(page.getByTestId("history-table")).toContainText("Prefer hamburger drawer instead of fluid container.");
  });

  // 10. Non-destructive invariant: source code remains completely unchanged
  test("10. verifies that review approvals and rejections do not modify source files", async ({ page }) => {
    // Approve one and reject another
    await page.goto("/review/proposals/prop_product-image-distortion_001");
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();

    await page.goto("/review/proposals/prop_low-contrast-text_003");
    await page.getByTestId("btn-reject").click();
    await page.getByTestId("rejection-reason-input").fill("Testing non-destructive nature");
    await page.getByTestId("btn-confirm-dialog").click();

    // Verify on disk that src/index.css and components still contain defect styles
    const indexCss = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
    expect(indexCss).toContain(".defect-product-image-distortion");
    expect(indexCss).toContain(".defect-product-card-layout-break");
    expect(indexCss).toContain(".defect-low-contrast-text");
    expect(indexCss).toContain(".defect-mobile-nav-overflow");

    const productCard = fs.readFileSync(path.resolve(process.cwd(), "src/components/ProductCard.tsx"), "utf8");
    expect(productCard).toContain("data-defect-applied");
  });

  // 11. Responsive layout: zero horizontal overflow on mobile viewports
  test("11. responsive layout works cleanly on mobile (390x844)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/review");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // Detail view mobile check
    await page.goto("/review/proposals/prop_product-image-distortion_001");
    const detailScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const detailClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(detailScrollWidth).toBeLessThanOrEqual(detailClientWidth);
  });
});
