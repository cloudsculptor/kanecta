import SearchIcon from '@mui/icons-material/Search';
import type { FilterState } from '@kanecta/component-core';
import './FilterBar.css';

export type { FilterState };

export interface FilterBarProps {
  filter: FilterState;
  onChange: (filter: FilterState) => void;
  totalCount: number;
  filteredCount: number;
  itemTypes?: string[];
  confidenceLevels?: string[];
}

export function FilterBar({
  filter,
  onChange,
  totalCount,
  filteredCount,
  itemTypes = [],
  confidenceLevels = [],
}: FilterBarProps) {
  const hasFilter = filter.search || filter.type || filter.confidence;

  return (
    <div className="FilterBar">
      <div className="FilterBar-search">
        <SearchIcon sx={{ fontSize: 14, color: 'var(--color-text-muted)' }} />
        <input
          className="FilterBar-search-input"
          placeholder="Search…"
          value={filter.search ?? ''}
          onChange={(e) => onChange({ ...filter, search: e.target.value || undefined })}
          aria-label="Search items"
        />
      </div>

      <select
        className="FilterBar-select"
        value={filter.type ?? ''}
        onChange={(e) => onChange({ ...filter, type: e.target.value || undefined })}
        aria-label="Filter by type"
      >
        <option value="">All types</option>
        {itemTypes.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <select
        className="FilterBar-select"
        value={filter.confidence ?? ''}
        onChange={(e) => onChange({ ...filter, confidence: e.target.value || undefined })}
        aria-label="Filter by confidence"
      >
        <option value="">All confidence</option>
        {confidenceLevels.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      {hasFilter && (
        <button
          className="FilterBar-clear"
          onClick={() => onChange({})}
          aria-label="Clear filters"
        >
          Clear
        </button>
      )}

      <div className="FilterBar-spacer" />
      <span className="FilterBar-count">
        {filteredCount === totalCount
          ? `${totalCount} items`
          : `${filteredCount} of ${totalCount}`}
      </span>
    </div>
  );
}
