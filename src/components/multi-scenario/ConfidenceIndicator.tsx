import React from "react";

interface Props {
  confidence: number; // 0.0 to 1.0
}

export const ConfidenceIndicator: React.FC<Props> = ({ confidence }) => {
  const percent = Math.round(confidence * 100);
  const color = percent >= 90 ? "#16a34a" : percent >= 75 ? "#d97706" : "#dc2626";

  return (
    <div
      data-testid="confidence-indicator"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        fontSize: "0.8rem",
        color: "#475569",
      }}
    >
      <span style={{ fontWeight: 600 }}>{percent}%</span>
      <div
        style={{
          width: "50px",
          height: "6px",
          backgroundColor: "#e2e8f0",
          borderRadius: "9999px",
          overflow: "hidden",
        }}
      >
        <div
          data-testid="confidence-progress-bar"
          style={{
            width: `${percent}%`,
            height: "100%",
            backgroundColor: color,
            borderRadius: "9999px",
          }}
        />
      </div>
    </div>
  );
};
