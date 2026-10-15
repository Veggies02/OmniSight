import React from "react";
import { type ProposalFilterState } from "../../types/review-types";

interface ProposalFiltersProps {
  filters: ProposalFilterState;
  onFilterChange: (newFilters: ProposalFilterState) => void;
  onReset: () => void;
}

export const ProposalFilters: React.FC<ProposalFiltersProps> = ({
  filters,
  onFilterChange,
  onReset,
}) => {
  return (
    <div className="review-filters-bar" data-testid="proposal-filters">
      <div className="filter-group">
        <label htmlFor="search-input" className="filter-label">Search</label>
        <input
          id="search-input"
          data-testid="search-input"
          type="text"
          className="form-input filter-search"
          placeholder="Search by ID, file, or description..."
          value={filters.searchQuery}
          onChange={(e) => onFilterChange({ ...filters, searchQuery: e.target.value })}
        />
      </div>

      <div className="filter-group">
        <label htmlFor="filter-category" className="filter-label">Defect Category</label>
        <select
          id="filter-category"
          data-testid="filter-category"
          className="form-input filter-select"
          value={filters.category}
          onChange={(e) => onFilterChange({ ...filters, category: e.target.value })}
        >
          <option value="all">All Categories</option>
          <option value="image_distortion">Image Distortion</option>
          <option value="layout_breakage">Layout Breakage</option>
          <option value="low_contrast">Low Contrast</option>
          <option value="responsive_overflow">Responsive Overflow</option>
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="filter-status" className="filter-label">Review Status</label>
        <select
          id="filter-status"
          data-testid="filter-status"
          className="form-input filter-select"
          value={filters.reviewStatus}
          onChange={(e) => onFilterChange({ ...filters, reviewStatus: e.target.value })}
        >
          <option value="all">All Statuses</option>
          <option value="pending_review">Pending Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="filter-freshness" className="filter-label">Source Freshness</label>
        <select
          id="filter-freshness"
          data-testid="filter-freshness"
          className="form-input filter-select"
          value={filters.freshness}
          onChange={(e) => onFilterChange({ ...filters, freshness: e.target.value })}
        >
          <option value="all">All Freshness</option>
          <option value="fresh">Fresh (SHA Matches)</option>
          <option value="stale">Stale (Modified)</option>
          <option value="unverified">Unverified</option>
        </select>
      </div>

      <button
        type="button"
        data-testid="btn-reset-filters"
        className="btn btn-outline btn-sm filter-reset-btn"
        onClick={onReset}
      >
        Reset Filters
      </button>
    </div>
  );
};
