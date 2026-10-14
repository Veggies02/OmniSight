import React from "react";

export interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  badge,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`dash-page-header ${className}`} role="region" aria-label={title}>
      <div className="dash-page-header-main">
        {badge && <div className="dash-page-header-badge">{badge}</div>}
        <h1 className="dash-page-header-title">{title}</h1>
        {description && (
          <p className="dash-page-header-description">{description}</p>
        )}
      </div>
      {actions && <div className="dash-page-header-actions">{actions}</div>}
    </header>
  );
}
