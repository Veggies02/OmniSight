import { Link } from "react-router-dom";
import { ProductCard } from "../components/ProductCard";
import { products } from "../data/products";

export function Home() {
  const featuredProducts = products.filter((p) => p.featured);

  return (
    <div className="page home-page">
      {/* Hero Section */}
      <section className="hero-section" aria-labelledby="hero-heading">
        <div className="hero-container">
          <div className="hero-content">
            <span className="hero-eyebrow">Curated Minimal Design</span>
            <h1 id="hero-heading" className="hero-title">
              Crafted essentials for modern living.
            </h1>
            <p className="hero-description">
              Discover thoughtfully designed products that blend functional utility,
              tactile materials, and enduring aesthetic harmony into your everyday routine.
            </p>
            <div className="hero-actions">
              <Link to="/products" className="btn btn-primary btn-lg">
                Shop Now →
              </Link>
              <a href="#featured" className="btn btn-outline btn-lg">
                Explore Collection
              </a>
            </div>
            <div className="hero-stats">
              <div className="stat-item">
                <span className="stat-value">100%</span>
                <span className="stat-label">Authentic Design</span>
              </div>
              <div className="stat-divider" aria-hidden="true" />
              <div className="stat-item">
                <span className="stat-value">2-Day</span>
                <span className="stat-label">Express Delivery</span>
              </div>
              <div className="stat-divider" aria-hidden="true" />
              <div className="stat-item">
                <span className="stat-value">30-Day</span>
                <span className="stat-label">Effortless Returns</span>
              </div>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-image-wrapper">
              <img
                src="https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=80"
                alt="OmniShop curated modern storefront collection"
                className="hero-image"
                loading="eager"
              />
              <div className="hero-floating-badge">
                <span className="badge-dot" />
                <span>OmniSight Test Bed Ready</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Products Section */}
      <section id="featured" className="section-featured" aria-labelledby="featured-heading">
        <div className="section-header">
          <div>
            <span className="section-eyebrow">Handpicked Selection</span>
            <h2 id="featured-heading" className="section-title">
              Featured Products
            </h2>
          </div>
          <Link to="/products" className="link-arrow">
            View all products <span>→</span>
          </Link>
        </div>

        <div className="product-grid">
          {featuredProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      {/* Value Proposition Banner */}
      <section className="section-features" aria-label="Store Benefits">
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon" aria-hidden="true">🛡️</div>
            <h3>Premium Materials</h3>
            <p>Every piece is sourced from responsible craftspeople using vetted materials.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon" aria-hidden="true">⚡</div>
            <h3>Seamless Checkout</h3>
            <p>Frictionless cart and checkout experience designed for speed and clarity.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon" aria-hidden="true">🎯</div>
            <h3>Quality Guaranteed</h3>
            <p>Comprehensive 2-year manufacturer warranty on all electronic hardware.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
