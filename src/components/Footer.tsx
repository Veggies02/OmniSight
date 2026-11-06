import { Link } from "react-router-dom";

const CURRENT_YEAR = new Date().getFullYear();

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-brand">
          <div className="footer-logo">
            <span className="logo-badge">OS</span>
            <span className="logo-text">OmniShop</span>
          </div>
          <p className="footer-tagline">
            Test bed e-commerce application for the OmniSight VLM inspection and repair framework.
          </p>
        </div>

        <div className="footer-links">
          <div className="footer-column">
            <h4>Shop</h4>
            <ul>
              <li><Link to="/products">All Products</Link></li>
              <li><Link to="/cart">Cart</Link></li>
              <li><Link to="/checkout">Checkout</Link></li>
            </ul>
          </div>
          <div className="footer-column">
            <h4>OmniSight</h4>
            <ul>
              <li><span className="footer-muted">Day 1: Baseline Store</span></li>
              <li><span className="footer-muted">Day 2: Shopping State</span></li>
              <li><span className="footer-muted">Day 3: Defect Injection</span></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>© {CURRENT_YEAR} OmniShop. Built for OmniSight UI Defect Detection & Self-Healing.</p>
      </div>
    </footer>
  );
}
