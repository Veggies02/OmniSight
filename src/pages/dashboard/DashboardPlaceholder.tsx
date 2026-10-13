import { Link } from "react-router-dom";

interface DashboardPlaceholderProps {
  title: string;
  description: string;
  badge: string;
}

export function DashboardPlaceholder({
  title,
  description,
  badge,
}: DashboardPlaceholderProps) {
  return (
    <div className="placeholder-view-card">
      <div className="placeholder-icon-wrapper" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </svg>
      </div>

      <span className="placeholder-badge">{badge}</span>
      <h2 className="placeholder-title">{title}</h2>
      <p className="placeholder-desc">{description}</p>

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
        <Link
          to="/qa"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            fontSize: "0.85rem",
            fontWeight: 600,
            padding: "0.5rem 1rem",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--color-surface-subtle)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          ← Return to Overview
        </Link>
      </div>
    </div>
  );
}
