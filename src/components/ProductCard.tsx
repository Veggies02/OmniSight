import { Link } from "react-router-dom";
import type { Product } from "../data/products";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
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
          <Link
            to={`/products/${product.id}`}
            className="btn btn-secondary btn-sm"
            aria-label={`View details for ${product.name}`}
          >
            View Details
          </Link>
        </div>
      </div>
    </article>
  );
}
