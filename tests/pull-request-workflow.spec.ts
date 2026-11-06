import { test, expect } from "@playwright/test";

test.describe("Frontend to Backend GitHub Pull Request Workflow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/review");
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
  });

  test("1. renders PR staging section upon repair completion and creates a Draft Pull Request", async ({
    page,
  }) => {
    // Intercept backend PR creation endpoint
    await page.route("**/jobs/*/pr", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            pr_number: 42,
            pr_url: "https://github.com/Veggies02/OmniSight/pull/42",
            title: "fix(ui): automated visual repair for product-image-distortion",
            head_branch: "repair/product-image-distortion-worktree",
            base_branch: "main",
            is_draft: true,
            status: "draft",
            existing: false,
            repository: "Veggies02/OmniSight",
            created_at: new Date().toISOString(),
          }),
        });
      } else if (route.request().method() === "GET") {
        await route.fulfill({ status: 404, json: { detail: "No PR yet" } });
      }
    });

    // Navigate to proposal
    await page.goto("/review/proposals/prop_product-image-distortion_001");

    // Approve the proposal
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();
    await expect(page.getByTestId("detail-review-status")).toHaveText("APPROVED");

    // Open repair dialog & execute repair
    await page.getByRole("button", { name: "Execute Isolated Repair" }).click();
    await expect(page.getByTestId("repair-execution-dialog")).toBeVisible();
    await page.getByTestId("btn-confirm-repair-exec").click();

    // Verify repair passed and PR section is displayed
    await expect(page.getByTestId("repair-job-summary")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("repair-job-summary")).toContainText("PASSED");
    await expect(page.getByTestId("pull-request-section")).toBeVisible();

    // Stage Draft PR
    const createPrBtn = page.getByTestId("btn-create-pr");
    await expect(createPrBtn).toBeVisible();
    await expect(createPrBtn).toContainText("Stage GitHub Draft PR");
    await createPrBtn.click();

    // Verify confirmed PR card
    await expect(page.getByTestId("pr-status-badge")).toHaveText("DRAFT PR CREATED");
    const prLink = page.getByTestId("pr-link");
    await expect(prLink).toBeVisible();
    await expect(prLink).toHaveAttribute("href", "https://github.com/Veggies02/OmniSight/pull/42");
    await expect(page.getByTestId("pr-details")).toContainText("PR #42");
    await expect(prLink).toContainText("fix(ui): automated visual repair");
    await expect(page.getByTestId("pr-details")).toContainText("main");
  });

  test("2. displays existing PR deduplication metadata idempotently", async ({ page }) => {
    // Intercept with existing PR response
    await page.route("**/jobs/*/pr", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            pr_number: 108,
            pr_url: "https://github.com/Veggies02/OmniSight/pull/108",
            title: "fix(ui): existing repair branch",
            head_branch: "repair/existing-branch",
            base_branch: "main",
            is_draft: true,
            status: "draft",
            existing: true,
            repository: "Veggies02/OmniSight",
            created_at: new Date().toISOString(),
          }),
        });
      } else {
        await route.fulfill({ status: 404, json: { detail: "No PR yet" } });
      }
    });

    await page.goto("/review/proposals/prop_product-image-distortion_001");
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();
    await page.getByRole("button", { name: "Execute Isolated Repair" }).click();
    await page.getByTestId("btn-confirm-repair-exec").click();

    await expect(page.getByTestId("pull-request-section")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("btn-create-pr").click();

    await expect(page.getByTestId("pr-status-badge")).toHaveText("DRAFT PR CREATED");
    await expect(page.getByTestId("pr-details")).toContainText(
      "Reused existing pull request on GitHub without duplication"
    );
  });

  test("3. displays server error message when GitHub credentials are missing", async ({
    page,
  }) => {
    // Intercept with 503 error
    await page.route("**/jobs/*/pr", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            detail: "GitHub integration is not configured: GITHUB_TOKEN is missing on server.",
          }),
        });
      } else {
        await route.fulfill({ status: 404, json: { detail: "No PR yet" } });
      }
    });

    await page.goto("/review/proposals/prop_product-image-distortion_001");
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();
    await page.getByRole("button", { name: "Execute Isolated Repair" }).click();
    await page.getByTestId("btn-confirm-repair-exec").click();

    await expect(page.getByTestId("pull-request-section")).toBeVisible({ timeout: 15_000 });
    const createPrBtn = page.getByTestId("btn-create-pr");
    await createPrBtn.click();

    // Verify error banner
    await expect(page.getByTestId("pr-error-message")).toBeVisible();
    await expect(page.getByTestId("pr-error-message")).toContainText("GITHUB_TOKEN is missing");
    // Verify button is re-enabled for retry
    await expect(createPrBtn).toBeEnabled();
  });
});
