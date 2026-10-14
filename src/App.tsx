import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "./context/CartContext";
import { DefectProvider } from "./context/DefectContext";
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

export function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <DefectProvider>
          <div className="app-container">
            <Navbar />
            <main className="main-content">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/products" element={<Products />} />
                <Route path="/products/:id" element={<ProductDetails />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/review" element={<ReviewDashboardPage />} />
                <Route path="/review/proposals" element={<ReviewDashboardPage />} />
                <Route path="/review/proposals/:proposalId" element={<ProposalDetailPage />} />
                <Route path="/review/history" element={<ReviewHistoryPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </main>
            <Footer />
          </div>
        </DefectProvider>
      </BrowserRouter>
    </CartProvider>
  );
}

export default App;
