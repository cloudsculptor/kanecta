import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { MissionControl as MissionControlPkg } from '@kanecta/component-mission-control';
import { useWorkspaceStore } from '../../../store/workspace';
import { useReviewStore } from '../../../store/review';
import { useUiStore } from '../../../store/ui';

export const MissionControlMeta: ViewMeta = {
  uuid: 'e2d1f0a9-b3c4-4d5e-6f7a-8b9c0d1e2f3a',
  name: 'mission-control',
  label: 'Mission Control',
  icon: 'Speed',
};

export function MissionControl() {
  useViewLocation(MissionControlMeta.uuid);
  const { workspaces, getApi, activeWorkspaceId } = useWorkspaceStore();
  const { activityLog, reviewQueue, conveyorIndex, advanceConveyor, markSeen } = useReviewStore();
  const { setFocusedItem } = useUiStore();
  const api = getApi();

  return (
    <MissionControlPkg
      workspaces={workspaces}
      activityLog={activityLog}
      reviewQueue={reviewQueue}
      conveyorIndex={conveyorIndex}
      onAdvanceConveyor={advanceConveyor}
      onMarkSeen={markSeen}
      onFocusItem={setFocusedItem}
      onFetchWorkspaceItems={(wsId) => getApi(wsId).items.list()}
      onApproveItem={(id) => api.items.update(id, { confidence: 'high' })}
      onDeleteItem={(id) => api.items.delete(id)}
      queryKeyPrefix={activeWorkspaceId ?? ''}
    />
  );
}
