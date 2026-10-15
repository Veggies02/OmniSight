import { test, expect } from "@playwright/test";

test.describe("Product Catalogue & Stock Verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("loads catalogue and displays products with prices", async ({ page }) => {
    await page.goto("/products");
    await expect(page.getByRole("heading", { name: "All Products" })).toBeVisible();

    const productCards = page.locator(".product-card");
    await expect(productCards).toHaveCount(7);
  });

  test("handles dynamic product route and gracefully handles invalid IDs", async ({ page }) => {
    await page.goto("/products/prod-1");
    await expect(page.getByRole("heading", { name: "Aura Noise-Cancelling Headphones" })).toBeVisible();
    await expect(page.getByText("$249.99")).toBeVisible();

    // Invalid product ID
    await page.goto("/products/prod-non-existent-999");
    await expect(page.getByRole("heading", { name: "Product Not Found" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Return to Catalog/i })).toBeVisible();
  });

  test("disables Add to Cart for out-of-stock product", async ({ page }) => {
    await page.goto("/products");
    const outOfStockCard = page.locator(".product-card[data-product-id='prod-7']");
    await expect(outOfStockCard).toBeVisible();
    await expect(outOfStockCard.getByText("Out of Stock").first()).toBeVisible();

    const addBtn = outOfStockCard.getByRole("button", { name: /out of stock/i });
    await expect(addBtn).toBeDisabled();

    // On details page
    await page.goto("/products/prod-7");
    await expect(page.getByText("This product is currently out of stock")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add to Cart" })).not.toBeVisible();
  });
});

test.describe("Shopping Cart Workflow & Mathematics", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("adds a product and updates navbar badge", async ({ page }) => {
    await page.goto("/products");
    await expect(page.getByRole("link", { name: /Cart with 0 items/i })).toBeVisible();

    const firstCard = page.locator(".product-card[data-product-id='prod-1']");
    const addBtn = firstCard.locator("button");
    await addBtn.click();

    // Verify badge updates to 1
    await expect(page.getByRole("link", { name: /Cart with 1 items/i })).toBeVisible();

    // Navigate to cart
    await page.getByRole("link", { name: /Cart with 1 items/i }).click();
    await expect(page).toHaveURL("/cart");
    await expect(page.getByRole("heading", { name: "Shopping Cart" })).toBeVisible();
    await expect(page.locator(".cart-item-row")).toHaveCount(1);
    await expect(page.getByText("Aura Noise-Cancelling Headphones")).toBeVisible();
    await expect(page.locator(".summary-total-price")).toHaveText("$249.99");
  });

  test("adding the same product multiple times increases its quantity", async ({ page }) => {
    await page.goto("/products");
    const card = page.locator(".product-card[data-product-id='prod-1']");
    const addBtn = card.getByRole("button", { name: /Add Aura Noise-Cancelling Headphones to cart/i });

    await addBtn.click();
    await expect(page.getByRole("link", { name: /Cart with 1 items/i })).toBeVisible();

    await addBtn.click();
    await expect(page.getByRole("link", { name: /Cart with 2 items/i })).toBeVisible();

    await page.getByRole("link", { name: /Cart with 2 items/i }).click();
    await expect(page.locator(".cart-item-row")).toHaveCount(1);
    await expect(page.locator(".qty-value-sm")).toHaveText("2");
    // $249.99 * 2 = $499.98
    await expect(page.locator(".summary-total-price")).toHaveText("$499.98");
  });

  test("quantity controls increase and decrease line subtotal", async ({ page }) => {
    await page.goto("/products");
    await page.locator(".product-card[data-product-id='prod-2']").getByRole("button", { name: /Add/i }).click();
    await expect(page.getByRole("link", { name: /Cart with 1 items/i })).toBeVisible();

    await page.getByRole("link", { name: /Cart with 1 items/i }).click();
    // Chronos is $189.00
    await expect(page.locator(".summary-total-price")).toHaveText("$189.00");

    // Click +
    await page.getByRole("button", { name: /Increase quantity of Chronos/i }).click();
    await expect(page.locator(".qty-value-sm")).toHaveText("2");
    await expect(page.locator(".summary-total-price")).toHaveText("$378.00");

    // Click −
    await page.getByRole("button", { name: /Decrease quantity of Chronos/i }).click();
    await expect(page.locator(".qty-value-sm")).toHaveText("1");
    await expect(page.locator(".summary-total-price")).toHaveText("$189.00");

    // Decreasing below 1 removes item
    await page.getByRole("button", { name: /Decrease quantity of Chronos/i }).click();
    await expect(page.getByRole("heading", { name: "Your cart is currently empty" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Cart with 0 items/i })).toBeVisible();
  });

  test("removing an item updates subtotal and badge", async ({ page }) => {
    await page.goto("/products");
    await page.locator(".product-card[data-product-id='prod-1']").getByRole("button", { name: /Add/i }).click();
    await expect(page.getByRole("link", { name: /Cart with 1 items/i })).toBeVisible();

    await page.locator(".product-card[data-product-id='prod-3']").getByRole("button", { name: /Add/i }).click();
    await expect(page.getByRole("link", { name: /Cart with 2 items/i })).toBeVisible();

    await page.getByRole("link", { name: /Cart with 2 items/i }).click();
    await expect(page.locator(".cart-item-row")).toHaveCount(2);

    // Remove prod-1
    await page.getByRole("button", { name: /Remove Aura Noise-Cancelling Headphones from cart/i }).click();
    await expect(page.locator(".cart-item-row")).toHaveCount(1);
    // Only Nordic Ceramic Pour-Over ($64.50) remains
    await expect(page.locator(".summary-total-price")).toHaveText("$64.50");
    await expect(page.getByRole("link", { name: /Cart with 1 items/i })).toBeVisible();
  });

  test("clearing the entire cart shows the empty-state", async ({ page }) => {
    await page.goto("/products");
    await page.locator(".product-card[data-product-id='prod-1']").getByRole("button", { name: /Add/i }).click();
    await expect(page.getByRole("link", { name: /Cart with 1 items/i })).toBeVisible();

    await page.getByRole("link", { name: /Cart with 1 items/i }).click();
    await page.getByRole("button", { name: /Clear all items from shopping cart/i }).click();
    await expect(page.getByRole("heading", { name: "Your cart is currently empty" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Explore Products/i })).toBeVisible();
  });
});

