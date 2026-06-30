import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { StarredView as StarredViewPkg } from '@kanecta/component-starred-view';
import { useWorkingSetStore } from '../../../store/workingSet';
import { useUiStore } from '../../../store/ui';
import { TYPE_ICONS, FallbackIcon } from '../../../lib/typeIcons';
import type { ItemType } from '../../../types/kanecta';

export const StarredViewMeta: ViewMeta = {
  uuid: 'b5a4c3d2-e6f7-4a8b-9c0d-1e2f3a4b5c6d',
  name: 'starred',
  label: 'Starred',
  icon: 'Star',
};

export function StarredView() {
  useViewLocation(StarredViewMeta.uuid);
  const { getApi } = useWorkingSetStore();
  const { layout, updatePanel } = useUiStore();
  const api = getApi();

  const handleNavigate = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    window.location.hash = `/tree/${id}`;
    const panelId = layout.panels[0]?.id;
    if (panelId) updatePanel(panelId, { viewType: 'tree' });
  };

  const getTypeIcon = (type: string) =>
    (TYPE_ICONS[type as ItemType] ?? FallbackIcon) as React.ElementType<{ className?: string }>;

  return (
    <StarredViewPkg
      onFetch={() => api.starred.list()}
      onUnstar={(id) => api.starred.remove(id)}
      onNavigate={handleNavigate}
      getTypeIcon={getTypeIcon}
    />
  );
}
