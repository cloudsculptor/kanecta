import { useQuery } from '@tanstack/react-query';
import { useWorkingSetStore } from '../../../store/workingSet';
import { useReviewStore } from '../../../store/review';
import type { WorkingSetConfig, WorkingSetStatus } from '../../../types/workingSet';
import type { KanectaItem } from '../../../types/kanecta';
import { WorkspaceIndicator } from '@kanecta/component-workspace-indicator';
import './WorkingSetColumn.scss';

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

interface WorkingSetColumnProps {
  workingSet: WorkingSetConfig;
  onOpenReview: () => void;
}

export function WorkingSetColumn({ workingSet, onOpenReview }: WorkingSetColumnProps) {
  const { getApi } = useWorkingSetStore();
  const { activityLog } = useReviewStore();

  const { data: items = [], isError } = useQuery<KanectaItem[]>({
    queryKey: ['items-list', workingSet.id],
    queryFn: () => getApi(workingSet.id).items.list(),
    refetchInterval: workingSet.pollIntervalMs,
    retry: 1,
  });

  const status = deriveStatus(items, isError);
  const recentActivity = activityLog.filter((e) => e.workingSetId === workingSet.id).slice(0, 5);
  const lowConfidenceCount = items.filter((i) => i.confidence === 'low').length;

  return (
    <div className={`WorkingSetColumn WorkingSetColumn--${status}`}>
      <div className="WorkingSetColumn__header">
        <WorkspaceIndicator colour={workingSet.colour} name={workingSet.name} size="md" />
        <span className="WorkingSetColumn__name">{workingSet.name}</span>
        <span className={`WorkingSetColumn__status WorkingSetColumn__status--${status}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="WorkingSetColumn__stats">
        <div className="WorkingSetColumn__stat">
          <span className="WorkingSetColumn__stat-value">{items.length}</span>
          <span className="WorkingSetColumn__stat-label">items</span>
        </div>
        <div className="WorkingSetColumn__stat">
          <span className="WorkingSetColumn__stat-value WorkingSetColumn__stat-value--warn">
            {lowConfidenceCount}
          </span>
          <span className="WorkingSetColumn__stat-label">low conf.</span>
        </div>
        <div className="WorkingSetColumn__stat">
          <span className="WorkingSetColumn__stat-value">{recentActivity.length}</span>
          <span className="WorkingSetColumn__stat-label">recent</span>
        </div>
      </div>

      <div className="WorkingSetColumn__recent">
        {recentActivity.length === 0 ? (
          <p className="WorkingSetColumn__recent-empty">No recent activity</p>
        ) : (
          recentActivity.map((event) => (
            <div key={event.id} className="WorkingSetColumn__recent-item">
              <span className="WorkingSetColumn__recent-op">
                {event.operation === 'created' ? '+' : '~'}
              </span>
              <span className="WorkingSetColumn__recent-value">{event.item.value}</span>
            </div>
          ))
        )}
      </div>

      <button className="WorkingSetColumn__review-btn" onClick={onOpenReview}>
        Review ({lowConfidenceCount})
      </button>
    </div>
  );
}
