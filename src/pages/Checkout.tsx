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
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  const validateField = (name: string, value: string): string => {
    switch (name) {
      case "fullName":
        if (!value.trim()) return "Full name is required";
        if (value.trim().length < 2) return "Full name must be at least 2 characters";
        return "";
      case "email":
        if (!value.trim()) return "Email address is required";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
          return "Please enter a valid email address (e.g., name@example.com)";
        }
        return "";
      case "address":
        if (!value.trim()) return "Street address is required";
        if (value.trim().length < 5) return "Please enter a complete street address";
        return "";
      case "city":
        if (!value.trim()) return "City is required";
        return "";
      case "postalCode":
        if (!value.trim()) return "Postal code is required";
        if (!/^\d{4,10}$|^[a-zA-Z0-9\s-]{3,10}$/.test(value.trim())) {
          return "Please enter a valid postal or ZIP code";
        }
        return "";
      default:
        return "";
    }
  };

  const errors = {
    fullName: validateField("fullName", formData.fullName),
    email: validateField("email", formData.email),
    address: validateField("address", formData.address),
    city: validateField("city", formData.city),
    postalCode: validateField("postalCode", formData.postalCode),
  };

  const hasErrors = Object.values(errors).some((err) => err.length > 0);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
  };

  const handleConfirmDemoOrder = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (items.length === 0 || hasErrors) return;
    setIsOrdered(true);
    clearCart();
  };

  if (isOrdered) {
    return (
      <div className="page checkout-page">
        <div className="status-card checkout-success-card" data-testid="order-confirmed-card">
          <div className="status-icon" aria-hidden="true">🎉</div>
          <h2>Demo Order Confirmed!</h2>
          <p>
            Thank you, <strong>{formData.fullName}</strong>. Your mock purchase has been logged
            for testing purposes. No real payment was collected and no items will be shipped.
          </p>

          <div className="order-details-box">
            <div className="spec-row">
              <span className="spec-label">Confirmation Number</span>
              <span className="spec-value" data-testid="confirmation-number">OS-DEMO-{Math.floor(100000 + Math.random() * 900000)}</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Confirmation Email</span>
              <span className="spec-value" data-testid="confirmation-email">{formData.email}</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Delivery Address</span>
              <span className="spec-value" data-testid="confirmation-address">{formData.address}, {formData.city} {formData.postalCode}</span>
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
          <form id="demo-checkout-form" onSubmit={handleConfirmDemoOrder} noValidate>
            <div className="form-group">
              <label htmlFor="fullName">Full Name</label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                required
                className={`form-input ${((touched.fullName || submitted) && errors.fullName) ? "input-error" : ""}`}
                value={formData.fullName}
                onChange={handleInputChange}
                onBlur={handleBlur}
                aria-invalid={!!((touched.fullName || submitted) && errors.fullName)}
                aria-describedby={((touched.fullName || submitted) && errors.fullName) ? "fullName-error" : undefined}
              />
              {((touched.fullName || submitted) && errors.fullName) && (
                <span id="fullName-error" className="field-error-message" role="alert">
                  {errors.fullName}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className={`form-input ${((touched.email || submitted) && errors.email) ? "input-error" : ""}`}
                value={formData.email}
                onChange={handleInputChange}
                onBlur={handleBlur}
                aria-invalid={!!((touched.email || submitted) && errors.email)}
                aria-describedby={((touched.email || submitted) && errors.email) ? "email-error" : undefined}
              />
              {((touched.email || submitted) && errors.email) && (
                <span id="email-error" className="field-error-message" role="alert">
                  {errors.email}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="address">Street Address</label>
              <input
                id="address"
                name="address"
                type="text"
                required
                className={`form-input ${((touched.address || submitted) && errors.address) ? "input-error" : ""}`}
                value={formData.address}
                onChange={handleInputChange}
                onBlur={handleBlur}
                aria-invalid={!!((touched.address || submitted) && errors.address)}
                aria-describedby={((touched.address || submitted) && errors.address) ? "address-error" : undefined}
              />
              {((touched.address || submitted) && errors.address) && (
                <span id="address-error" className="field-error-message" role="alert">
                  {errors.address}
                </span>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="city">City</label>
                <input
                  id="city"
                  name="city"
                  type="text"
                  required
                  className={`form-input ${((touched.city || submitted) && errors.city) ? "input-error" : ""}`}
                  value={formData.city}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  aria-invalid={!!((touched.city || submitted) && errors.city)}
                  aria-describedby={((touched.city || submitted) && errors.city) ? "city-error" : undefined}
                />
                {((touched.city || submitted) && errors.city) && (
                  <span id="city-error" className="field-error-message" role="alert">
                    {errors.city}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="postalCode">Postal Code</label>
                <input
                  id="postalCode"
                  name="postalCode"
                  type="text"
                  required
                  className={`form-input ${((touched.postalCode || submitted) && errors.postalCode) ? "input-error" : ""}`}
                  value={formData.postalCode}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  aria-invalid={!!((touched.postalCode || submitted) && errors.postalCode)}
                  aria-describedby={((touched.postalCode || submitted) && errors.postalCode) ? "postalCode-error" : undefined}
                />
                {((touched.postalCode || submitted) && errors.postalCode) && (
                  <span id="postalCode-error" className="field-error-message" role="alert">
                    {errors.postalCode}
                  </span>
                )}
              </div>
            </div>

            <div className="checkout-banner-notice">
              🛡️ <strong>Demo Simulation Only:</strong> This checkout flow is designed for OmniSight
              UI testing. No payment gateway or credit card collection is connected.
            </div>

            <button type="submit" className="btn btn-primary btn-lg btn-block" data-testid="place-order-btn">
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
