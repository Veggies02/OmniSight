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
import { DashboardJobs } from "./pages/dashboard/DashboardJobs";
import { DashboardJobDetails } from "./pages/dashboard/DashboardJobDetails";
import { DashboardDefects } from "./pages/dashboard/DashboardDefects";
import { DashboardPullRequests } from "./pages/dashboard/DashboardPullRequests";

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
          <Route path="jobs" element={<DashboardJobs />} />
          <Route path="jobs/:id" element={<DashboardJobDetails />} />
          <Route path="defects" element={<DashboardDefects />} />
          <Route path="pull-requests" element={<DashboardPullRequests />} />
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
