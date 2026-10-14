export type BadgeStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "needs-review"
  | "Pending"
  | "Running"
  | "Passed"
  | "Failed"
  | "Needs Review";

export interface StatusBadgeProps {
  status: BadgeStatus;
  label?: string;
  size?: "sm" | "md" | "lg";
  showDot?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  label,
  size = "md",
  showDot = true,
  className = "",
}: StatusBadgeProps) {
  const normalized = status.toLowerCase().replace(/[\s_]+/g, "-");

  const getStatusConfig = (val: string) => {
    switch (val) {
      case "running":
        return {
          defaultLabel: "Running",
          classNameModifier: "status-running",
          dotClass: "status-dot-running",
          icon: (
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2v4" />
              <path d="m16.2 7.8 2.9-2.9" />
              <path d="M18 12h4" />
              <path d="m16.2 16.2 2.9 2.9" />
              <path d="M12 18v4" />
              <path d="m4.9 19.1 2.9-2.9" />
              <path d="M2 12h4" />
              <path d="m4.9 4.9 2.9 2.9" />
            </svg>
          ),
        };
      case "passed":
        return {
          defaultLabel: "Passed",
          classNameModifier: "status-passed",
          dotClass: "status-dot-passed",
          icon: (
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ),
        };
      case "failed":
        return {
          defaultLabel: "Failed",
          classNameModifier: "status-failed",
          dotClass: "status-dot-failed",
          icon: (
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ),
        };
      case "needs-review":
        return {
          defaultLabel: "Needs Review",
          classNameModifier: "status-needs-review",
          dotClass: "status-dot-needs-review",
          icon: (
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ),
        };
      case "pending":
      default:
        return {
          defaultLabel: "Pending",
          classNameModifier: "status-pending",
          dotClass: "status-dot-pending",
          icon: (
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          ),
        };
    }
  };

  const config = getStatusConfig(normalized);
  const displayLabel = label || config.defaultLabel;

  return (
    <span
      className={`status-badge status-badge-${size} ${config.classNameModifier} ${className}`}
      role="status"
      aria-label={`Status: ${displayLabel}`}
    >
      {showDot && (
        <span className={`status-badge-dot ${config.dotClass}`} aria-hidden="true" />
      )}
      <span className="status-badge-label">{displayLabel}</span>
    </span>
  );
}
