import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "../hooks/useCart";

export function Checkout() {
  const { items, totalUnits, subtotal, clearCart } = useCart();
  const [isOrdered, setIsOrdered] = useState(false);
  const [formData, setFormData] = useState({
    fullName: "Alex Rivera",
    email: "alex.rivera@example.com",
    address: "742 Evergreen Terrace",
    city: "Springfield",
    postalCode: "97477",
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleConfirmDemoOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return;
    setIsOrdered(true);
    clearCart();
  };

  if (isOrdered) {
    return (
      <div className="page checkout-page">
        <div className="status-card checkout-success-card">
          <div className="status-icon" aria-hidden="true">🎉</div>
          <h2>Demo Order Confirmed!</h2>
          <p>
            Thank you, <strong>{formData.fullName}</strong>. Your mock purchase has been logged
            for testing purposes. No real payment was collected and no items will be shipped.
          </p>

          <div className="order-details-box">
            <div className="spec-row">
              <span className="spec-label">Confirmation Number</span>
              <span className="spec-value">OS-DEMO-{Math.floor(100000 + Math.random() * 900000)}</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Confirmation Email</span>
              <span className="spec-value">{formData.email}</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Delivery Address</span>
              <span className="spec-value">{formData.address}, {formData.city}</span>
            </div>
          </div>

          <div className="status-actions">
            <Link to="/products" className="btn btn-primary btn-lg">
              Return to Catalog
            </Link>
            <Link to="/" className="btn btn-outline btn-lg">
              Go to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="page checkout-page">
        <header className="page-header">
          <span className="section-eyebrow">Checkout Flow</span>
          <h1 className="page-title">Checkout</h1>
        </header>

        <div className="status-card">
          <div className="status-icon" aria-hidden="true">🛒</div>
          <h2>Cannot proceed with an empty cart</h2>
          <p>
            You must add at least one item to your shopping cart before you can initiate checkout.
          </p>
          <div className="status-actions">
            <Link to="/products" className="btn btn-primary">
              Browse Products →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page checkout-page">
      <header className="page-header">
        <span className="section-eyebrow">Demo Checkout Experience</span>
        <h1 className="page-title">Checkout Summary</h1>
        <p className="page-description">
          Review your items and shipping details below. (Mock checkout: no real payments or cards).
        </p>
      </header>

      <div className="checkout-layout">
        {/* Mock Shipping Details Form */}
        <section className="checkout-form-section" aria-labelledby="shipping-heading">
          <h2 id="shipping-heading" className="checkout-section-title">
            1. Shipping Information
          </h2>
          <form id="demo-checkout-form" onSubmit={handleConfirmDemoOrder}>
            <div className="form-group">
              <label htmlFor="fullName">Full Name</label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                required
                className="form-input"
                value={formData.fullName}
                onChange={handleInputChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="form-input"
                value={formData.email}
                onChange={handleInputChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="address">Street Address</label>
              <input
                id="address"
                name="address"
                type="text"
                required
                className="form-input"
                value={formData.address}
                onChange={handleInputChange}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="city">City</label>
                <input
                  id="city"
                  name="city"
                  type="text"
                  required
                  className="form-input"
                  value={formData.city}
                  onChange={handleInputChange}
                />
              </div>

              <div className="form-group">
                <label htmlFor="postalCode">Postal Code</label>
                <input
                  id="postalCode"
                  name="postalCode"
                  type="text"
                  required
                  className="form-input"
                  value={formData.postalCode}
                  onChange={handleInputChange}
                />
              </div>
            </div>

            <div className="checkout-banner-notice">
              🛡️ <strong>Demo Simulation Only:</strong> This checkout flow is designed for OmniSight
              UI testing. No payment gateway or credit card collection is connected.
            </div>

            <button type="submit" className="btn btn-primary btn-lg btn-block">
              Place Demo Order (${subtotal.toFixed(2)})
            </button>
          </form>
        </section>

        {/* Order Items Review */}
        <aside className="checkout-review-sidebar" aria-label="Review items">
          <div className="cart-summary-card">
            <h2 className="summary-title">Order Review ({totalUnits} units)</h2>

            <div className="checkout-items-list">
              {items.map(({ product, quantity }) => (
                <div key={product.id} className="checkout-item-preview">
                  <img
                    src={product.image}
                    alt={product.name}
                    className="checkout-item-thumb"
                  />
                  <div className="checkout-item-meta">
                    <span className="checkout-item-name">{product.name}</span>
                    <span className="checkout-item-sub">
                      Qty: {quantity} × ${product.price.toFixed(2)}
                    </span>
                  </div>
                  <span className="checkout-item-total">
                    ${(product.price * quantity).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            <div className="summary-divider" />

            <div className="summary-row">
              <span className="summary-label">Items Subtotal</span>
              <span className="summary-value">${subtotal.toFixed(2)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Shipping</span>
              <span className="summary-value summary-free">Free</span>
            </div>

            <div className="summary-divider" />

            <div className="summary-row summary-total-row">
              <span className="summary-label">Order Total</span>
              <span className="summary-total-price">${subtotal.toFixed(2)}</span>
            </div>

            <Link to="/cart" className="link-arrow edit-cart-link">
              ← Edit Cart Items
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
