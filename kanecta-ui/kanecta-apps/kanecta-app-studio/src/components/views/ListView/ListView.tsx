import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { ListView as ListViewPkg } from '@kanecta/component-list-view';
import { useAllItems } from '../../../hooks/useAllItems';
import { useUiStore } from '../../../store/ui';
import { ITEM_TYPES, CONFIDENCE_LEVELS } from '../../../lib/constants';

export const ListViewMeta: ViewMeta = {
  uuid: 'a8f7b6c5-d9e0-4f1a-2b3c-4d5e6f7a8b9c',
  name: 'list',
  label: 'List',
  icon: 'FormatListBulleted',
};

interface ListViewProps {
  panelId: string;
}

export function ListView({ panelId }: ListViewProps) {
  useViewLocation(ListViewMeta.uuid);
  const { items, isLoading, filter, sort } = useAllItems(panelId);
  const { setPanelFilter, setPanelSort, setFocusedItem, focusedItemId } = useUiStore();

  return (
    <ListViewPkg
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
