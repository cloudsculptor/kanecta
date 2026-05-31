import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { FilterBar } from '../../shared/FilterBar';

export const ListViewMeta: ViewMeta = {
  uuid: 'a8f7b6c5-d9e0-4f1a-2b3c-4d5e6f7a8b9c',
  name: 'list',
  label: 'List',
  icon: 'FormatListBulleted',
};
import { SortBar } from '../../shared/SortBar';
import { ConfidenceBadge } from '../../shared/ConfidenceBadge';
import { TypeBadge } from '../../shared/TypeBadge';
import { TagChip } from '../../shared/TagChip';
import { useAllItems } from '../../../hooks/useAllItems';
import { useUiStore } from '../../../store/ui';
import './ListView.scss';

interface ListViewProps {
  panelId: string;
}

export function ListView({ panelId }: ListViewProps) {
  useViewLocation(ListViewMeta.uuid);
  const { items, isLoading, filter, sort } = useAllItems(panelId);
  const { setPanelFilter, setPanelSort, setFocusedItem, focusedItemId } = useUiStore();

  if (isLoading) return <div className="ListView"><div className="ListView-empty">Loading…</div></div>;

  return (
    <div className="ListView" data-testid={`list-view-${panelId}`}>
      <div className="ListView-controls">
        <FilterBar
          filter={filter}
          onChange={(f) => setPanelFilter(panelId, f)}
          totalCount={items.length}
          filteredCount={items.length}
        />
        <SortBar sort={sort} onChange={(s) => setPanelSort(panelId, s)} />
      </div>
      <div className="ListView-scroll">
        {items.length === 0 ? (
          <div className="ListView-empty">No items match the current filter</div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={`ListView-item${focusedItemId === item.id ? ' ListView-item--focused' : ''}`}
              onClick={() => setFocusedItem(item.id)}
              aria-selected={focusedItemId === item.id}
            >
              <span className="ListView-value" title={item.value}>{item.value}</span>
              <div className="ListView-chips">
                <TypeBadge type={item.type} />
                <ConfidenceBadge confidence={item.confidence} />
                {item.tags.slice(0, 3).map((t) => <TagChip key={t} tag={t} />)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
