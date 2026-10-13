import { Link, NavLink } from "react-router-dom";

export function Navbar() {
  return (
    <header className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo" aria-label="OmniShop Home">
          <span className="logo-badge">OS</span>
          <span className="logo-text">OmniShop</span>
        </Link>

        <nav className="navbar-nav" aria-label="Main Navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `nav-link ${isActive ? "nav-link-active" : ""}`
            }
          >
            Home
          </NavLink>
          <NavLink
            to="/products"
            className={({ isActive }) =>
              `nav-link ${isActive ? "nav-link-active" : ""}`
            }
          >
            Products
          </NavLink>
          <NavLink
            to="/cart"
            className={({ isActive }) =>
              `nav-link cart-link ${isActive ? "nav-link-active" : ""}`
            }
            aria-label="Shopping Cart"
          >
            <span className="cart-icon" aria-hidden="true">🛒</span>
            <span>Cart</span>
          </NavLink>
          <NavLink
            to="/qa"
            className={({ isActive }) =>
              `nav-link qa-nav-pill ${isActive ? "nav-link-active" : ""}`
            }
            aria-label="OmniSight QA Dashboard"
          >
            <span className="qa-pulse-dot" aria-hidden="true" />
            <span>QA Dashboard</span>
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
