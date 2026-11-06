import { test, expect } from "@playwright/test";

test.describe("OmniSight Product Dashboard Navigation & Functional Verification", () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure a clean state
    await page.goto("/dashboard");
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.reload();
  });

  test("1. loads the OmniSight Overview Dashboard with key metrics and target sites", async ({ page }) => {
    await page.goto("/dashboard");

    // Check title and shell elements
    await expect(page.locator("h1")).toContainText("Autonomous UI Self-Healing Center");
    await expect(page.locator(".omni-brand-name")).toHaveText("OmniSight");

    // Check metric counters
    await expect(page.locator(".omni-stats-grid")).toBeVisible();
    await expect(page.getByText("MONITORED WEBSITES")).toBeVisible();
    await expect(page.getByText("DETECTED DEFECTS")).toBeVisible();
    await expect(page.getByText("PENDING APPROVAL")).toBeVisible();
    await expect(page.getByText("VERIFIED REPAIRS")).toBeVisible();

    // Check monitored sites table
    await expect(page.locator(".omni-table")).toBeVisible();
    await expect(page.locator(".omni-table").getByText("OmniShop Storefront (Local)")).toBeVisible();
  });

  test("2. navigates between all primary dashboard sections smoothly", async ({ page }) => {
    await page.goto("/dashboard");

    // Navigate to Websites
    await page.click("nav.omni-nav a:has-text('Websites')");
    await expect(page).toHaveURL(/\/dashboard\/websites/);
    await expect(page.locator("h1")).toContainText("Monitored Websites");

    // Navigate to AI Diagnosis
    await page.click("nav.omni-nav a:has-text('AI Diagnosis')");
    await expect(page).toHaveURL(/\/dashboard\/analysis/);
    await expect(page.locator("h1")).toContainText("AI Defect Analysis & Evidence");

    // Navigate to Repair Center
    await page.click("nav.omni-nav a:has-text('Repair Center')");
    await expect(page).toHaveURL(/\/dashboard\/repairs/);
    await expect(page.locator("h1")).toContainText("Repair Center & Proposal Review");

    // Navigate to Verification
    await page.click("nav.omni-nav a:has-text('Verification')");
    await expect(page).toHaveURL(/\/dashboard\/verification/);
    await expect(page.locator("h1")).toContainText("Testing & Post-Repair Visual Verification");

    // Navigate to Audit Logs
    await page.click("nav.omni-nav a:has-text('Audit Logs')");
    await expect(page).toHaveURL(/\/dashboard\/activity/);
    await expect(page.locator("h1")).toContainText("System Activity & Audit Logs");
  });

  test("3. allows adding a new target website with form validation", async ({ page }) => {
    await page.goto("/dashboard/websites");

    await page.click("button:has-text('+ Add Target Website')");
    await expect(page.locator(".omni-modal")).toBeVisible();

    await page.fill("input[placeholder='e.g. Acme Customer Portal']", "Production Billing UI");
    await page.fill("input[placeholder='http://localhost:3000 or https://...']", "https://billing.omnisight.ai");
    await page.click(".omni-modal button[type='submit']");

    await expect(page.locator(".omni-modal")).not.toBeVisible();
    await expect(page.getByText("Production Billing UI")).toBeVisible();
  });

  test("4. inspects AI Defect visual evidence with side-by-side screenshots", async ({ page }) => {
    await page.goto("/dashboard/analysis");

    await expect(page.locator(".omni-comparison-pane")).toHaveCount(2);
    await expect(page.getByText("Baseline Screenshot (Clean)")).toBeVisible();
    await expect(page.getByText("Defective Screenshot (Regression)")).toBeVisible();

    // Verify source localization
    await expect(page.locator(".omni-code-panel")).toContainText("src/index.css");
  });

  test("5. enforces human approval before repair execution in Repair Center", async ({ page }) => {
    await page.goto("/dashboard/repairs");

    // Click Approve Repair
    await page.click("button:has-text('✓ Approve Repair')");
    await expect(page.locator(".omni-modal")).toBeVisible();
    await expect(page.locator(".omni-modal")).toContainText("Authorize Code Repair");

    // Confirm
    await page.click("button:has-text('Confirm & Authorize Execution')");
    await expect(page.locator(".omni-modal")).not.toBeVisible();
  });

  test("6. toggles dark and light themes using UI Layouts OKLCH variables", async ({ page }) => {
    await page.goto("/dashboard");

    const themeButton = page.locator("header button[title*='theme']");
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Toggle to Light
    await themeButton.click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    // Toggle back to Dark
    await themeButton.click();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("7. responsive verification on mobile viewport (390x844)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    // Check that mobile navigation drawer/bar is present
    await expect(page.locator(".omni-mobile-nav")).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();

    // Verify no unintended horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2); // allowing minor subpixel rounding
  });
});
