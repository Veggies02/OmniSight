import { test, expect } from "@playwright/test";

test.describe("Checkout Workflow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("prevents checkout when cart is empty", async ({ page }) => {
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "Cannot proceed with an empty cart" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Browse Products/i })).toBeVisible();
  });

  test("displays items summary and allows submitting demo order", async ({ page }) => {
    // Add product first
    await page.goto("/products");
    await page.locator(".product-card[data-product-id='prod-1']").getByRole("button", { name: /Add/i }).click();
    await expect(page.getByRole("link", { name: /Cart with 1 items/i })).toBeVisible();

    // Navigate to checkout via client router
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "Checkout Summary" })).toBeVisible();
    await expect(page.locator(".checkout-items-list")).toBeVisible();
    await expect(page.getByText("Aura Noise-Cancelling Headphones")).toBeVisible();
    await expect(page.getByText("Demo Simulation Only:")).toBeVisible();

    // Required fields check
    const nameInput = page.locator("#fullName");
    await nameInput.fill("");
    await page.getByRole("button", { name: /Place Demo Order/i }).click();
    // HTML5 validation prevents submission if empty
    await expect(page.getByRole("heading", { name: "Demo Order Confirmed!" })).not.toBeVisible();

    // Fill valid data and place demo order
    await nameInput.fill("Jordan Casey");
    await page.getByRole("button", { name: /Place Demo Order/i }).click();

    // Demo confirmation appears
    await expect(page.getByRole("heading", { name: "Demo Order Confirmed!" })).toBeVisible();
    await expect(page.getByText("Jordan Casey")).toBeVisible();
    await expect(page.getByText("No real payment was collected")).toBeVisible();

    // Cart is now cleared
    await expect(page.getByRole("link", { name: /Cart with 0 items/i })).toBeVisible();
  });
});
