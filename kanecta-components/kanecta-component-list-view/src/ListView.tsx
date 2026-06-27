import type { FilterState, SortState } from '@kanecta/component-core';
import { FilterBar } from '@kanecta/component-filter-bar';
import { SortBar } from '@kanecta/component-sort-bar';
import { ConfidenceBadge } from '@kanecta/component-confidence-badge';
import { TypeBadge } from '@kanecta/component-type-badge';
import { TagChip } from '@kanecta/component-tag-chip';
import './ListView.css';

export interface ViewItem {
  id: string;
  value: string;
  type: string;
  confidence: string | null;
  tags: string[];
}

export interface ListViewProps {
  items: ViewItem[];
  isLoading?: boolean;
  filter: FilterState;
  sort: SortState;
  onFilterChange: (filter: FilterState) => void;
  onSortChange: (sort: SortState) => void;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  itemTypes?: string[];
  confidenceLevels?: string[];
  panelId?: string;
}

export function ListView({
  items,
  isLoading,
  filter,
  sort,
  onFilterChange,
  onSortChange,
  selectedId,
  onSelect,
  itemTypes = [],
  confidenceLevels = [],
  panelId,
}: ListViewProps) {
  if (isLoading) {
    return (
      <div className="ListView">
        <div className="ListView-empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="ListView" data-testid={panelId ? `list-view-${panelId}` : undefined}>
      <div className="ListView-controls">
        <FilterBar
          filter={filter}
          onChange={onFilterChange}
          totalCount={items.length}
          filteredCount={items.length}
          itemTypes={itemTypes}
          confidenceLevels={confidenceLevels}
        />
        <SortBar sort={sort} onChange={onSortChange} />
      </div>
      <div className="ListView-scroll">
        {items.length === 0 ? (
          <div className="ListView-empty">No items match the current filter</div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={`ListView-item${selectedId === item.id ? ' ListView-item--focused' : ''}`}
              onClick={() => onSelect?.(item.id)}
              aria-selected={selectedId === item.id}
            >
              <span className="ListView-value" title={item.value}>{item.value}</span>
              <div className="ListView-chips">
                <TypeBadge type={item.type} />
                <ConfidenceBadge confidence={item.confidence as import('@kanecta/component-confidence-badge').ConfidenceLevel | null} />
                {item.tags.slice(0, 3).map((t) => <TagChip key={t} tag={t} />)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
