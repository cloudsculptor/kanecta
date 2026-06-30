import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';
import { MissionControl as MissionControlPkg } from '@kanecta/component-mission-control';
import { useWorkingSetStore } from '../../../store/workingSet';
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
  const { workingSets, getApi, activeWorkingSetId } = useWorkingSetStore();
  const { activityLog, reviewQueue, conveyorIndex, advanceConveyor, markSeen } = useReviewStore();
  const { setFocusedItem } = useUiStore();
  const api = getApi();

  // The mission-control component contract uses `workspaceId`; map from our
  // domain field `workingSetId` at the boundary.
  const activityLogForPkg = activityLog.map(({ workingSetId, ...rest }) => ({
    ...rest,
    workspaceId: workingSetId,
  }));

  return (
    <MissionControlPkg
      workspaces={workingSets}
      activityLog={activityLogForPkg}
      reviewQueue={reviewQueue}
      conveyorIndex={conveyorIndex}
      onAdvanceConveyor={advanceConveyor}
      onMarkSeen={markSeen}
      onFocusItem={setFocusedItem}
      onFetchWorkspaceItems={(wsId) => getApi(wsId).items.list()}
      onApproveItem={(id) => api.items.update(id, { confidence: 'high' })}
      onDeleteItem={(id) => api.items.delete(id)}
      queryKeyPrefix={activeWorkingSetId ?? ''}
    />
  );
}
