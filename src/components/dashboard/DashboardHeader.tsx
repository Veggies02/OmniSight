interface DashboardHeaderProps {
  title: string;
  onOpenMobileMenu: () => void;
}

export function DashboardHeader({ title, onOpenMobileMenu }: DashboardHeaderProps) {
  return (
    <header className="dashboard-header" role="banner">
      <div className="header-left">
        <button
          type="button"
          className="mobile-menu-toggle"
          onClick={onOpenMobileMenu}
          aria-label="Open sidebar menu"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>

        <div className="header-title-group">
          <h1 className="header-title">{title}</h1>
          <span className="header-status-pill" title="Platform service operational">
            <span className="status-dot-pulse" aria-hidden="true" />
            <span>Platform Ready</span>
          </span>
        </div>
      </div>

      <div className="header-right">
        <div className="header-branch-badge" title="Active Git development branch">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span>OmnisSight(sahil)</span>
        </div>

        <div className="header-user-profile" aria-label="User profile">
          <div className="user-avatar" title="Sahil M. (P4 Engineer)" aria-hidden="true">
            SM
          </div>
          <div className="user-meta">
            <span className="user-name">Sahil M.</span>
            <span className="user-role">P4 Engineer</span>
          </div>
        </div>
      </div>
    </header>
  );
}
