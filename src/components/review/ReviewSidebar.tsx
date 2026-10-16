import React from "react";
import { Link, useLocation } from "react-router-dom";

export const ReviewSidebar: React.FC = () => {
  const location = useLocation();

  const isLinkActive = (path: string) => {
    if (path === "/review" && (location.pathname === "/review" || location.pathname === "/review/proposals")) {
      return true;
    }
    return location.pathname === path;
  };

  return (
    <aside className="review-sidebar" data-testid="review-sidebar">
      <div className="sidebar-brand">
        <Link to="/" className="sidebar-brand-link">
          <span className="logo-badge">OS</span>
          <span className="sidebar-brand-name">OmniSight</span>
        </Link>
        <span className="sidebar-sub">Review Console</span>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-group-title">MAIN WORKFLOW</div>
        <Link
          to="/review"
          className={`sidebar-nav-item ${isLinkActive("/review") ? "active" : ""}`}
          data-testid="nav-proposals"
        >
          <span className="nav-item-icon">📋</span>
          <span>Repair Proposals</span>
        </Link>

        <Link
          to="/review/history"
          className={`sidebar-nav-item ${isLinkActive("/review/history") ? "active" : ""}`}
          data-testid="nav-history"
        >
          <span className="nav-item-icon">📜</span>
          <span>Review History</span>
        </Link>

        <div className="sidebar-group-title">UPSTREAM STAGES</div>
        <div className="sidebar-nav-item placeholder" title="Inspection Jobs (Managed upstream)">
          <span className="nav-item-icon">🔍</span>
          <span>Inspection Jobs</span>
          <span className="tag-placeholder">Step 4.2</span>
        </div>

        <div className="sidebar-nav-item placeholder" title="Defect Registry">
          <span className="nav-item-icon">⚠️</span>
          <span>Defect Registry</span>
          <span className="tag-placeholder">Step 4.1</span>
        </div>

        <div className="sidebar-group-title">DOWNSTREAM STAGES</div>
        <div className="sidebar-nav-item placeholder" title="Patch Sandbox (Planned for Step 4.6)">
          <span className="nav-item-icon">🛠️</span>
          <span>Automated Patching</span>
          <span className="tag-placeholder">Step 4.6</span>
        </div>

        <div className="sidebar-nav-item placeholder" title="Validation History">
          <span className="nav-item-icon">📊</span>
          <span>Validation History</span>
          <span className="tag-placeholder">Future</span>
        </div>
      </nav>

      <div className="sidebar-footer">
        <div className="demo-notice-box">
          <span className="demo-notice-tag">HUMAN-IN-THE-LOOP</span>
          <p className="demo-notice-text">
            Review decisions are strictly non-destructive. Approval accepts proposals for future sandbox application.
          </p>
        </div>
      </div>
    </aside>
  );
};
