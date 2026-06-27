import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { GalleryView as GalleryViewPkg } from '@kanecta/component-gallery-view';
import { useAllItems } from '../../../hooks/useAllItems';
import { useUiStore } from '../../../store/ui';
import { ITEM_TYPES, CONFIDENCE_LEVELS } from '../../../lib/constants';

export const GalleryViewMeta: ViewMeta = {
  uuid: 'f7e6a5b4-c8d9-4e0f-1a2b-3c4d5e6f7a8b',
  name: 'gallery',
  label: 'Gallery',
  icon: 'GridView',
};

interface GalleryViewProps {
  panelId: string;
}

export function GalleryView({ panelId }: GalleryViewProps) {
  useViewLocation(GalleryViewMeta.uuid);
  const { items, isLoading, filter, sort } = useAllItems(panelId);
  const { setPanelFilter, setPanelSort, setFocusedItem, focusedItemId } = useUiStore();

  return (
    <GalleryViewPkg
      items={items}
      isLoading={isLoading}
      filter={filter}
      sort={sort}
      onFilterChange={(f) => setPanelFilter(panelId, f)}
      onSortChange={(s) => setPanelSort(panelId, s)}
      selectedId={focusedItemId}
      onSelect={setFocusedItem}
      itemTypes={ITEM_TYPES}
      confidenceLevels={CONFIDENCE_LEVELS}
      panelId={panelId}
    />
  );
}
