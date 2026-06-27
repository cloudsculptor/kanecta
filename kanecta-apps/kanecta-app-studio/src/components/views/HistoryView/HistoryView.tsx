import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { HistoryView as HistoryViewPkg, HistoryList } from '@kanecta/component-history-view';
import { useWorkspaceStore } from '../../../store/workspace';
import { useUiStore } from '../../../store/ui';
import { TYPE_ICONS, FallbackIcon } from '../../../lib/typeIcons';
import type { ItemType } from '../../../types/kanecta';

export { HistoryList };

export const HistoryViewMeta: ViewMeta = {
  uuid: 'a4f3b2c1-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
  name: 'history',
  label: 'History',
  icon: 'History',
};

export function HistoryView() {
  useViewLocation(HistoryViewMeta.uuid);
  const { getApi, activeWorkspaceId } = useWorkspaceStore();
  const { layout, updatePanel } = useUiStore();
  const api = getApi(activeWorkspaceId);

  const handleNavigate = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    window.location.hash = `/tree/${id}`;
    const panelId = layout.panels[0]?.id;
    if (panelId) updatePanel(panelId, { viewType: 'tree' });
  };

  const getTypeIcon = (type: string) =>
    (TYPE_ICONS[type as ItemType] ?? FallbackIcon) as React.ElementType<{ className?: string }>;

  return (
    <HistoryViewPkg
      onFetchClipboard={() => api.breadcrumb.getClipboard()}
      onFetchViewed={() => api.breadcrumb.getViewed()}
      onNavigate={handleNavigate}
      getTypeIcon={getTypeIcon}
    />
  );
}
