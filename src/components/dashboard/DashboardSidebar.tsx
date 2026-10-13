import { NavLink, Link } from "react-router-dom";

interface DashboardSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DashboardSidebar({ isOpen, onClose }: DashboardSidebarProps) {
  const navItems = [
    {
      to: "/qa",
      end: true,
      label: "Overview",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sidebar-link-icon" aria-hidden="true">
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" />
        </svg>
      ),
    },
    {
      to: "/qa/jobs",
      end: false,
      label: "Inspection Jobs",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sidebar-link-icon" aria-hidden="true">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z" />
          <path d="M12 11h4" />
          <path d="M12 16h4" />
          <path d="M8 11h.01" />
          <path d="M8 16h.01" />
        </svg>
      ),
    },
    {
      to: "/qa/defects",
      end: false,
      label: "Defects",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sidebar-link-icon" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </svg>
      ),
    },
    {
      to: "/qa/pull-requests",
      end: false,
      label: "GitHub Pull Requests",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sidebar-link-icon" aria-hidden="true">
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M13 6h3a2 2 0 0 1 2 2v7" />
          <line x1="6" x2="6" y1="9" y2="21" />
        </svg>
      ),
    },
  ];

  return (
    <aside
      className={`dashboard-sidebar ${isOpen ? "open" : ""}`}
      aria-label="OmniSight Dashboard Sidebar"
    >
      {/* Branding Header */}
      <div className="sidebar-brand-wrapper">
        <Link to="/qa" className="sidebar-brand" onClick={onClose} aria-label="OmniSight QA Platform Home">
          <div className="brand-icon-box" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div className="brand-text-group">
            <span className="brand-title">OmniSight</span>
            <span className="brand-subtitle">QA Platform</span>
          </div>
        </Link>
        <button
          type="button"
          className="sidebar-close-btn"
          onClick={onClose}
          aria-label="Close navigation sidebar"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Nav items */}
      <nav className="sidebar-nav" aria-label="Dashboard Primary Navigation">
        <span className="sidebar-section-label">Inspection & QA</span>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onClose}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? "active" : ""}`
            }
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer Link to Target Storefront */}
      <div className="sidebar-footer">
        <Link
          to="/"
          className="target-app-link"
          title="Open mock storefront application"
          onClick={onClose}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span aria-hidden="true">🛍️</span>
            <span>Target: OmniShop</span>
          </span>
          <span className="target-badge">Storefront</span>
        </Link>
        <div className="sidebar-version-tag">
          OmniSight Core • P4 Baseline
        </div>
      </div>
    </aside>
  );
}
