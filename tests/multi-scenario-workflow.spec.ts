import { test, expect } from "@playwright/test";

test.describe("Multi-Scenario Capture Job & Independent Repair Workflow", () => {
  test.beforeEach(async ({ page }) => {
    // Clear storage before each test for clean isolation
    await page.goto("/review/jobs");
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.reload();
  });

  test("1. capture job displays multiple scenarios with all primary metadata", async ({
    page,
  }) => {
    await page.goto("/review/jobs");

    // Verify header and job title
    await expect(page.getByTestId("job-title")).toHaveText(
      "Storefront Multi-Viewport Inspection Run #1024"
    );
    await expect(page.getByTestId("job-id-label")).toHaveText("job-1024");

    // Verify 4 scenarios rendered
    const cards = page.locator("[data-testid^='scenario-card-']");
    await expect(cards).toHaveCount(4);

    // Verify card 1 metadata
    const card1 = page.getByTestId("scenario-card-scenario-img-distortion-01");
    await expect(card1.getByTestId("scenario-title")).toHaveText("Product Image Distortion");
    await expect(card1.getByTestId("scenario-defect-category")).toHaveText("image_distortion");
    await expect(card1.getByTestId("defect-severity-badge")).toHaveText("CRITICAL");
    await expect(card1.getByTestId("confidence-indicator")).toContainText("98%");

    // Verify technical details
    await expect(card1.getByTestId("scenario-diagnosis")).toBeVisible();
    await expect(card1.getByTestId("scenario-proposed-fix")).toBeVisible();
    await expect(card1.getByTestId("scenario-patch-id")).toHaveText(
      "patch-product-image-distortion-001"
    );
    await expect(card1.getByTestId("scenario-target-file")).toHaveText("src/index.css");
    await expect(card1.getByTestId("scenario-approval-status-badge")).toHaveText("PENDING");

    // Capture visual preview artifact
    await page.screenshot({ path: "public/evidence/multi-scenario-dashboard.png", fullPage: true });
  });

  test("2. approving one scenario updates its state independently without modifying others", async ({
    page,
  }) => {
    await page.goto("/review/jobs");

    const card1 = page.getByTestId("scenario-card-scenario-img-distortion-01");
    const card2 = page.getByTestId("scenario-card-scenario-missing-cart-btn-02");

    // Initially both are pending
    await expect(card1.getByTestId("scenario-approval-status-badge")).toHaveText("PENDING");
    await expect(card2.getByTestId("scenario-approval-status-badge")).toHaveText("PENDING");

    // Approve Scenario 1
    await card1.getByTestId("btn-scenario-approve").click();

    // Verify notification
    await expect(page.getByTestId("multi-scenario-notification")).toContainText(
      "Approved scenario 'Product Image Distortion' independently"
    );

    // Scenario 1 is now APPROVED
    await expect(card1.getByTestId("scenario-approval-status-badge")).toHaveText("APPROVED");
    await expect(card1.getByTestId("btn-simulate-repair")).toBeVisible();

    // Scenario 2 MUST REMAIN PENDING
    await expect(card2.getByTestId("scenario-approval-status-badge")).toHaveText("PENDING");
    await expect(card2.getByTestId("btn-scenario-approve")).toBeVisible();
    await expect(card2.getByTestId("btn-simulate-repair")).not.toBeVisible();
  });

  test("3. rejecting one scenario records reason independently without affecting others", async ({
    page,
  }) => {
    await page.goto("/review/jobs");

    const card2 = page.getByTestId("scenario-card-scenario-missing-cart-btn-02");
    const card3 = page.getByTestId("scenario-card-scenario-mobile-nav-overflow-03");

    // Reject Scenario 2 with explicit reason
    await card2.getByTestId("btn-scenario-reject").click();
    await expect(card2.getByTestId("input-reject-reason")).toBeVisible();

    await card2.getByTestId("input-reject-reason").fill("Needs further design review");
    await card2.getByTestId("btn-confirm-reject").click();

    // Verify rejection state on Scenario 2
    await expect(card2.getByTestId("scenario-approval-status-badge")).toHaveText("REJECTED");
    await expect(card2.getByTestId("scenario-rejection-info")).toContainText(
      "Needs further design review"
    );

    // Scenario 3 MUST REMAIN PENDING
    await expect(card3.getByTestId("scenario-approval-status-badge")).toHaveText("PENDING");
    await expect(card3.getByTestId("btn-scenario-approve")).toBeVisible();
  });

  test("4. enforces approval gate: repair simulation is available only for approved scenarios", async ({
    page,
  }) => {
    await page.goto("/review/jobs");

    const card3 = page.getByTestId("scenario-card-scenario-mobile-nav-overflow-03");

    // Pending: Simulate repair button does not exist
    await expect(card3.getByTestId("btn-simulate-repair")).not.toBeVisible();

    // Approve scenario
    await card3.getByTestId("btn-scenario-approve").click();
    await expect(card3.getByTestId("scenario-approval-status-badge")).toHaveText("APPROVED");

    // Now Simulate repair button is enabled and visible
    const simulateBtn = card3.getByTestId("btn-simulate-repair");
    await expect(simulateBtn).toBeVisible();
    await expect(simulateBtn).toBeEnabled();
  });

  test("5. simulates repair execution with progress tracking and verified success outcome", async ({
    page,
  }) => {
    await page.goto("/review/jobs");

    const card1 = page.getByTestId("scenario-card-scenario-img-distortion-01");

    // Approve first
    await card1.getByTestId("btn-scenario-approve").click();

    // Run simulation
    const simulateBtn = card1.getByTestId("btn-simulate-repair");
    await simulateBtn.click();

    // Verify progress banner is rendered during execution
    await expect(card1.getByTestId("scenario-repairing-progress")).toBeVisible();

    // Verify successful repair outcome report
    await expect(card1.getByTestId("scenario-repair-success-report")).toBeVisible({
      timeout: 10_000,
    });
    await expect(card1.getByTestId("scenario-repair-status-badge")).toHaveText("REPAIRED");
    await expect(card1.getByTestId("scenario-validation-status")).toHaveText("PASSED");
    await expect(card1.getByTestId("scenario-repair-success-report")).toContainText(
      "Simulated self-healing repair succeeded"
    );
  });

  test("6. displays simulated failure report gracefully when repair validation fails", async ({
    page,
  }) => {
    await page.goto("/review/jobs");

    // Scenario 4 (Low contrast) has lower severity deterministic failure threshold
    const card4 = page.getByTestId("scenario-card-scenario-low-contrast-text-04");

    await card4.getByTestId("btn-scenario-approve").click();
    await card4.getByTestId("btn-simulate-repair").click();

    // Verify failed report
    await expect(card4.getByTestId("scenario-repair-failure-report")).toBeVisible({
      timeout: 10_000,
    });
    await expect(card4.getByTestId("scenario-repair-status-badge")).toHaveText("REPAIR FAILED");
    await expect(card4.getByTestId("scenario-validation-status")).toHaveText("FAILED");
  });

  test("7. parent job summary metrics reflect scenario state changes reactively", async ({
    page,
  }) => {
    await page.goto("/review/jobs");

    // Initially: 4 Total, 4 Pending, 0 Approved, 0 Repaired, 0 Rejected
    await expect(page.getByTestId("metric-count-all")).toHaveText("4");
    await expect(page.getByTestId("metric-count-pending")).toHaveText("4");
    await expect(page.getByTestId("metric-count-approved")).toHaveText("0");
    await expect(page.getByTestId("metric-count-repaired")).toHaveText("0");
    await expect(page.getByTestId("metric-count-rejected")).toHaveText("0");

    // Approve Scenario 1 -> Approved: 1, Pending: 3
    const card1 = page.getByTestId("scenario-card-scenario-img-distortion-01");
    await card1.getByTestId("btn-scenario-approve").click();

    await expect(page.getByTestId("metric-count-approved")).toHaveText("1");
    await expect(page.getByTestId("metric-count-pending")).toHaveText("3");

    // Reject Scenario 2 -> Rejected: 1, Pending: 2
    const card2 = page.getByTestId("scenario-card-scenario-missing-cart-btn-02");
    await card2.getByTestId("btn-scenario-reject").click();
    await card2.getByTestId("input-reject-reason").fill("Not prioritized for this sprint");
    await card2.getByTestId("btn-confirm-reject").click();

    await expect(page.getByTestId("metric-count-rejected")).toHaveText("1");
    await expect(page.getByTestId("metric-count-pending")).toHaveText("2");

    // Run repair on Scenario 1 -> Repaired: 1, Approved: 0
    await card1.getByTestId("btn-simulate-repair").click();
    await expect(card1.getByTestId("scenario-repair-success-report")).toBeVisible({
      timeout: 10_000,
    });

    await expect(page.getByTestId("metric-count-repaired")).toHaveText("1");
    await expect(page.getByTestId("metric-count-approved")).toHaveText("0");
  });

  test("8. filter cards filter scenarios and search bar filters by keyword", async ({
    page,
  }) => {
    await page.goto("/review/jobs");

    // Approve Scenario 1
    const card1 = page.getByTestId("scenario-card-scenario-img-distortion-01");
    await card1.getByTestId("btn-scenario-approve").click();

    // Click "Approved" filter card
    await page.getByTestId("metric-card-approved").click();

    // Only 1 scenario displayed
    const visibleCards = page.locator("[data-testid^='scenario-card-']");
    await expect(visibleCards).toHaveCount(1);
    await expect(card1).toBeVisible();

    // Clear filter
    await page.getByTestId("btn-clear-filter").click();
    await expect(visibleCards).toHaveCount(4);

    // Search by keyword "mobile navigation"
    await page.getByTestId("input-scenario-search").fill("mobile navigation");
    await expect(visibleCards).toHaveCount(1);
    await expect(
      page.getByTestId("scenario-card-scenario-mobile-nav-overflow-03")
    ).toBeVisible();
  });

  test("9. navigation between proposals list and multi-scenario job preserves existing workflows", async ({
    page,
  }) => {
    // 1. Visit Review Console
    await page.goto("/review");
    await expect(page.getByTestId("dashboard-title")).toHaveText(
      "Human-in-the-Loop Repair Review"
    );

    // 2. Multi-scenario discovery banner is rendered
    await expect(page.getByTestId("multi-scenario-banner")).toBeVisible();
    await page.getByTestId("link-to-multi-scenario").click();

    // 3. Arrive at Multi-Scenario Job view
    await expect(page).toHaveURL(/\/review\/jobs/);
    await expect(page.getByTestId("job-title")).toBeVisible();

    // 4. Click sidebar link to go back to Repair Proposals
    await page.getByTestId("nav-proposals").click();
    await expect(page).toHaveURL("/review");
    await expect(page.getByTestId("dashboard-title")).toBeVisible();

    // 5. Storefront remains functional
    await page.goto("/products");
    await expect(page.getByTestId("navbar")).toBeVisible();
  });

  test("10. responsive layout renders properly across Desktop, Tablet, and Mobile viewports", async ({
    page,
  }) => {
    // Desktop Viewport
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/review/jobs");
    await expect(page.getByTestId("job-summary-metrics")).toBeVisible();
    await expect(page.getByTestId("scenario-card-scenario-img-distortion-01")).toBeVisible();

    // Tablet Viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.getByTestId("job-title")).toBeVisible();
    await expect(page.getByTestId("job-summary-metrics")).toBeVisible();

    // Mobile Viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("job-title")).toBeVisible();
    await expect(page.getByTestId("scenario-card-scenario-img-distortion-01")).toBeVisible();
  });
});
