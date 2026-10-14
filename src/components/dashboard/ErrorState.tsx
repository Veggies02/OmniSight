import { useState } from "react";

export interface ErrorStateProps {
  title?: string;
  message: string;
  details?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title = "Failed to load data",
  message,
  details,
  onRetry,
  retryLabel = "Retry",
  className = "",
}: ErrorStateProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      className={`error-state-card ${className}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="error-state-icon-box" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <div className="error-state-content">
        <h3 className="error-state-title">{title}</h3>
        <p className="error-state-message">{message}</p>

        {details && (
          <div className="error-state-details-block">
            <button
              type="button"
              className="error-details-toggle"
              onClick={() => setShowDetails(!showDetails)}
              aria-expanded={showDetails}
            >
              <span>{showDetails ? "Hide technical details" : "Show technical details"}</span>
              <span aria-hidden="true">{showDetails ? "▲" : "▼"}</span>
            </button>
            {showDetails && (
              <pre className="error-details-pre">{details}</pre>
            )}
          </div>
        )}
      </div>

      {onRetry && (
        <div className="error-state-action">
          <button
            type="button"
            className="error-retry-btn"
            onClick={onRetry}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            <span>{retryLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}
