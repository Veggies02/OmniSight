import { useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ProductCard } from "../components/ProductCard";
import { products } from "../data/products";

export function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCategory = searchParams.get("category") || "All";
  const searchQuery = searchParams.get("search") || "";

  useEffect(() => {
    if (selectedCategory !== "All") {
      document.title = `${selectedCategory} Products | OmniShop`;
    } else {
      document.title = "All Products | OmniShop";
    }
  }, [selectedCategory]);

  const categories = useMemo(() => {
    const list = Array.from(new Set(products.map((p) => p.category)));
    return ["All", ...list];
  }, []);

  const handleCategorySelect = (cat: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (cat === "All") {
        next.delete("category");
      } else {
        next.set("category", cat);
      }
      return next;
    });
  };

  const handleSearchChange = (val: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const trimmed = val.trim();
      if (!trimmed) {
        next.delete("search");
      } else {
        next.set("search", trimmed);
      }
      return next;
    });
  };

  const handleClearFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("category");
      next.delete("search");
      return next;
    });
  };

  const filteredProducts = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory =
        selectedCategory === "All" || product.category === selectedCategory;
      const matchesSearch =
        !normalizedQuery ||
        product.name.toLowerCase().includes(normalizedQuery) ||
        product.description.toLowerCase().includes(normalizedQuery);
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

  return (
    <div className="page products-page">
      <header className="page-header">
        <span className="section-eyebrow">Our Full Catalog</span>
        <h1 className="page-title">All Products</h1>
        <p className="page-description">
          Browse our complete catalog of curated essentials, engineered for quality and everyday utility.
        </p>
      </header>

      {/* Filter / Search Controls */}
      <div className="catalog-controls">
        <div className="category-chips" role="group" aria-label="Filter by category">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={selectedCategory === cat}
              className={`chip-btn ${selectedCategory === cat ? "active" : ""}`}
              onClick={() => handleCategorySelect(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="search-box">
          <input
            type="search"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="search-input"
            aria-label="Search catalog"
          />
        </div>
      </div>

      {/* Product Results */}
      {filteredProducts.length > 0 ? (
        <div className="product-grid">
          {filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p className="empty-title">No products match your criteria</p>
          <p className="empty-subtitle">
            Try adjusting your search terms or selecting a different category filter.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleClearFilters}
          >
            Clear Filters
          </button>
        </div>
      )}
    </div>
  );
}
