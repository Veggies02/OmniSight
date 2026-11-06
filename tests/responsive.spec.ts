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

test.describe("Mobile Navigation Overflow Defect & Regression Verification", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("verifies standard mobile navigation has zero horizontal overflow, and defect injection correctly triggers overflow", async ({ page }) => {
    // 1. Verify standard mobile navigation at 390x844 has no horizontal document overflow
    await page.goto("/products");
    await page.evaluate(() => window.localStorage.clear());

    const navbar = page.locator(".navbar");
    await expect(navbar).toBeVisible();

    const hasDocOverflowClean = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasDocOverflowClean).toBe(false);

    // 2. Verify navbar container fits within the 390px mobile viewport
    const navContainer = navbar.locator(".navbar-container");
    const containerBox = await navContainer.boundingBox();
    expect(containerBox).not.toBeNull();
    if (containerBox) {
      expect(containerBox.x).toBeGreaterThanOrEqual(0);
      expect(containerBox.x + containerBox.width).toBeLessThanOrEqual(390);
    }

    // 3. Verify all navigation links remain visible, usable, and within viewport boundaries
    const navLinks = navbar.locator(".nav-link");
    const count = await navLinks.count();
    expect(count).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < count; i++) {
      const link = navLinks.nth(i);
      await expect(link).toBeVisible();
      const linkBox = await link.boundingBox();
      expect(linkBox).not.toBeNull();
      if (linkBox) {
        expect(linkBox.x).toBeGreaterThanOrEqual(0);
        expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(390);
      }
    }

    // 4. Verify that if the defect returns, the browser detects horizontal overflow (> 390px)
    await page.addInitScript(() => {
      window.sessionStorage.setItem("omnisight:enable-defects", "true");
    });
    await page.goto("/products?defect=mobile-nav-overflow");
    await expect(navbar).toHaveClass(/defect-mobile-nav-overflow/);

    const hasDocOverflowDefect = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasDocOverflowDefect).toBe(true);
  });
});

