import SearchIcon from '@mui/icons-material/Search';
import type { FilterState } from '@kanecta/component-core';
import './FilterBar.scss';

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
      <div className="FilterBar__search">
        <SearchIcon sx={{ fontSize: 14, color: 'var(--color-text-muted)' }} />
        <input
          className="FilterBar__search-input"
          placeholder="Search…"
          value={filter.search ?? ''}
          onChange={(e) => onChange({ ...filter, search: e.target.value || undefined })}
          aria-label="Search items"
        />
      </div>

      <select
        className="FilterBar__select"
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
        className="FilterBar__select"
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
          className="FilterBar__clear"
          onClick={() => onChange({})}
          aria-label="Clear filters"
        >
          Clear
        </button>
      )}

      <div className="FilterBar__spacer" />
      <span className="FilterBar__count">
        {filteredCount === totalCount
          ? `${totalCount} items`
          : `${filteredCount} of ${totalCount}`}
      </span>
    </div>
  );
}
