import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { FilterBar } from '../../shared/FilterBar';

export const GalleryViewMeta: ViewMeta = {
  uuid: 'f7e6a5b4-c8d9-4e0f-1a2b-3c4d5e6f7a8b',
  name: 'gallery',
  label: 'Gallery',
  icon: 'GridView',
};
import { SortBar } from '../../shared/SortBar';
import { GalleryCard } from './GalleryCard';
import { useAllItems } from '../../../hooks/useAllItems';
import { useUiStore } from '../../../store/ui';
import './GalleryView.scss';

interface GalleryViewProps {
  panelId: string;
}

export function GalleryView({ panelId }: GalleryViewProps) {
  useViewLocation(GalleryViewMeta.uuid);
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
