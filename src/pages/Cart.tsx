import { Link } from "react-router-dom";
import { useCart } from "../hooks/useCart";

export function Cart() {
  const { items, totalUnits, subtotal, updateQuantity, removeItem, clearCart } = useCart();

  if (items.length === 0) {
    return (
      <div className="page cart-page">
        <header className="page-header">
          <span className="section-eyebrow">Shopping Experience</span>
          <h1 className="page-title">Your Cart</h1>
        </header>

        <div className="status-card cart-empty-card">
          <div className="status-icon" aria-hidden="true">🛍️</div>
          <h2>Your cart is currently empty</h2>
          <p>
            You haven't added any products to your cart yet. Explore our curated catalogue
            of minimal essentials to find what you need.
          </p>
          <div className="status-actions">
            <Link to="/products" className="btn btn-primary btn-lg">
              Explore Products →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page cart-page">
      <header className="page-header cart-header-flex">
        <div>
          <span className="section-eyebrow">Shopping Experience</span>
          <h1 className="page-title">Shopping Cart</h1>
          <p className="page-description">
            Review your selected items ({totalUnits} total {totalUnits === 1 ? "unit" : "units"}).
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline btn-sm clear-cart-btn"
          onClick={clearCart}
          aria-label="Clear all items from shopping cart"
        >
          Clear Cart
        </button>
      </header>

      <div className="cart-layout">
        {/* Cart Items List */}
        <div className="cart-items-section" aria-label="Cart items list">
          <div className="cart-table-header" aria-hidden="true">
            <span className="th-product">Product</span>
            <span className="th-price">Price</span>
            <span className="th-qty">Quantity</span>
            <span className="th-total">Subtotal</span>
            <span className="th-action" />
          </div>

          <div className="cart-items-list">
            {items.map(({ product, quantity }) => {
              const lineTotal = product.price * quantity;

              return (
                <div key={product.id} className="cart-item-row" data-product-id={product.id}>
                  <div className="cart-item-info">
                    <img
                      src={product.image}
                      alt={product.name}
                      className="cart-item-image"
                    />
                    <div>
                      <span className="cart-item-cat">{product.category}</span>
                      <h3 className="cart-item-title">
                        <Link to={`/products/${product.id}`}>{product.name}</Link>
                      </h3>
                      <span className="cart-item-mobile-price">
                        ${product.price.toFixed(2)} each
                      </span>
                    </div>
                  </div>

                  <div className="cart-col-price">
                    ${product.price.toFixed(2)}
                  </div>

                  <div className="cart-col-qty">
                    <div className="quantity-selector-sm" aria-label={`Quantity for ${product.name}`}>
                      <button
                        type="button"
                        className="qty-btn-sm"
                        onClick={() => updateQuantity(product.id, quantity - 1)}
                        aria-label={`Decrease quantity of ${product.name}`}
                      >
                        −
                      </button>
                      <span className="qty-value-sm" aria-label={`Current quantity ${quantity}`}>
                        {quantity}
                      </span>
                      <button
                        type="button"
                        className="qty-btn-sm"
                        onClick={() => updateQuantity(product.id, quantity + 1)}
                        aria-label={`Increase quantity of ${product.name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="cart-col-total">
                    ${lineTotal.toFixed(2)}
                  </div>

                  <div className="cart-col-action">
                    <button
                      type="button"
                      className="btn-remove-item"
                      onClick={() => removeItem(product.id)}
                      aria-label={`Remove ${product.name} from cart`}
                      title="Remove item"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="cart-continue-wrap">
            <Link to="/products" className="link-arrow">
              ← Continue Shopping
            </Link>
          </div>
        </div>

        {/* Cart Order Summary Sidebar */}
        <aside className="cart-summary-sidebar" aria-label="Order summary">
          <div className="cart-summary-card">
            <h2 className="summary-title">Order Summary</h2>

            <div className="summary-row">
              <span className="summary-label">Total Units</span>
              <span className="summary-value">{totalUnits}</span>
            </div>

            <div className="summary-row">
              <span className="summary-label">Estimated Shipping</span>
              <span className="summary-value summary-free">Free</span>
            </div>

            <div className="summary-divider" />

            <div className="summary-row summary-total-row">
              <span className="summary-label">Subtotal</span>
              <span className="summary-total-price">${subtotal.toFixed(2)}</span>
            </div>

            <p className="summary-note">
              Taxes calculated during mock checkout. Free standard shipping on all demo orders.
            </p>

            <Link to="/checkout" className="btn btn-primary btn-lg btn-block">
              Proceed to Checkout →
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
