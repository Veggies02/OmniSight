import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { products } from "../data/products";
import { useCart } from "../hooks/useCart";

export function ProductDetails() {
  const { id } = useParams<{ id: string }>();
  const product = products.find((p) => p.id === id);
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [addedNotice, setAddedNotice] = useState(false);

  if (!product) {
    return (
      <div className="page product-not-found-page">
        <div className="status-card">
          <div className="status-icon">🔍</div>
          <h2>Product Not Found</h2>
          <p>
            We couldn't find a product matching ID <code>{id || "unknown"}</code>.
            It may have been removed or the URL could be incorrect.
          </p>
          <div className="status-actions">
            <Link to="/products" className="btn btn-primary">
              ← Return to Catalog
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleAddToCart = () => {
    if (!product.inStock) return;
    addItem(product, quantity);
    setAddedNotice(true);
    setTimeout(() => {
      setAddedNotice(false);
    }, 2000);
  };

  return (
    <div className="page product-details-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span className="crumb-separator">/</span>
        <Link to="/products">Products</Link>
        <span className="crumb-separator">/</span>
        <span className="crumb-current" aria-current="page">
          {product.name}
        </span>
      </nav>

      <div className="product-detail-layout">
        <div className="product-detail-gallery">
          <div className="detail-image-wrapper">
            <img
              src={product.image}
              alt={product.name}
              className="detail-image"
            />
          </div>
        </div>

        <div className="product-detail-info">
          <span className="product-category-tag">{product.category}</span>
          <h1 className="detail-title">{product.name}</h1>

          <div className="product-meta">
            <span className="product-rating">
              ★ {product.rating.toFixed(1)}
              <span className="review-count"> ({product.reviewCount} customer reviews)</span>
            </span>
            <span className={`stock-indicator ${product.inStock ? "in-stock" : "out-of-stock"}`}>
              {product.inStock ? "In Stock & Ready to Ship" : "Out of Stock"}
            </span>
          </div>

          <div className="detail-price-box">
            <span className="detail-price">${product.price.toFixed(2)}</span>
            <span className="detail-vat">Taxes included • Free shipping over $50</span>
          </div>

          <div className="detail-description">
            <h3>Overview</h3>
            <p>{product.description}</p>
          </div>

          <div className="detail-specs">
            <div className="spec-row">
              <span className="spec-label">SKU</span>
              <span className="spec-value">{product.id.toUpperCase()}</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Warranty</span>
              <span className="spec-value">2 Years Full Coverage</span>
            </div>
            <div className="spec-row">
              <span className="spec-label">Shipping</span>
              <span className="spec-value">Standard 2-4 business days</span>
            </div>
          </div>

          {product.inStock ? (
            <div className="detail-purchase-row">
              <div className="quantity-selector" aria-label="Quantity Selector">
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  aria-label="Decrease quantity"
                  disabled={quantity <= 1}
                >
                  −
                </button>
                <span className="qty-value" aria-label={`Current quantity ${quantity}`}>
                  {quantity}
                </span>
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => setQuantity((q) => q + 1)}
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                className="btn btn-primary btn-lg detail-add-btn"
                onClick={handleAddToCart}
                aria-label={`Add ${quantity} of ${product.name} to cart`}
              >
                {addedNotice ? "✓ Added to Cart!" : "Add to Cart"}
              </button>
            </div>
          ) : (
            <div className="out-of-stock-banner" role="alert">
              This product is currently out of stock and cannot be added to the cart.
            </div>
          )}

          <div className="detail-secondary-actions">
            <Link to="/products" className="link-arrow">
              ← Return to Catalogue
            </Link>
            <Link to="/cart" className="link-arrow">
              View Shopping Cart →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
