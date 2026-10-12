# OmniSight — Mock E-Commerce Storefront (OmniShop)

**Day 1 Implementation: Baseline Mock E-Commerce, Functional Shopping Cart & Browser Automation**
**Role:** Mock E-Commerce Application & Browser Automation
**Assigned Developer:** Ajay
**Feature Branch:** `feature/ajay-cart-state`

---

## 1. Overview

**OmniShop** is the mock e-commerce test website created for the **OmniSight** system. OmniSight is an AI-powered UI defect detection and self-healing system that opens web applications via Playwright, analyzes visual evidence with a Vision-Language Model (VLM), detects defects, locates source code, and proposes automated fixes.

OmniShop serves as the benchmark target application that will eventually undergo automated visual inspections.

---

## 2. Technology Stack

- **React 19** (`react`, `react-dom`)
- **TypeScript** (Strict mode)
- **Vite 6** (Fast build tool & HMR)
- **React Router DOM v7** (Declarative client-side routing)
- **Vanilla CSS** (Custom responsive design tokens, glassmorphism, responsive grids)
- **Playwright** (`@playwright/test` for Chromium end-to-end and responsive validation)
- **npm** (Package management)

---

## 3. Project Structure

```text
OmniSight/
├── artifacts/
│   └── screenshots/        # Clean baseline screenshots for OmniSight VLM inspection
├── public/                 # Static assets
├── src/
│   ├── components/
│   │   ├── Navbar.tsx      # Reusable sticky navigation with live cart badge
│   │   ├── ProductCard.tsx # Reusable card with Add to Cart & stock status
│   │   └── Footer.tsx      # Reusable footer with brand and status notes
│   ├── context/
│   │   └── CartContext.tsx # React Context & Reducer for cart state and persistence
│   ├── hooks/
│   │   └── useCart.ts      # Custom hook to access shared cart operations
│   ├── pages/
│   │   ├── Home.tsx        # Hero section + 4 featured product cards + benefits
│   │   ├── Products.tsx    # Full catalog with search & category filtering
│   │   ├── ProductDetails.tsx # Route-based details (/products/:id) & quantity adder
│   │   ├── Cart.tsx        # Functional shopping cart with line totals & controls
│   │   ├── Checkout.tsx    # Demo checkout summary with shipping form & confirmation
│   │   └── NotFound.tsx    # 404 fallback for unmatched routes
│   ├── data/
│   │   └── products.ts     # Separated typed product dataset with stable images
│   ├── App.tsx             # Root router setup wrapped in CartProvider
│   ├── main.tsx            # React root mount with StrictMode
│   └── index.css           # Design tokens, typography, and responsive media queries
├── tests/
│   ├── shopping-cart.spec.ts # Cart operations, stock disabling, and persistence
│   ├── checkout.spec.ts     # Checkout validation and order placement simulation
│   ├── responsive.spec.ts   # Multi-viewport (1440x900, 768x1024, 390x844) overflow checks
│   └── screenshots.spec.ts  # Baseline screenshot capture
├── playwright.config.ts    # Playwright configuration with webServer integration
├── index.html              # HTML shell with accessibility metadata
├── package.json            # Scripts and dependencies
├── tsconfig.json           # TypeScript configuration
└── vite.config.ts          # Vite configuration
```

---

## 4. Configured Page Routes

| Route | Component | Status | Description |
|---|---|---|---|
| `/` | `Home` | Complete | Brand hero section, "Shop Now" CTA, and 4 featured product cards |
| `/products` | `Products` | Complete | Catalog grid with real-time category filtering, search, and direct Add to Cart |
| `/products/:id` | `ProductDetails` | Complete | Dynamic product route with quantity selector, out-of-stock guard, and specs |
| `/cart` | `Cart` | Complete | Functional cart: quantity adjustments (+/−), item removal, line totals, and subtotal |
| `/checkout` | `Checkout` | Complete | Demo checkout: customer shipping form, order preview, and demo confirmation |
| `*` | `NotFound` | Complete | Graceful 404 fallback page with return navigation links |

---

## 5. Milestone Status

- **Day 1 — Functional Shopping Cart**: Complete
- **Shopping Cart Verification & Browser Automation**: Complete (23 automated Playwright tests passing, 0 failures)

### Cart State Architecture
- **State Engine**: Implemented using React Context (`CartContext`) paired with a reducer function (`cartReducer`) in [`src/context/CartContext.tsx`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/src/context/CartContext.tsx).
- **Custom Hook**: [`useCart`](file:///Users/ajaykowkuntla/Desktop/%20OmniSight/src/hooks/useCart.ts) exports clean helpers:
  - `addItem(product, quantity)`
  - `removeItem(productId)`
  - `updateQuantity(productId, quantity)`
  - `clearCart()`
  - Computed `totalUnits` and `subtotal`
- **Zero Redundant State**: Total item units and subtotal are derived on the fly without state synchronization pitfalls.

### Persistence (`localStorage`)
- **Key**: `"omnishop-cart"`
- **Hydration**: Validates stored JSON on initial load. Checks that IDs match valid products in catalog and quantities are positive integers.
- **Resilience**: Malformed JSON or storage quota errors safely fall back to an empty cart without crashing the application. Tested for React 19 `StrictMode` safety.

---

## 6. Getting Started Locally

### Prerequisites
- Node.js (v18+ recommended)
- npm (v9+ recommended)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Development Server
```bash
npm run dev
```
Local development URL: **http://localhost:5173/** (or `http://127.0.0.1:5173/`)

### 3. Run Production Build & Type Check
```bash
npm run build
```

### 4. Run Automated Playwright E2E Tests
```bash
npm run test:e2e
```

---

## 7. Automated Test Suite & Coverage

The automated test suite runs via `@playwright/test` against the local Vite server:

| Test File | Test Cases | Status | Description |
|---|---|---|---|
| `tests/shopping-cart.spec.ts` | 10 | Passed | Catalog rendering, dynamic routes, 404 fallback, out-of-stock disabling, single and multiple adds, quantity increments/decrements, item removal, cart clearing, refresh persistence, corrupted JSON handling, and invalid ID filtering |
| `tests/checkout.spec.ts` | 2 | Passed | Empty-cart checkout prevention, shipping form required field validation, and demo order placement clearing the cart |
| `tests/responsive.spec.ts` | 9 | Passed | Desktop (1440x900), Tablet (768x1024), and Mobile (390x844) overflow checks (`scrollWidth <= clientWidth`) on Home, Catalog, and Cart |
| `tests/screenshots.spec.ts` | 1 (7 captures) | Passed | Baseline screenshots for Home, Catalog, Details, Cart, Checkout, Mobile Catalog, and Mobile Cart |

**Test Results Summary**:
- **Total Tests**: 23 passed (0 failed, 0 flaky)
- **Duration**: ~6.9s

### Captured Artifacts Location
Screenshots are saved to: `artifacts/screenshots/`:
- `01-home-desktop.png`
- `02-products-desktop.png`
- `03-product-details-desktop.png`
- `04-cart-with-items-desktop.png`
- `05-checkout-desktop.png`
- `06-products-mobile.png`
- `07-cart-mobile.png`

---

## 8. Known Limitations & Next Steps
- **Demo Scope**: Checkout does not connect to real payment processors (intentionally simulated for UI testing).
- **Upcoming Milestones**:
  - Controlled UI defect injection into component variants for OmniSight VLM inspection testing.
  - Integration with Shilpa's backend inspection orchestration.
