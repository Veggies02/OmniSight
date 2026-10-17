import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { CartProvider } from "./context/CartContext";
import { DefectProvider } from "./context/DefectContext";
import { OmniSightProvider } from "./context/OmniSightContext";
import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import { Home } from "./pages/Home";
import { Products } from "./pages/Products";
import { ProductDetails } from "./pages/ProductDetails";
import { Cart } from "./pages/Cart";
import { Checkout } from "./pages/Checkout";
import { NotFound } from "./pages/NotFound";
import { ReviewDashboardPage } from "./pages/review/ReviewDashboardPage";
import { ProposalDetailPage } from "./pages/review/ProposalDetailPage";
import { ReviewHistoryPage } from "./pages/review/ReviewHistoryPage";

// OmniSight Platform Dashboard Components
import { OmniSightShell } from "./components/dashboard/OmniSightShell";
import { OverviewPage } from "./pages/dashboard/OverviewPage";
import { WebsitesPage } from "./pages/dashboard/WebsitesPage";
import { DefectAnalysisPage } from "./pages/dashboard/DefectAnalysisPage";
import { RepairCenterPage } from "./pages/dashboard/RepairCenterPage";
import { VerificationPage } from "./pages/dashboard/VerificationPage";
import { ActivityLogsPage } from "./pages/dashboard/ActivityLogsPage";

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
    <OmniSightProvider>
      <CartProvider>
        <BrowserRouter>
          <DefectProvider>
            <Routes>
              {/* OmniSight Platform Dashboard Routes */}
              <Route path="/dashboard" element={<OmniSightShell />}>
                <Route index element={<OverviewPage />} />
                <Route path="websites" element={<WebsitesPage />} />
                <Route path="analysis" element={<DefectAnalysisPage />} />
                <Route path="repairs" element={<RepairCenterPage />} />
                <Route path="verification" element={<VerificationPage />} />
                <Route path="activity" element={<ActivityLogsPage />} />
              </Route>

              {/* Target Monitored Storefront Routes (OmniShop) */}
              <Route element={<StorefrontLayout />}>
                <Route path="/" element={<Home />} />
                <Route path="/products" element={<Products />} />
                <Route path="/products/:id" element={<ProductDetails />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/checkout" element={<Checkout />} />

                {/* Sub-Review Proposals Routes */}
                <Route path="/review" element={<ReviewDashboardPage />} />
                <Route path="/review/proposals" element={<ReviewDashboardPage />} />
                <Route path="/review/proposals/:proposalId" element={<ProposalDetailPage />} />
                <Route path="/review/history" element={<ReviewHistoryPage />} />

                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </DefectProvider>
        </BrowserRouter>
      </CartProvider>
    </OmniSightProvider>
  );
}

export default App;
