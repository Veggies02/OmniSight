export interface LoadingStateProps {
  message?: string;
  description?: string;
  size?: "sm" | "md" | "lg";
  inline?: boolean;
  className?: string;
}

export function LoadingState({
  message = "Loading data...",
  description,
  size = "md",
  inline = false,
  className = "",
}: LoadingStateProps) {
  if (inline) {
    return (
      <div
        className={`loading-state-inline loading-size-${size} ${className}`}
        role="status"
        aria-live="polite"
      >
        <svg className="loading-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
        <span className="loading-message-inline">{message}</span>
      </div>
    );
  }

  return (
    <div
      className={`loading-state-card loading-size-${size} ${className}`}
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <div className="loading-spinner-wrapper" aria-hidden="true">
        <svg className="loading-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
      </div>

      <div className="loading-text-group">
        <span className="loading-title">{message}</span>
        {description && <p className="loading-subtext">{description}</p>}
      </div>
    </div>
  );
}
