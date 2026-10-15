import { test } from "@playwright/test";
import fs from "fs";
import path from "path";

test.describe("Artifact & Screenshot Capture", () => {
  const screenshotsDir = path.resolve(process.cwd(), "artifacts/screenshots");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("captures clean baseline screenshots for future OmniSight VLM inspection", async ({ page }) => {
    // 1. Homepage
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.screenshot({ path: path.join(screenshotsDir, "01-home-desktop.png"), fullPage: false });

    // 2. Products Catalogue
    await page.goto("/products");
    await page.screenshot({ path: path.join(screenshotsDir, "02-products-desktop.png"), fullPage: false });

    // 3. Product Details
    await page.goto("/products/prod-1");
    await page.screenshot({ path: path.join(screenshotsDir, "03-product-details-desktop.png"), fullPage: false });

    // 4. Cart with an item
    await page.locator(".detail-add-btn").click();
    await page.goto("/cart");
    await page.screenshot({ path: path.join(screenshotsDir, "04-cart-with-items-desktop.png"), fullPage: false });

    // 5. Checkout page
    await page.goto("/checkout");
    await page.screenshot({ path: path.join(screenshotsDir, "05-checkout-desktop.png"), fullPage: false });

    // 6. Mobile Catalogue (390 x 844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/products");
    await page.screenshot({ path: path.join(screenshotsDir, "06-products-mobile.png"), fullPage: false });

    // 7. Mobile Cart (390 x 844)
    await page.goto("/cart");
    await page.screenshot({ path: path.join(screenshotsDir, "07-cart-mobile.png"), fullPage: false });
  });
});
