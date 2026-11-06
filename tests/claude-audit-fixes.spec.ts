import { test, expect } from "@playwright/test";

test.describe("Claude Audit Re-evaluation & Verification Suite", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.localStorage.clear());
  });

  // Priority 1: B1 - React Router navigation in Footer
  test("B1: Footer navigation uses client-side routing without full page reload", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const footer = page.locator(".footer");
    await expect(footer).toBeVisible();

    // Verify footer links are React Router links (not standard external anchors)
    const productsLink = footer.getByRole("link", { name: "All Products" });
    const cartLink = footer.getByRole("link", { name: "Cart" });
    const checkoutLink = footer.getByRole("link", { name: "Checkout" });

    await expect(productsLink).toHaveAttribute("href", "/products");
    await expect(cartLink).toHaveAttribute("href", "/cart");
    await expect(checkoutLink).toHaveAttribute("href", "/checkout");

    // Click All Products and verify URL updates to /products
    await productsLink.click();
    await expect(page).toHaveURL("/products");
    await expect(page.getByRole("heading", { name: "All Products" })).toBeVisible();
  });

  // Priority 0: B2 - Stock availability in Cart and Checkout
  test("B2: Cart and Checkout strictly enforce stock availability", async ({ page }) => {
    // 1. Manually seed an out-of-stock item (prod-7, Apex Studio Monitor Speakers) into localStorage
    await page.evaluate(() => {
      window.localStorage.setItem(
        "omnishop-cart",
        JSON.stringify([
          { productId: "prod-7", quantity: 1 },
          { productId: "prod-1", quantity: 1 },
        ])
      );
    });

    // 2. Open cart and verify out-of-stock item has disabled + button and out-of-stock indicator
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".cart-item-row")).toHaveCount(2);

    const outOfStockRow = page.locator(".cart-item-row[data-product-id='prod-7']");
    await expect(outOfStockRow.locator(".stock-indicator.out-of-stock")).toBeVisible();

    const increaseBtn = outOfStockRow.getByRole("button", { name: /out of stock/i });
    await expect(increaseBtn).toBeDisabled();

    // Verify warning banner in cart summary
    await expect(page.getByText(/Some items in your cart are currently out of stock/i)).toBeVisible();

    // Checkout link is disabled
    const checkoutBtn = page.getByRole("link", { name: /Proceed to Checkout/i });
    await expect(checkoutBtn).toHaveClass(/btn-disabled/);
    await expect(checkoutBtn).toHaveAttribute("aria-disabled", "true");

    // 3. Navigate directly to checkout and verify order cannot be placed
    await page.goto("/checkout", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Your order contains out-of-stock items/i)).toBeVisible();
    const placeOrderBtn = page.getByTestId("place-order-btn");
    await expect(placeOrderBtn).toBeDisabled();
  });

  // Priority 1: B8 - Integer cents monetary precision
  test("B8: Monetary calculations use exact integer cents arithmetic", async ({ page }) => {
    await page.goto("/products", { waitUntil: "domcontentloaded" });

    // prod-1: $249.99, prod-3: $64.50
    await page.locator(".product-card[data-product-id='prod-1']").getByRole("button", { name: /Add/i }).click();
    await page.locator(".product-card[data-product-id='prod-3']").getByRole("button", { name: /Add/i }).click();

    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    // $249.99 + $64.50 = $314.49 exactly
    await expect(page.locator(".summary-total-price")).toHaveText("$314.49");

    // Increase prod-1 quantity to 3 ($249.99 * 3 = $749.97) + $64.50 = $814.47
    const row1 = page.locator(".cart-item-row[data-product-id='prod-1']");
    await row1.getByRole("button", { name: /Increase/i }).click();
    await row1.getByRole("button", { name: /Increase/i }).click();
    await expect(row1.locator(".qty-value-sm")).toHaveText("3");
    await expect(row1.locator(".cart-col-total")).toHaveText("$749.97");
    await expect(page.locator(".summary-total-price")).toHaveText("$814.47");
  });

  // Priority 1 & 2: A1 & B5 - Category filter semantics, search normalization, and URL synchronization
  test("A1 & B5: Category chips have accessible group semantics and sync with URL search params", async ({ page }) => {
    // Direct navigation with URL category param
    await page.goto("/products?category=Audio", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Audio Products | OmniShop");

    const categoryGroup = page.locator(".category-chips[role='group']");
    await expect(categoryGroup).toBeVisible();

    const audioBtn = categoryGroup.getByRole("button", { name: "Audio" });
    await expect(audioBtn).toHaveAttribute("aria-pressed", "true");
    await expect(audioBtn).toHaveClass(/active/);

    const allBtn = categoryGroup.getByRole("button", { name: "All" });
    await expect(allBtn).toHaveAttribute("aria-pressed", "false");

    // Products are filtered to 2 Audio products (prod-1 and prod-7)
    await expect(page.locator(".product-card")).toHaveCount(2);

    // Clicking All updates URL and shows all 7 products
    await allBtn.click();
    await expect(page).toHaveURL("/products");
    await expect(allBtn).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".product-card")).toHaveCount(7);

    // Search query normalization with whitespace trimming
    const searchInput = page.getByRole("searchbox", { name: "Search catalog" });
    await searchInput.fill("  headphones  ");
    await expect(page).toHaveURL(/search=headphones/);
    await expect(page.locator(".product-card")).toHaveCount(1);
    await expect(page.getByText("Aura Noise-Cancelling Headphones")).toBeVisible();

    // Fill with non-existent query to trigger empty state with "Clear Filters" button
    await searchInput.fill("non-matching-xyz-query");
    await expect(page.getByText("No products match your criteria")).toBeVisible();
    await page.getByRole("button", { name: "Clear Filters" }).click();
    await expect(page).toHaveURL("/products");
    await expect(page.locator(".product-card")).toHaveCount(7);
  });

  // Priority 2: B6 - Route-specific document titles
  test("B6: Document titles update dynamically across routes", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("OmniShop — Crafted Essentials for Modern Living");

    await page.goto("/products", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("All Products | OmniShop");

    await page.goto("/products/prod-1", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Aura Noise-Cancelling Headphones | OmniShop");

    await page.goto("/products/non-existent-id", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Product Not Found | OmniShop");

    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Shopping Cart | OmniShop");

    await page.goto("/checkout", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Checkout | OmniShop");

    await page.goto("/some-unknown-route", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Page Not Found | OmniShop");
  });

  // Priority 2: B4 - Anchor scroll offset
  test("B4: Featured section has scroll-margin-top offset for sticky navbar", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const featured = page.locator("#featured");
    await expect(featured).toBeVisible();

    const scrollMarginTop = await featured.evaluate((el) => {
      return window.getComputedStyle(el).scrollMarginTop;
    });
    // 5rem = 80px (at root 16px font-size)
    expect(parseInt(scrollMarginTop, 10)).toBeGreaterThanOrEqual(80);
  });

  // Priority 1: L3, S1, S2 - Image dimensions, aspect ratios, and fallback resilience
  test("L3, S1, S2: Images specify dimensions, aspect ratios, and error fallback resilience", async ({ page }) => {
    await page.goto("/products", { waitUntil: "domcontentloaded" });
    const firstImg = page.locator(".product-card .product-image").first();
    await expect(firstImg).toHaveAttribute("width", "800");
    await expect(firstImg).toHaveAttribute("height", "800");
    await expect(firstImg).toHaveAttribute("loading", "lazy");

    const mediaContainer = page.locator(".product-card .product-card-media").first();
    const aspectRatio = await mediaContainer.evaluate((el) => {
      return window.getComputedStyle(el).aspectRatio;
    });
    expect(aspectRatio).toBe("1 / 1");

    // Test error fallback behavior: simulate image failure by setting a broken source
    await firstImg.evaluate((img: HTMLImageElement) => {
      img.dispatchEvent(new Event("error"));
    });
    const currentSrc = await firstImg.getAttribute("src");
    expect(currentSrc).toContain("data:image/svg+xml");
  });

  // Priority 1 & 2: L1 & L2 - No overflow-x masking and dynamic viewport height
  test("L1 & L2: Standard baseline has zero horizontal overflow across responsive viewports without overflow masking", async ({ page }) => {
    const viewports = [
      { name: "Desktop", width: 1440, height: 900 },
      { name: "Tablet", width: 768, height: 1024 },
      { name: "Mobile", width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/products", { waitUntil: "domcontentloaded" });

      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasOverflow, `No overflow expected on /products at ${vp.name}`).toBe(false);

      const bodyOverflowX = await page.evaluate(() => {
        return window.getComputedStyle(document.body).overflowX;
      });
      // Verify body is NOT masking overflow with overflow-x: hidden
      expect(bodyOverflowX).not.toBe("hidden");
    }
  });

  // Follow-up: B2 - ProductDetails Add to Cart with custom quantity, badge update & storage persistence
  test("B2: ProductDetails correctly integrates Add to Cart, quantity selector, badge sync, and persistent storage", async ({ page }) => {
    // 1. Visit in-stock product details (/products/prod-1)
    await page.goto("/products/prod-1", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Aura Noise-Cancelling Headphones" })).toBeVisible();

    // Verify initial navbar badge is 0
    await expect(page.getByRole("link", { name: /Cart with 0 items/i })).toBeVisible();

    // 2. Adjust quantity to 2 using stepper
    const qtySelector = page.getByLabel("Quantity Selector");
    await expect(qtySelector).toBeVisible();
    await qtySelector.getByRole("button", { name: "Increase quantity" }).click();
    await expect(qtySelector.getByText("2")).toBeVisible();

    // 3. Click Add to Cart
    const addBtn = page.getByRole("button", { name: /Add 2 of Aura Noise-Cancelling Headphones to cart/i });
    await addBtn.click();

    // Notice appears
    await expect(page.getByRole("button", { name: /Added 2 of Aura/i })).toBeVisible();
    await expect(page.locator(".detail-add-btn")).toHaveText(/Added to Cart!/i);

    // Navbar badge immediately reflects 2 units
    await expect(page.getByRole("link", { name: /Cart with 2 items/i })).toBeVisible();

    // 4. Reload page and confirm persistent storage in localStorage
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /Cart with 2 items/i })).toBeVisible();

    // 5. Navigate to /cart and confirm line items and subtotal ($249.99 * 2 = $499.98)
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".cart-item-row")).toHaveCount(1);
    await expect(page.locator(".qty-value-sm")).toHaveText("2");
    await expect(page.locator(".summary-total-price")).toHaveText("$499.98");

    // 6. Visit out-of-stock product details (/products/prod-7)
    await page.goto("/products/prod-7", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("This product is currently out of stock and cannot be added to the cart.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add to Cart" })).not.toBeVisible();
  });

  // Follow-up: A3 - ProductCard accessibility (no nested links, screen reader category, tab index)
  test("A3: ProductCard provides accessible screen-reader category, eliminates nested links, and manages keyboard focus", async ({ page }) => {
    await page.goto("/products", { waitUntil: "domcontentloaded" });
    const firstCard = page.locator(".product-card").first();

    // 1. Verify no nested <a> tags (valid HTML5 structure)
    const nestedLinks = await firstCard.evaluate((card) => {
      const links = card.querySelectorAll("a");
      for (const link of links) {
        if (link.querySelector("a")) return true;
      }
      return false;
    });
    expect(nestedLinks).toBe(false);

    // 2. Verify media link is hidden from screen readers and tab order to prevent redundant announcements
    const mediaLink = firstCard.locator(".product-card-media");
    await expect(mediaLink).toHaveAttribute("tabindex", "-1");
    await expect(mediaLink).toHaveAttribute("aria-hidden", "true");

    // 3. Verify screen readers still receive the category via .sr-only inside .product-meta
    const srCategory = firstCard.locator(".product-meta .sr-only");
    await expect(srCategory).toBeVisible();
    await expect(srCategory).toHaveText(/Category: Audio/i);

    // 4. Verify primary product title link is accessible
    const titleLink = firstCard.locator(".product-title-link");
    await expect(titleLink).toHaveAttribute("href", "/products/prod-1");
  });

  // Follow-up: A4 - Reduced motion preference support
  test("A4: prefers-reduced-motion media query suppresses animations and transitions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/products", { waitUntil: "domcontentloaded" });

    const transitionDuration = await page.evaluate(() => {
      const card = document.querySelector(".product-card");
      if (!card) return "";
      return window.getComputedStyle(card).transitionDuration;
    });

    // When reduced motion is active, duration is clamped to 0.01ms (reported as 1e-05s, 0.00001s, 0.01ms, or 0s)
    expect(["0s", "0.00001s", "0.01ms", "1e-05s"]).toContain(transitionDuration);
  });

  // Follow-up: Content consistency reconciliation
  test("Content consistency: shipping and warranty claims are reconciled and non-contradictory", async ({ page }) => {
    // 1. Home delivery statement
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/2–4 Day/i)).toBeVisible();
    await expect(page.getByText(/Standard Delivery/i)).toBeVisible();

    // 2. ProductDetails shipping and warranty statements
    await page.goto("/products/prod-1", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Free standard shipping on all demo orders • Taxes included")).toBeVisible();
    await expect(page.getByText("Standard 2-4 business days")).toBeVisible();
    await expect(page.getByText("2 Years Full Coverage")).toBeVisible();

    // 3. Cart shipping statement (add an item first so summary card renders)
    await page.locator("button.detail-add-btn").click();
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Free standard shipping on all demo orders. No additional taxes or fees applied.")).toBeVisible();
  });
});
