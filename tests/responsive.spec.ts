import { test, expect } from "@playwright/test";

const viewports = [
  { name: "Desktop", width: 1440, height: 900 },
  { name: "Tablet", width: 768, height: 1024 },
  { name: "Mobile", width: 390, height: 844 },
];

for (const vp of viewports) {
  test.describe(`Responsive Viewport: ${vp.name} (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`verifies no horizontal overflow on Home page at ${vp.name}`, async ({ page }) => {
      await page.goto("/");
      await page.evaluate(() => window.localStorage.clear());
      await expect(page.getByRole("heading", { name: /Crafted essentials/i })).toBeVisible();

      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasOverflow).toBe(false);
    });

    test(`verifies no horizontal overflow on Products catalogue at ${vp.name}`, async ({ page }) => {
      await page.goto("/products");
      await page.evaluate(() => window.localStorage.clear());
      await expect(page.getByRole("heading", { name: "All Products" })).toBeVisible();

      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasOverflow).toBe(false);
    });

    test(`verifies no horizontal overflow on Cart with items at ${vp.name}`, async ({ page }) => {
      await page.goto("/products");
      await page.evaluate(() => window.localStorage.clear());
      await page.locator(".product-card[data-product-id='prod-1']").getByRole("button", { name: /Add/i }).click();
      await expect(page.getByRole("link", { name: /Cart with 1 items/i })).toBeVisible();

      await page.getByRole("link", { name: /Cart with 1 items/i }).click();
      await expect(page.getByRole("heading", { name: "Shopping Cart" })).toBeVisible();

      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasOverflow).toBe(false);
    });
  });
}
