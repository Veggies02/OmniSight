import React, { useState } from "react";
import { Link } from "react-router-dom";
import type { Product } from "../data/products";
import { useCart } from "../hooks/useCart";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const { addItem } = useCart();
  const [addedNotice, setAddedNotice] = useState(false);

  const handleAddToCart = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!product.inStock) return;

    addItem(product, 1);
    setAddedNotice(true);
    setTimeout(() => {
      setAddedNotice(false);
    }, 2500);
  };

  return (
    <article className="product-card" data-product-id={product.id}>
      <Link
        to={`/products/${product.id}`}
        className="product-card-media"
        tabIndex={-1}
        aria-hidden="true"
      >
        <img
          src={product.image}
          alt={product.name}
          className="product-image"
          loading="lazy"
        />
        <span className="product-category-tag">{product.category}</span>
      </Link>

      <div className="product-card-body">
        <div className="product-meta">
          <span className="product-rating" aria-label={`Rated ${product.rating} out of 5 stars`}>
            ★ {product.rating.toFixed(1)}
            <span className="review-count">({product.reviewCount})</span>
          </span>
          <span className={`stock-indicator ${product.inStock ? "in-stock" : "out-of-stock"}`}>
            {product.inStock ? "In Stock" : "Out of Stock"}
          </span>
        </div>

        <h3 className="product-title">
          <Link to={`/products/${product.id}`} className="product-title-link">
            {product.name}
          </Link>
        </h3>

        <p className="product-snippet">{product.description}</p>

        <div className="product-card-footer">
          <span className="product-price">${product.price.toFixed(2)}</span>
          <div className="card-action-group">
            <Link
              to={`/products/${product.id}`}
              className="btn btn-outline btn-sm"
              aria-label={`View details for ${product.name}`}
            >
              Details
            </Link>
            <button
              type="button"
              className={`btn btn-sm ${product.inStock ? "btn-primary" : "btn-disabled"}`}
              onClick={handleAddToCart}
              disabled={!product.inStock}
              aria-label={
                addedNotice
                  ? `Added ${product.name} to cart`
                  : product.inStock
                  ? `Add ${product.name} to cart`
                  : `${product.name} is out of stock`
              }
            >
              {addedNotice ? "✓ Added" : product.inStock ? "Add to Cart" : "Out of Stock"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
