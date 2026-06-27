import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { CalendarView as CalendarViewPkg } from '@kanecta/component-calendar-view';
import { useAllItems } from '../../../hooks/useAllItems';
import { useUiStore } from '../../../store/ui';
import { ITEM_TYPES, CONFIDENCE_LEVELS } from '../../../lib/constants';

export const CalendarViewMeta: ViewMeta = {
  uuid: 'b9a8c7d6-e0f1-4a2b-3c4d-5e6f7a8b9c0d',
  name: 'calendar',
  label: 'Calendar',
  icon: 'CalendarMonth',
};

interface CalendarViewProps {
  panelId: string;
}

export function CalendarView({ panelId }: CalendarViewProps) {
  useViewLocation(CalendarViewMeta.uuid);
  const { items, isLoading, filter } = useAllItems(panelId);
  const { setPanelFilter, setFocusedItem } = useUiStore();

  return (
    <CalendarViewPkg
      items={items}
      isLoading={isLoading}
      filter={filter}
      onFilterChange={(f) => setPanelFilter(panelId, f)}
      onSelectItem={setFocusedItem}
      itemTypes={ITEM_TYPES}
      confidenceLevels={CONFIDENCE_LEVELS}
      panelId={panelId}
    />
  );
}
