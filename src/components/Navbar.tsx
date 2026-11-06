import { Link, NavLink } from "react-router-dom";
import { useCart } from "../hooks/useCart";
import { useDefects } from "../hooks/useDefects";

export function Navbar() {
  const { totalUnits } = useCart();
  const { isDefectActive } = useDefects();
  const isNavOverflowActive = isDefectActive("mobile-nav-overflow");

  return (
    <header
      className={`navbar ${isNavOverflowActive ? "defect-mobile-nav-overflow" : ""}`}
      data-testid="navbar"
      data-defect-applied={isNavOverflowActive ? "mobile-nav-overflow" : undefined}
    >
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
            aria-label={`Shopping Cart with ${totalUnits} items`}
          >
            <span className="cart-icon" aria-hidden="true">🛒</span>
            <span>Cart</span>
            <span className="cart-badge" aria-label={`${totalUnits} items in cart`}>
              {totalUnits}
            </span>
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
