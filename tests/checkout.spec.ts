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
    await expect(page.getByRole("heading", { name: "Demo Order Confirmed!" })).not.toBeVisible();
    await expect(page.locator("#fullName-error")).toBeVisible();
    await expect(page.locator("#fullName-error")).toHaveText("Full name is required");

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

  test("validates email format, address length, and postal code with inline errors", async ({ page }) => {
    // Add product to enable checkout
    await page.goto("/products");
    await page.locator(".product-card[data-product-id='prod-2']").getByRole("button", { name: /Add/i }).click();
    await page.goto("/checkout");

    const emailInput = page.locator("#email");
    const addressInput = page.locator("#address");
    const postalCodeInput = page.locator("#postalCode");

    // Invalid email triggers error on blur
    await emailInput.fill("invalid-email-format");
    await emailInput.blur();
    await expect(page.locator("#email-error")).toBeVisible();
    await expect(page.locator("#email-error")).toContainText("valid email address");
    await expect(emailInput).toHaveClass(/input-error/);

    // Invalid address triggers error on blur
    await addressInput.fill("123");
    await addressInput.blur();
    await expect(page.locator("#address-error")).toBeVisible();
    await expect(page.locator("#address-error")).toHaveText("Please enter a complete street address");

    // Invalid postal code triggers error on blur
    await postalCodeInput.fill("!");
    await postalCodeInput.blur();
    await expect(page.locator("#postalCode-error")).toBeVisible();

    // Form submission is blocked
    await page.getByRole("button", { name: /Place Demo Order/i }).click();
    await expect(page.getByRole("heading", { name: "Demo Order Confirmed!" })).not.toBeVisible();

    // Correcting all fields resolves errors and allows order placement
    await emailInput.fill("jordan.casey@example.com");
    await addressInput.fill("100 Innovation Way");
    await postalCodeInput.fill("94105");

    await expect(page.locator("#email-error")).not.toBeVisible();
    await expect(page.locator("#address-error")).not.toBeVisible();
    await expect(page.locator("#postalCode-error")).not.toBeVisible();

    await page.getByRole("button", { name: /Place Demo Order/i }).click();
    await expect(page.getByRole("heading", { name: "Demo Order Confirmed!" })).toBeVisible();
    await expect(page.locator("[data-testid='confirmation-email']")).toHaveText("jordan.casey@example.com");
    await expect(page.locator("[data-testid='confirmation-address']")).toContainText("100 Innovation Way");
  });
});
