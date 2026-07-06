import { useState } from 'react';
import { WorkspaceColumn } from './WorkspaceColumn';
import { ActivityFeed } from './ActivityFeed';
import { ReviewConveyor } from './ReviewConveyor';
import type { MissionControlProps } from './types';
import './MissionControl.scss';

export function MissionControl({
  workspaces,
  activityLog,
  reviewQueue,
  conveyorIndex,
  onAdvanceConveyor,
  onMarkSeen,
  onFocusItem,
  onFetchWorkspaceItems,
  onApproveItem,
  onDeleteItem,
  queryKeyPrefix = '',
}: MissionControlProps) {
  const [reviewOpen, setReviewOpen] = useState(false);

  if (reviewOpen) {
    return (
      <ReviewConveyor
        reviewQueue={reviewQueue}
        conveyorIndex={conveyorIndex}
        onAdvanceConveyor={onAdvanceConveyor}
        onMarkSeen={onMarkSeen}
        onApproveItem={onApproveItem}
        onDeleteItem={onDeleteItem}
        onClose={() => setReviewOpen(false)}
        queryKeyPrefix={queryKeyPrefix}
      />
    );
  }

  return (
    <div className="MissionControl">
      <div className="MissionControl-columns">
        {workspaces.map((ws) => (
          <WorkspaceColumn
            key={ws.id}
            workspace={ws}
            activityLog={activityLog}
            onFetchWorkspaceItems={onFetchWorkspaceItems}
            onOpenReview={() => setReviewOpen(true)}
            queryKeyPrefix={queryKeyPrefix}
          />
        ))}
      </div>
      <aside className="MissionControl-sidebar">
        <div className="MissionControl-sidebar-title">Activity</div>
        <ActivityFeed
          activityLog={activityLog}
          workspaces={workspaces}
          onFocusItem={onFocusItem}
        />
      </aside>
    </div>
  );
}
