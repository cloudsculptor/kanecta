import { useQuery } from '@tanstack/react-query';
import { useWorkingSetStore } from '../../../store/workingSet';
import { useReviewStore } from '../../../store/review';
import type { WorkingSetConfig, WorkingSetStatus } from '../../../types/workingSet';
import type { KanectaItem } from '../../../types/kanecta';
import { WorkspaceIndicator } from '@kanecta/component-workspace-indicator';
import './WorkspaceColumn.scss';

function deriveStatus(items: KanectaItem[], errorFlag: boolean): WorkingSetStatus {
  if (errorFlag) return 'red';
  const unreviewed = items.filter((i) => i.confidence === 'low').length;
  if (unreviewed > 10) return 'yellow';
  return 'green';
}

const STATUS_LABEL: Record<WorkingSetStatus, string> = {
  green: 'Active',
  yellow: 'Needs review',
  red: 'Unreachable',
  unknown: 'Unknown',
};

interface WorkspaceColumnProps {
  workspace: WorkingSetConfig;
  onOpenReview: () => void;
}

export function WorkspaceColumn({ workspace, onOpenReview }: WorkspaceColumnProps) {
  const { getApi } = useWorkingSetStore();
  const { activityLog } = useReviewStore();

  const { data: items = [], isError } = useQuery<KanectaItem[]>({
    queryKey: ['items-list', workspace.id],
    queryFn: () => getApi(workspace.id).items.list(),
    refetchInterval: workspace.pollIntervalMs,
    retry: 1,
  });

  const status = deriveStatus(items, isError);
  const recentActivity = activityLog.filter((e) => e.workingSetId === workspace.id).slice(0, 5);
  const lowConfidenceCount = items.filter((i) => i.confidence === 'low').length;

  return (
    <div className={`WorkspaceColumn WorkspaceColumn--${status}`}>
      <div className="WorkspaceColumn-header">
        <WorkspaceIndicator colour={workspace.colour} name={workspace.name} size="md" />
        <span className="WorkspaceColumn-name">{workspace.name}</span>
        <span className={`WorkspaceColumn-status WorkspaceColumn-status--${status}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="WorkspaceColumn-stats">
        <div className="WorkspaceColumn-stat">
          <span className="WorkspaceColumn-stat-value">{items.length}</span>
          <span className="WorkspaceColumn-stat-label">items</span>
        </div>
        <div className="WorkspaceColumn-stat">
          <span className="WorkspaceColumn-stat-value WorkspaceColumn-stat-value--warn">
            {lowConfidenceCount}
          </span>
          <span className="WorkspaceColumn-stat-label">low conf.</span>
        </div>
        <div className="WorkspaceColumn-stat">
          <span className="WorkspaceColumn-stat-value">{recentActivity.length}</span>
          <span className="WorkspaceColumn-stat-label">recent</span>
        </div>
      </div>

      <div className="WorkspaceColumn-recent">
        {recentActivity.length === 0 ? (
          <p className="WorkspaceColumn-recent-empty">No recent activity</p>
        ) : (
          recentActivity.map((event) => (
            <div key={event.id} className="WorkspaceColumn-recent-item">
              <span className="WorkspaceColumn-recent-op">
                {event.operation === 'created' ? '+' : '~'}
              </span>
              <span className="WorkspaceColumn-recent-value">{event.item.value}</span>
            </div>
          ))
        )}
      </div>

      <button className="WorkspaceColumn-review-btn" onClick={onOpenReview}>
        Review ({lowConfidenceCount})
      </button>
    </div>
  );
}
