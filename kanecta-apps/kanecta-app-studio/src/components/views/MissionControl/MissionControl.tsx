import { useState } from 'react';
import { useWorkspaceStore } from '../../../store/workspace';
import { WorkspaceColumn } from './WorkspaceColumn';
import { ActivityFeed } from './ActivityFeed';
import { ReviewConveyor } from './ReviewConveyor';
import './MissionControl.scss';

export function MissionControl() {
  const { workspaces } = useWorkspaceStore();
  const [reviewOpen, setReviewOpen] = useState(false);

  if (reviewOpen) {
    return <ReviewConveyor onClose={() => setReviewOpen(false)} />;
  }

  return (
    <div className="MissionControl">
      <div className="MissionControl-columns">
        {workspaces.map((ws) => (
          <WorkspaceColumn
            key={ws.id}
            workspace={ws}
            onOpenReview={() => setReviewOpen(true)}
          />
        ))}
      </div>
      <aside className="MissionControl-sidebar">
        <div className="MissionControl-sidebar-title">Activity</div>
        <ActivityFeed />
      </aside>
    </div>
  );
}