test.describe("Persistence & Storage Resilience", () => {
  test("cart state persists across browser page refresh", async ({ page }) => {
    await page.goto("/products");
    await page.evaluate(() => window.localStorage.clear());
    await page.locator(".product-card[data-product-id='prod-1']").getByRole("button", { name: /Add/i }).click();
    await expect(page.getByRole("link", { name: /Cart with 1 items/i })).toBeVisible();

    // Reload the page
    await page.reload();
    await expect(page.getByRole("link", { name: /Cart with 1 items/i })).toBeVisible();

    await page.goto("/cart");
    await expect(page.locator(".cart-item-row")).toHaveCount(1);
    await expect(page.getByText("Aura Noise-Cancelling Headphones")).toBeVisible();
  });

  test("survives malformed JSON in localStorage without crashing", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.setItem("omnishop-cart", "{invalid json corrupt syntax");
    });

    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "Your cart is currently empty" })).toBeVisible();
  });

  test("safely discards invalid product IDs in localStorage", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.setItem(
        "omnishop-cart",
        JSON.stringify([
          { productId: "fake-ghost-id-9999", quantity: 5 },
          { productId: "prod-1", quantity: 2 },
        ])
      );
    });

    await page.goto("/cart");
    // Only prod-1 should be loaded (2 items)
    await expect(page.getByRole("link", { name: /Cart with 2 items/i })).toBeVisible();
    await expect(page.locator(".cart-item-row")).toHaveCount(1);
    await expect(page.getByText("Aura Noise-Cancelling Headphones")).toBeVisible();
  });
});
