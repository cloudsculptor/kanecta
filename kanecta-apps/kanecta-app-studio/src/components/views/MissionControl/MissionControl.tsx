import { useState } from 'react';
import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';

export const MissionControlMeta: ViewMeta = {
  uuid: 'e2d1f0a9-b3c4-4d5e-6f7a-8b9c0d1e2f3a',
  name: 'mission-control',
  label: 'Mission Control',
  icon: 'Speed',
};
import { useWorkspaceStore } from '../../../store/workspace';
import { WorkspaceColumn } from './WorkspaceColumn';
import { ActivityFeed } from './ActivityFeed';
import { ReviewConveyor } from './ReviewConveyor';
import './MissionControl.scss';

export function MissionControl() {
  useViewLocation(MissionControlMeta.uuid);
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
