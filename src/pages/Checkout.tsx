import { Link } from "react-router-dom";

export function Checkout() {
  return (
    <div className="page checkout-page">
      <header className="page-header">
        <span className="section-eyebrow">Day 1 Milestone</span>
        <h1 className="page-title">Checkout</h1>
      </header>

      <div className="status-card">
        <div className="status-icon" aria-hidden="true">💳</div>
        <h2>Checkout System in Development</h2>
        <p>
          The multi-step checkout workflow (shipping addresses, mock payment processing, and order confirmation)
          will be implemented in an upcoming milestone.
        </p>

        <div className="status-badge">
          <span>Status:</span> Placeholder Route (Day 1 Verified)
        </div>

        <div className="status-actions">
          <Link to="/products" className="btn btn-primary">
            Return to Store
          </Link>
          <Link to="/cart" className="btn btn-outline">
            ← Back to Cart
          </Link>
        </div>
      </div>
    </div>
  );
}
