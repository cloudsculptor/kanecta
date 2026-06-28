import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { DigestView as DigestViewPkg } from '@kanecta/component-mission-control';
import { useWorkspaceStore } from '../../../store/workspace';
import { useReviewStore } from '../../../store/review';
import { flattenTree } from '../../../lib/items';

export const DigestViewMeta: ViewMeta = {
  uuid: 'b1a0c9d8-e2f3-4a4b-5c6d-7e8f9a0b1c2d',
  name: 'digest',
  label: 'Digest',
  icon: 'Summarize',
};

export function DigestView() {
  useViewLocation(DigestViewMeta.uuid);
  const { workspaces, getApi } = useWorkspaceStore();
  const { activityLog, reviewQueue } = useReviewStore();

  return (
    <DigestViewPkg
      workspaces={workspaces}
      activityLog={activityLog}
      reviewQueueLength={reviewQueue.length}
      onFetchWorkspaceItems={async (wsId) => {
        const tree = await getApi(wsId).tree.full();
        return flattenTree(tree).map((i) => ({
          id: i.id,
          value: i.value,
          type: i.type,
          confidence: i.confidence ?? undefined,
          tags: i.tags ?? [],
          parentId: i.parentId ?? null,
          modifiedAt: i.modifiedAt ?? undefined,
        }));
      }}
      onDeleteItem={(wsId, itemId) => getApi(wsId).items.delete(itemId)}
      queryKeyPrefix={workspaces.map((w) => w.id).join(',')}
    />
  );
}
