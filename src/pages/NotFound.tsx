import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="page not-found-page">
      <div className="status-card">
        <div className="status-icon" aria-hidden="true">404</div>
        <h2>Page Not Found</h2>
        <p>
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="status-actions">
          <Link to="/" className="btn btn-primary">
            Return to Home
          </Link>
          <Link to="/products" className="btn btn-outline">
            Browse Products
          </Link>
        </div>
      </div>
    </div>
  );
}
