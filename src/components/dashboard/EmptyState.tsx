import React from "react";
import { Link } from "react-router-dom";

export interface EmptyStateActionConfig {
  label: string;
  onClick?: () => void;
  to?: string;
  href?: string;
}

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: EmptyStateActionConfig | React.ReactNode;
  secondaryAction?: EmptyStateActionConfig | React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  secondaryAction,
  className = "",
}: EmptyStateProps) {
  const renderAction = (act: EmptyStateActionConfig | React.ReactNode, isSecondary = false) => {
    if (!act) return null;
    if (React.isValidElement(act)) return act;

    const config = act as EmptyStateActionConfig;
    const btnClass = isSecondary ? "empty-state-btn secondary" : "empty-state-btn primary";

    if (config.to) {
      return (
        <Link to={config.to} className={btnClass} onClick={config.onClick}>
          {config.label}
        </Link>
      );
    }
    if (config.href) {
      return (
        <a href={config.href} className={btnClass} onClick={config.onClick}>
          {config.label}
        </a>
      );
    }
    return (
      <button type="button" className={btnClass} onClick={config.onClick}>
        {config.label}
      </button>
    );
  };

  const defaultIcon = (
    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 7h-7" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </svg>
  );

  return (
    <div className={`empty-state-card ${className}`} role="region" aria-label={title}>
      <div className="empty-state-icon-box" aria-hidden="true">
        {icon || defaultIcon}
      </div>

      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>

      {(action || secondaryAction) && (
        <div className="empty-state-actions">
          {renderAction(action, false)}
          {renderAction(secondaryAction, true)}
        </div>
      )}
    </div>
  );
}
