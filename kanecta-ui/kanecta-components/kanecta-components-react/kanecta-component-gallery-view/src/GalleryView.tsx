import type { FilterState, SortState } from '@kanecta/component-core';
import { FilterBar } from '@kanecta/component-filter-bar';
import { SortBar } from '@kanecta/component-sort-bar';
import { ConfidenceBadge } from '@kanecta/component-confidence-badge';
import { TypeBadge } from '@kanecta/component-type-badge';
import { TagChip } from '@kanecta/component-tag-chip';
import type { ConfidenceLevel } from '@kanecta/component-confidence-badge';
import './GalleryView.css';

export interface GalleryItem {
  id: string;
  value: string;
  type: string;
  confidence: string | null;
  tags: string[];
}

interface GalleryCardProps {
  item: GalleryItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

function GalleryCard({ item, isSelected, onSelect }: GalleryCardProps) {
  return (
    <div
      className={`GalleryCard${isSelected ? ' GalleryCard--focused' : ''}`}
      onClick={() => onSelect(item.id)}
      aria-label={item.value}
    >
      <div className="GalleryCard-value">{item.value}</div>
      <div className="GalleryCard-meta">
        <TypeBadge type={item.type} />
        <ConfidenceBadge confidence={item.confidence as ConfidenceLevel | null} />
        {item.tags.slice(0, 2).map((t) => <TagChip key={t} tag={t} />)}
        {item.tags.length > 2 && (
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
            +{item.tags.length - 2}
          </span>
        )}
      </div>
    </div>
  );
}

export interface GalleryViewProps {
  items: GalleryItem[];
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

export function GalleryView({
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
}: GalleryViewProps) {
  if (isLoading) {
    return (
      <div className="GalleryView">
        <div className="GalleryView-empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="GalleryView" data-testid={panelId ? `gallery-view-${panelId}` : undefined}>
      <div className="GalleryView-controls">
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
      {items.length === 0 ? (
        <div className="GalleryView-empty">No items match the current filter</div>
      ) : (
        <div className="GalleryView-grid">
          {items.map((item) => (
            <GalleryCard
              key={item.id}
              item={item}
              isSelected={selectedId === item.id}
              onSelect={(id) => onSelect?.(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
