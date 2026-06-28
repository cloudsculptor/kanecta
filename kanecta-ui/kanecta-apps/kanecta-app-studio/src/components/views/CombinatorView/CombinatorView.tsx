import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { CombinatorView as CombinatorViewPkg } from '@kanecta/component-combinator-view';
import { HistoryList } from '@kanecta/component-history-view';
import { StarredView } from '../StarredView/StarredView';
import { useWorkspaceStore } from '../../../store/workspace';
import { useUiStore } from '../../../store/ui';
import { TYPE_ICONS, FallbackIcon } from '../../../lib/typeIcons';
import type { ItemType } from '../../../types/kanecta';

export const CombinatorViewMeta: ViewMeta = {
  uuid: 'd1c0e9f8-a2b3-4c4d-5e6f-7a8b9c0d1e2f',
  name: 'combinator',
  label: 'Combinator',
  icon: 'MergeType',
};

export function CombinatorView() {
  useViewLocation(CombinatorViewMeta.uuid);
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
    <CombinatorViewPkg
      onGetItem={(id) => api.items.get(id).then((item) => ({ id: item.id, value: item.value ?? '', type: item.type }))}
      onGetTree={(id) => api.items.tree(id)}
      getTypeIcon={getTypeIcon}
      starredPanel={<StarredView />}
      clipboardHistoryPanel={
        <HistoryList
          queryKey="breadcrumb-clipboard"
          fetcher={() => api.breadcrumb.getClipboard()}
          emptyMessage="No clipboard history yet."
          onNavigate={handleNavigate}
          getTypeIcon={getTypeIcon}
        />
      }
      navigationHistoryPanel={
        <HistoryList
          queryKey="breadcrumb-viewed"
          fetcher={() => api.breadcrumb.getViewed()}
          emptyMessage="No navigation history yet."
          onNavigate={handleNavigate}
          getTypeIcon={getTypeIcon}
        />
      }
    />
  );
}
