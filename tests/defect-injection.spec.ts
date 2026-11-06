import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Clear storage and explicitly enable defect injection for the test environment
  await page.addInitScript(() => {
    window.sessionStorage.setItem("omnisight:enable-defects", "true");
  });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
});

test.describe("UI Defect-Injection Framework", () => {
  test("defects are disabled by default on clean navigation", async ({ page }) => {
    await page.goto("/products");

    // Check inspection metadata indicates no active defect
    const metadata = page.locator("#omnisight-defect-metadata");
    await expect(metadata).toHaveAttribute("data-defect-active", "false");
    await expect(metadata).toHaveAttribute("data-defect-id", "none");
    await expect(metadata).toHaveAttribute("data-defect-injection-enabled", "true");

    // Verify all cards lack defect classes
    const cards = page.locator(".product-card");
    await expect(cards.first()).not.toHaveClass(/defect-/);

    // Navbar lacks defect classes
    const navbar = page.locator(".navbar");
    await expect(navbar).not.toHaveClass(/defect-/);
  });

  test("when defect injection is disabled, query parameter cannot activate any defect", async ({ page }) => {
    // Explicitly simulate disabled state (as in standard production)
    await page.addInitScript(() => {
      window.sessionStorage.setItem("omnisight:enable-defects", "false");
    });
    await page.goto("/products?defect=product-image-distortion");

    const metadata = page.locator("#omnisight-defect-metadata");
    await expect(metadata).toHaveAttribute("data-defect-active", "false");
    await expect(metadata).toHaveAttribute("data-defect-id", "none");
    await expect(metadata).toHaveAttribute("data-defect-injection-enabled", "false");

    // Cards must remain normal and clean
    const cards = page.locator(".product-card");
    await expect(cards.first()).not.toHaveClass(/defect-/);
    await expect(cards.first()).not.toHaveAttribute("data-defect-applied");

    const img = cards.first().locator(".product-image");
    const objectFit = await img.evaluate((el) => window.getComputedStyle(el).objectFit);
    expect(objectFit).toBe("cover");

    // Test mobile nav overflow is also ignored when disabled
    await page.goto("/products?defect=mobile-nav-overflow");
    const navbar = page.locator(".navbar");
    await expect(navbar).not.toHaveClass(/defect-/);
  });

  test("unknown defect IDs fail safely and maintain normal appearance", async ({ page }) => {
    await page.goto("/products?defect=unknown-non-existent-defect-1234");

    const metadata = page.locator("#omnisight-defect-metadata");
    await expect(metadata).toHaveAttribute("data-defect-active", "false");
    await expect(metadata).toHaveAttribute("data-defect-id", "none");

    const cards = page.locator(".product-card");
    await expect(cards).toHaveCount(7);
    await expect(cards.first()).not.toHaveClass(/defect-/);
  });

  test("activates Scenario 1: Product Image Distortion", async ({ page }) => {
    await page.goto("/products?defect=product-image-distortion");

    // Verify metadata
    const metadata = page.locator("#omnisight-defect-metadata");
    await expect(metadata).toHaveAttribute("data-defect-active", "true");
    await expect(metadata).toHaveAttribute("data-defect-id", "product-image-distortion");
    await expect(metadata).toHaveAttribute("data-defect-category", "visual-distortion");

    // Verify DOM attribute and class applied
    const firstCard = page.locator(".product-card").first();
    await expect(firstCard).toHaveClass(/defect-product-image-distortion/);
    await expect(firstCard).toHaveAttribute("data-defect-applied", "product-image-distortion");

    // Verify visual/computed style symptom (stretched object-fit: fill, height 380px)
    const media = firstCard.locator(".product-card-media");
    const mediaHeight = await media.evaluate((el) => window.getComputedStyle(el).height);
    expect(mediaHeight).toBe("380px");

    const img = firstCard.locator(".product-image");
    const objectFit = await img.evaluate((el) => window.getComputedStyle(el).objectFit);
    expect(objectFit).toBe("fill");

    // Verify reversibility: navigating back without param restores normal styling
    await page.goto("/products");
    await expect(metadata).toHaveAttribute("data-defect-active", "false");
    await expect(firstCard).not.toHaveClass(/defect-product-image-distortion/);
    const restoredFit = await img.evaluate((el) => window.getComputedStyle(el).objectFit);
    expect(restoredFit).toBe("cover");
  });

  test("activates Scenario 2: Product Card Layout Breakage", async ({ page }) => {
    await page.goto("/products?defect=product-card-layout-break");

    const metadata = page.locator("#omnisight-defect-metadata");
    await expect(metadata).toHaveAttribute("data-defect-active", "true");
    await expect(metadata).toHaveAttribute("data-defect-id", "product-card-layout-break");
    await expect(metadata).toHaveAttribute("data-defect-category", "layout-shift");

    const firstCard = page.locator(".product-card").first();
    await expect(firstCard).toHaveClass(/defect-product-card-layout-break/);
    await expect(firstCard).toHaveAttribute("data-defect-applied", "product-card-layout-break");

    // Verify observable symptom: footer has absolute positioning with negative bottom overflow
    const footer = firstCard.locator(".product-card-footer");
    const position = await footer.evaluate((el) => window.getComputedStyle(el).position);
    expect(position).toBe("absolute");

    const bottom = await footer.evaluate((el) => window.getComputedStyle(el).bottom);
    expect(bottom).toBe("-45px");

    // Measure bounding boxes to verify that the footer physically overflows/protrudes below the card boundary
    const cardBox = await firstCard.boundingBox();
    const footerBox = await footer.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    if (cardBox && footerBox) {
      const footerBottom = footerBox.y + footerBox.height;
      const cardBottom = cardBox.y + cardBox.height;
      // Footer protrudes at least 15px below the bottom edge of the parent card
      expect(footerBottom).toBeGreaterThan(cardBottom + 15);
    }
  });

  test("activates Scenario 3: Low-Contrast Text Element", async ({ page }) => {
    await page.goto("/products?defect=low-contrast-text");

    const metadata = page.locator("#omnisight-defect-metadata");
    await expect(metadata).toHaveAttribute("data-defect-active", "true");
    await expect(metadata).toHaveAttribute("data-defect-id", "low-contrast-text");
    await expect(metadata).toHaveAttribute("data-defect-category", "color-contrast");

    const firstCard = page.locator(".product-card").first();
    await expect(firstCard).toHaveClass(/defect-low-contrast-text/);
    await expect(firstCard).toHaveAttribute("data-defect-applied", "low-contrast-text");

    // Verify observable symptom: snippet color is rgb(203, 213, 225) / #cbd5e1
    const snippet = firstCard.locator(".product-snippet");
    const color = await snippet.evaluate((el) => window.getComputedStyle(el).color);
    expect(color).toBe("rgb(203, 213, 225)");

    // Calculate actual contrast ratio against the card's background
    const contrastRatio = await firstCard.evaluate((card) => {
      const s = card.querySelector(".product-snippet") as HTMLElement;
      const fg = window.getComputedStyle(s).color; // rgb(203, 213, 225)
      const bg = window.getComputedStyle(card).backgroundColor; // rgb(255, 255, 255)

      function getLuminance(rgbStr: string) {
        const nums = rgbStr.match(/\d+/g)!.map(Number);
        const [r, g, b] = nums.map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }

      const l1 = getLuminance(bg);
      const l2 = getLuminance(fg);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    });

    // Contrast must be under 2.0 (well below WCAG AA 4.5:1 / 3:1 threshold)
    expect(contrastRatio).toBeLessThan(2.0);
  });

  test("activates Scenario 4: Mobile Navigation Overflow on mobile viewport", async ({ page }) => {
    // Set mobile viewport (390 x 844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/products?defect=mobile-nav-overflow");

    const metadata = page.locator("#omnisight-defect-metadata");
    await expect(metadata).toHaveAttribute("data-defect-active", "true");
    await expect(metadata).toHaveAttribute("data-defect-id", "mobile-nav-overflow");
    await expect(metadata).toHaveAttribute("data-defect-category", "responsive-overflow");

    const navbar = page.locator(".navbar");
    await expect(navbar).toHaveClass(/defect-mobile-nav-overflow/);

    // Verify observable symptom: document scrollWidth exceeds clientWidth at 390px
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(true);

    // Verify reversibility: clean route does NOT overflow at 390px
    await page.goto("/products");
    const cleanOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(cleanOverflow).toBe(false);
  });

  test("activating a visual defect does not corrupt shopping cart state or actions", async ({ page }) => {
    // Add item on defect-activated page
    await page.goto("/products?defect=product-image-distortion");
    const firstCard = page.locator(".product-card[data-product-id='prod-1']");
    await firstCard.locator("button").click();

    // Verify badge increments to 1
    await expect(page.getByRole("link", { name: /Cart with 1 items/i })).toBeVisible();

    // Navigate to /cart without defect param and verify cart state remains intact
    await page.getByRole("link", { name: /Cart with 1 items/i }).click();
    await expect(page).toHaveURL("/cart");
    await expect(page.locator(".cart-item-row")).toHaveCount(1);
    await expect(page.getByText("Aura Noise-Cancelling Headphones")).toBeVisible();
    await expect(page.locator(".summary-total-price")).toHaveText("$249.99");
  });
});
