import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { DashboardSidebar } from "./DashboardSidebar";
import { DashboardHeader } from "./DashboardHeader";
import "../../styles/dashboard.css";

export function DashboardLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  const getPageTitle = (pathname: string): string => {
    if (pathname.includes("/jobs")) return "Inspection Jobs";
    if (pathname.includes("/defects")) return "Defect Findings";
    if (pathname.includes("/pull-requests")) return "GitHub Pull Requests";
    return "Dashboard Overview";
  };

  const currentTitle = getPageTitle(location.pathname);

  return (
    <div className="dashboard-root">
      {/* Mobile Backdrop */}
      <div
        className={`dashboard-backdrop ${mobileMenuOpen ? "open" : ""}`}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar Navigation */}
      <DashboardSidebar
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main Shell */}
      <div className="dashboard-main-shell">
        <DashboardHeader
          title={currentTitle}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="dashboard-content-area" id="main-dashboard-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
