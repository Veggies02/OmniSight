import React from "react";
import type { ScenarioDefectSeverity } from "../../types/multi-scenario-types";

interface Props {
  severity: ScenarioDefectSeverity;
}

export const DefectSeverityBadge: React.FC<Props> = ({ severity }) => {
  const getStyle = (): { bg: string; text: string; border: string } => {
    switch (severity) {
      case "critical":
        return { bg: "#fef2f2", text: "#991b1b", border: "#fecaca" };
      case "high":
        return { bg: "#fff7ed", text: "#c2410c", border: "#fed7aa" };
      case "medium":
        return { bg: "#fefce8", text: "#854d0e", border: "#fef08a" };
      case "low":
      default:
        return { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1" };
    }
  };

  const style = getStyle();

  return (
    <span
      data-testid="defect-severity-badge"
      data-severity={severity}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0.15rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        backgroundColor: style.bg,
        color: style.text,
        border: `1px solid ${style.border}`,
      }}
    >
      {severity.toUpperCase()}
    </span>
  );
};
