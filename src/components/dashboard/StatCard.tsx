import React from "react";

export interface StatTrend {
  direction: "up" | "down" | "neutral";
  text: string;
}

export interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: React.ReactNode;
  trend?: StatTrend;
  badge?: React.ReactNode;
  variant?: "default" | "accent" | "success" | "warning" | "danger";
  className?: string;
}

export function StatCard({
  label,
  value,
  subtext,
  icon,
  trend,
  badge,
  variant = "default",
  className = "",
}: StatCardProps) {
  return (
    <div
      className={`stat-card stat-card-${variant} ${className}`}
      role="region"
      aria-label={`${label} metric: ${value}`}
    >
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        <div className="stat-card-top-right">
          {badge && <span className="stat-card-badge">{badge}</span>}
          {icon && <span className="stat-card-icon" aria-hidden="true">{icon}</span>}
        </div>
      </div>

      <div className="stat-card-middle">
        <span className="stat-card-value">{value}</span>
      </div>

      {(subtext || trend) && (
        <div className="stat-card-bottom">
          {trend && (
            <span className={`stat-trend stat-trend-${trend.direction}`} aria-label={`Trend: ${trend.text}`}>
              {trend.direction === "up" && "↑"}
              {trend.direction === "down" && "↓"}
              {trend.direction === "neutral" && "→"}{" "}
              {trend.text}
            </span>
          )}
          {subtext && <span className="stat-card-subtext">{subtext}</span>}
        </div>
      )}
    </div>
  );
}
