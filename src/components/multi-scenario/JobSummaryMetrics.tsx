import React from "react";
import type { CaptureJobSummary } from "../../types/multi-scenario-types";

interface Props {
  summary: CaptureJobSummary;
  selectedFilter: string;
  onFilterChange: (filter: string) => void;
}

export const JobSummaryMetrics: React.FC<Props> = ({
  summary,
  selectedFilter,
  onFilterChange,
}) => {
  const cards = [
    {
      id: "all",
      label: "Total Scenarios",
      value: summary.totalScenarios,
      icon: "🗂️",
      accent: "#3b82f6",
      bg: "#eff6ff",
    },
    {
      id: "pending",
      label: "Awaiting Decision",
      value: summary.pendingCount,
      icon: "⏳",
      accent: "#d97706",
      bg: "#fffbeb",
    },
    {
      id: "approved",
      label: "Approved",
      value: summary.approvedCount,
      icon: "✓",
      accent: "#2563eb",
      bg: "#eff6ff",
    },
    {
      id: "repaired",
      label: "Repaired",
      value: summary.repairedCount,
      icon: "🛠️",
      accent: "#16a34a",
      bg: "#f0fdf4",
    },
    {
      id: "rejected",
      label: "Rejected",
      value: summary.rejectedCount,
      icon: "✕",
      accent: "#64748b",
      bg: "#f8fafc",
    },
    {
      id: "failed",
      label: "Repair Failed",
      value: summary.failedCount,
      icon: "⚠️",
      accent: "#dc2626",
      bg: "#fef2f2",
    },
  ];

  return (
    <div
      data-testid="job-summary-metrics"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "0.75rem",
        marginBottom: "1.5rem",
      }}
    >
      {cards.map((c) => {
        const isSelected = selectedFilter === c.id;
        return (
          <button
            key={c.id}
            type="button"
            data-testid={`metric-card-${c.id}`}
            onClick={() => onFilterChange(c.id)}
            style={{
              padding: "0.85rem",
              borderRadius: "10px",
              backgroundColor: isSelected ? c.bg : "#ffffff",
              border: `1.5px solid ${isSelected ? c.accent : "#e2e8f0"}`,
              textAlign: "left",
              cursor: "pointer",
              transition: "all 0.15s ease",
              boxShadow: isSelected
                ? "0 4px 12px rgba(0, 0, 0, 0.05)"
                : "0 1px 3px rgba(0, 0, 0, 0.02)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.4rem",
              }}
            >
              <span
                style={{
                  fontSize: "0.72rem",
                  color: "#64748b",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                }}
              >
                {c.label}
              </span>
              <span style={{ fontSize: "1rem" }}>{c.icon}</span>
            </div>
            <div
              data-testid={`metric-count-${c.id}`}
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: isSelected ? c.accent : "#1e293b",
                lineHeight: 1,
              }}
            >
              {c.value}
            </div>
          </button>
        );
      })}
    </div>
  );
};
