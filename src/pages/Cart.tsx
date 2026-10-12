import { Link } from "react-router-dom";

export function Cart() {
  return (
    <div className="page cart-page">
      <header className="page-header">
        <span className="section-eyebrow">Day 1 Milestone</span>
        <h1 className="page-title">Shopping Cart</h1>
      </header>

      <div className="status-card">
        <div className="status-icon" aria-hidden="true">🛍️</div>
        <h2>Cart Functionality in Development</h2>
        <p>
          The shopping cart state management (add/remove items, quantity adjustments, and subtotal calculation)
          is scheduled for Day 2 implementation.
        </p>

        <div className="status-badge">
          <span>Status:</span> Placeholder Route (Day 1 Verified)
        </div>

        <div className="status-actions">
          <Link to="/products" className="btn btn-primary">
            Explore Products
          </Link>
          <Link to="/checkout" className="btn btn-outline">
            Preview Checkout →
          </Link>
        </div>
      </div>
    </div>
  );
}
