import { FilterBar } from '../../shared/FilterBar';
import { SortBar } from '../../shared/SortBar';
import { GalleryCard } from './GalleryCard';
import { useAllItems } from '../../../hooks/useAllItems';
import { useUiStore } from '../../../store/ui';
import './GalleryView.scss';

interface GalleryViewProps {
  panelId: string;
}

export function GalleryView({ panelId }: GalleryViewProps) {
  const { items, isLoading, filter, sort } = useAllItems(panelId);
  const { setPanelFilter, setPanelSort } = useUiStore();

  if (isLoading) return <div className="GalleryView"><div className="GalleryView-empty">Loading…</div></div>;

  return (
    <div className="GalleryView" data-testid={`gallery-view-${panelId}`}>
      <div className="GalleryView-controls">
        <FilterBar
          filter={filter}
          onChange={(f) => setPanelFilter(panelId, f)}
          totalCount={items.length}
          filteredCount={items.length}
        />
        <SortBar sort={sort} onChange={(s) => setPanelSort(panelId, s)} />
      </div>
      {items.length === 0 ? (
        <div className="GalleryView-empty">No items match the current filter</div>
      ) : (
        <div className="GalleryView-grid">
          {items.map((item) => (
            <GalleryCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
