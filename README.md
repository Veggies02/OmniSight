# OmniSight — Mock E-Commerce Storefront (OmniShop)

**Day 1 Implementation: Baseline Mock E-Commerce Application**  
**Role:** Mock E-Commerce Application & Browser Automation  
**Assigned Developer:** Ajay  

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
- **npm** (Package management)

---

## 3. Project Structure

```text
OmniSight/
├── public/                 # Static assets
├── src/
│   ├── components/
│   │   ├── Navbar.tsx      # Reusable sticky navigation with active link states
│   │   ├── ProductCard.tsx # Reusable semantic product card component
│   │   └── Footer.tsx      # Reusable footer with brand and status notes
│   ├── pages/
│   │   ├── Home.tsx        # Hero section + 4 featured product cards + benefits
│   │   ├── Products.tsx    # Full catalog with search & category filtering
│   │   ├── ProductDetails.tsx # Route-based details (/products/:id) & fallback
│   │   ├── Cart.tsx        # Day 1 placeholder route explaining upcoming state
│   │   ├── Checkout.tsx    # Day 1 placeholder route explaining upcoming checkout
│   │   └── NotFound.tsx    # 404 fallback for unmatched routes
│   ├── data/
│   │   └── products.ts     # Separated typed product dataset with stable images
│   ├── App.tsx             # Root router setup with BrowserRouter and layout shell
│   ├── main.tsx            # React root mount with StrictMode
│   └── index.css           # Design tokens, typography, and responsive media queries
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
| `/products` | `Products` | Complete | Catalog grid with real-time category filtering and search |
| `/products/:id` | `ProductDetails` | Complete | Dynamic product route reading ID, renders specifications or 404 alert |
| `/cart` | `Cart` | Verified Placeholder | Clear status badge documenting planned Day 2 cart state implementation |
| `/checkout` | `Checkout` | Verified Placeholder | Clear status badge documenting planned multi-step checkout workflow |
| `*` | `NotFound` | Complete | Graceful 404 fallback page with return navigation links |

---

## 5. Getting Started Locally

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

Local development URL:
> **http://localhost:5173/** (or `http://127.0.0.1:5173/`)

### 3. Run Production Build & Type Check
```bash
npm run build
```

---

## 6. Responsive Viewport Support

The application is styled with CSS media queries and flex/grid layouts tested against standard viewports:
- **Desktop (1440 × 900)**: Two-column hero, 3-4 column product grids, sticky image gallery.
- **Tablet (768 × 1024)**: Single-column hero, 2-column product grid, responsive controls.
- **Mobile (390 × 844)**: Stacked single-column card layouts, full-width touch actions, zero horizontal scroll overflow.

---

## 7. Day 1 Milestone Status

### Completed Today
- [x] Initialized React 19 + TypeScript + Vite project without nested folders.
- [x] Implemented modular component architecture (`Navbar`, `ProductCard`, `Footer`).
- [x] Implemented decoupled typed product data (`src/data/products.ts`).
- [x] Implemented polished modern `Home` page with hero section, stats, and 4 featured product cards.
- [x] Configured 5 core routes with client-side routing using `react-router-dom`.
- [x] Added `Products` catalog with live search and category filters.
- [x] Added dynamic `ProductDetails` route reading `:id` with robust fallback for invalid IDs.
- [x] Added clean Day 1 placeholder pages for `/cart` and `/checkout`.
- [x] Verified zero TypeScript errors and successful production build (`tsc -b && vite build`).
- [x] Verified clean baseline with no intentional UI defects introduced.

### Incomplete / Upcoming Next Steps
- **Day 2**: Shopping Cart state management (React Context / custom hooks for add to cart, item quantities, total calculation).
- **Day 3**: Checkout workflows and controlled defect injection for OmniSight VLM inspection testing.
- **Future**: Playwright browser test suite, vision model inspection harness, and FastAPI backend integration.

---

## 8. Workstream Documentation

- **P4 (GitHub Integration & QA Dashboard)**: See [`docs/p4-development-setup.md`](docs/p4-development-setup.md) for P4 development setup, architecture, team boundaries, backend API contracts, and the 20-day implementation plan.

