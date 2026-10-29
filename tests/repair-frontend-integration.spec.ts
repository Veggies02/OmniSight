import { test, expect } from "@playwright/test";

test.describe("Frontend Repair Review to FastAPI Backend Integration Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/review");
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
  });

  test("1. executes repair and displays real-time progress followed by backend passed result", async ({ page }) => {
    // Navigate to product-image-distortion proposal
    await page.goto("/review/proposals/prop_product-image-distortion_001");

    // Approve the proposal
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();
    await expect(page.getByTestId("detail-review-status")).toHaveText("APPROVED");

    // Click 'Execute Isolated Repair' button to open modal
    await page.getByRole("button", { name: "Execute Isolated Repair" }).click();
    await expect(page.getByTestId("repair-execution-dialog")).toBeVisible();

    // Confirm execution
    const confirmBtn = page.getByTestId("btn-confirm-repair-exec");
    await confirmBtn.click();

    // Verify progress indicator is rendered during execution
    await expect(page.getByTestId("repair-execution-progress")).toBeVisible();

    // Verify summary is rendered once completed
    await expect(page.getByTestId("repair-job-summary")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("repair-job-summary")).toContainText("PASSED");
    await expect(page.getByTestId("repair-job-summary")).toContainText("Build Verification: ✓ Passed");
    await expect(page.getByTestId("repair-job-summary")).toContainText("Visual Delta Validation: ✓ Passed");

    // Verify notification banner
    await expect(page.getByTestId("notification-banner")).toContainText("completed successfully");
  });

  test("2. prevents duplicate repair requests while execution is in progress", async ({ page }) => {
    await page.goto("/review/proposals/prop_product-image-distortion_001");

    // Approve
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();

    // Open repair dialog
    await page.getByRole("button", { name: "Execute Isolated Repair" }).click();
    const confirmBtn = page.getByTestId("btn-confirm-repair-exec");

    // Click once and verify button becomes disabled immediately
    await confirmBtn.click();
    await expect(confirmBtn).toBeDisabled();
    await expect(confirmBtn).toHaveText("Running Repair...");
  });

  test("3. handles simulated backend failure and presents detailed error details", async ({ page }) => {
    await page.goto("/review/proposals/prop_product-card-layout-break_002");

    // Approve
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();

    // Inject failing backend job ID into the proposal
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("omnisight:review-proposals") || "[]");
      const target = stored.find((p: any) => p.proposalId === "prop_product-card-layout-break_002");
      if (target) {
        target.backendJobId = "job-fail-mock-123";
        localStorage.setItem("omnisight:review-proposals", JSON.stringify(stored));
      }
    });

    // Mock the backend repair endpoint failure
    await page.route("**/jobs/job-fail-mock-123/repair", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Another repair is running. Try again when it finishes." }),
      });
    });

    // Open repair dialog
    await page.getByRole("button", { name: "Execute Isolated Repair" }).click();
    await page.getByTestId("btn-confirm-repair-exec").click();

    // Verify error notification shows the real backend error message
    await expect(page.getByTestId("notification-banner")).toBeVisible();
    await expect(page.getByTestId("notification-banner")).toContainText("Another repair is running");
  });

  test("4. polls backend job until terminal completed state and displays backend metrics", async ({ page }) => {
    await page.goto("/review/proposals/prop_low-contrast-text_003");

    // Approve
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();

    // Inject backend job ID
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("omnisight:review-proposals") || "[]");
      const target = stored.find((p: any) => p.proposalId === "prop_low-contrast-text_003");
      if (target) {
        target.backendJobId = "job-poll-mock-456";
        localStorage.setItem("omnisight:review-proposals", JSON.stringify(stored));
      }
    });

    let pollCount = 0;
    await page.route("**/jobs/job-poll-mock-456/repair", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          job_id: "job-poll-mock-456",
          website_url: "http://127.0.0.1:5173",
          status: "applying_patch",
          stage: "applying_patch",
          source: "manual",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          artifacts: [],
        }),
      });
    });

    await page.route("**/jobs/job-poll-mock-456", async (route) => {
      pollCount++;
      if (pollCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            job_id: "job-poll-mock-456",
            website_url: "http://127.0.0.1:5173",
            status: "validating",
            stage: "validating_browser_delta",
            source: "manual",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            artifacts: [],
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            job_id: "job-poll-mock-456",
            website_url: "http://127.0.0.1:5173",
            status: "completed",
            stage: "completed",
            source: "manual",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            repair: {
              outcome: "passed",
              passed: true,
              job_id: "job-poll-mock-456",
              message: "Real Playwright visual verification passed in isolated worktree.",
              final_state: "PASSED",
              build_passed: true,
              test_passed: true,
              visual_passed: true,
              report_path: "artifacts/repair-executions/job-poll-mock-456/repair_execution_report.json",
              duration_seconds: 14.2,
            },
            artifacts: [],
          }),
        });
      }
    });

    // Open repair dialog
    await page.getByRole("button", { name: "Execute Isolated Repair" }).click();
    await page.getByTestId("btn-confirm-repair-exec").click();

    // Verify terminal completed state rendered
    await expect(page.getByTestId("repair-job-summary")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("repair-job-summary")).toContainText("PASSED");
    await expect(page.getByTestId("repair-job-summary")).toContainText("Execution Duration: 14.2s");
    await expect(page.getByTestId("repair-job-summary")).toContainText("job-poll-mock-456");
  });

  test("5. blocks approval and execution when backend approval fails", async ({ page }) => {
    await page.goto("/review/proposals/prop_product-image-distortion_001");

    // Inject linked backend job
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("omnisight:review-proposals") || "[]");
      const target = stored.find((p: any) => p.proposalId === "prop_product-image-distortion_001");
      if (target) {
        target.backendJobId = "job-unauth-789";
        localStorage.setItem("omnisight:review-proposals", JSON.stringify(stored));
      }
    });

    // Mock 401 unauthorized on approval endpoint
    await page.route("**/jobs/job-unauth-789/approval", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Missing or wrong X-Operator-Token." }),
      });
    });

    // Click approve
    await page.getByTestId("btn-approve").click();
    await page.getByTestId("btn-confirm-dialog").click();

    // Verify error notification is displayed
    await expect(page.getByTestId("notification-banner")).toBeVisible();
    await expect(page.getByTestId("notification-banner")).toContainText("Missing or wrong X-Operator-Token");

    // Ensure status remains PENDING_REVIEW because backend refused approval
    await expect(page.getByTestId("detail-review-status")).toHaveText("PENDING_REVIEW");

    // 'Execute Isolated Repair' button must NOT appear
    await expect(page.getByRole("button", { name: "Execute Isolated Repair" })).not.toBeVisible();
  });

  test("6. verifies client does not leak operator token into browser storage", async ({ page }) => {
    await page.goto("/review");
    const sessionToken = await page.evaluate(() => window.sessionStorage.getItem("omnisight:operator-token"));
    const localToken = await page.evaluate(() => window.localStorage.getItem("omnisight:operator-token"));
    expect(sessionToken).toBeNull();
    expect(localToken).toBeNull();
  });
});
