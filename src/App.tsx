import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { Home } from "./pages/Home";
import { Products } from "./pages/Products";
import { ProductDetails } from "./pages/ProductDetails";
import { Cart } from "./pages/Cart";
import { Checkout } from "./pages/Checkout";
import { NotFound } from "./pages/NotFound";
import { DashboardLayout } from "./components/dashboard/DashboardLayout";
import { DashboardOverview } from "./pages/dashboard/DashboardOverview";
import { DashboardPlaceholder } from "./pages/dashboard/DashboardPlaceholder";

function StorefrontLayout() {
  return (
    <div className="app-container">
      <Navbar />
      <main className="main-content">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* QA Dashboard Shell (P4) */}
        <Route path="/qa" element={<DashboardLayout />}>
          <Route index element={<DashboardOverview />} />
          <Route
            path="jobs"
            element={
              <DashboardPlaceholder
                title="Inspection Jobs"
                description="View past and running visual inspection jobs, Playwright execution traces, and runtime duration logs."
                badge="Planned for Days 4–10"
              />
            }
          />
          <Route
            path="defects"
            element={
              <DashboardPlaceholder
                title="Defect Findings"
                description="Inspect visual regressions, VLM-annotated bounding box overlays, and defect severity triage."
                badge="Planned for Days 11–14"
              />
            }
          />
          <Route
            path="pull-requests"
            element={
              <DashboardPlaceholder
                title="GitHub Pull Requests"
                description="Manage automated fix branches, draft PR creation, commit history, and GitHub review workflows."
                badge="Planned for Days 18–19"
              />
            }
          />
        </Route>
        <Route path="/dashboard" element={<Navigate to="/qa" replace />} />

        {/* Mock Storefront Routes (OmniShop) */}
        <Route element={<StorefrontLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetails />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
