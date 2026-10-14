import { EmptyState } from "../../components/dashboard/EmptyState";

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
    <div className="dashboard-placeholder-page">
      <div style={{ textAlign: "center", marginBottom: "1rem" }}>
        <span className="placeholder-badge">{badge}</span>
      </div>

      <EmptyState
        title={title}
        description={description}
        action={{
          label: "← Return to Overview",
          to: "/qa",
        }}
      />
    </div>
  );
}
