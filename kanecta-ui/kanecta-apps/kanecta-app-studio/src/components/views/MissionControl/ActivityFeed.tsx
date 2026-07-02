import { useReviewStore } from '../../../store/review';
import { useWorkingSetStore } from '../../../store/workingSet';
import { WorkspaceIndicator } from '@kanecta/component-workspace-indicator';
import { useUiStore } from '../../../store/ui';
import './ActivityFeed.scss';

function formatRelative(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function ActivityFeed() {
  const { activityLog } = useReviewStore();
  const { workingSets } = useWorkingSetStore();
  const { setFocusedItem } = useUiStore();

  const wsMap = new Map(workingSets.map((w) => [w.id, w]));

  if (activityLog.length === 0) {
    return <div className="ActivityFeed-empty">No activity yet</div>;
  }

  return (
    <div className="ActivityFeed" role="feed" aria-label="Activity feed">
      {activityLog.map((event) => {
        const ws = wsMap.get(event.workingSetId);
        return (
          <button
            key={event.id}
            className="ActivityFeed-event"
            onClick={() => setFocusedItem(event.item.id)}
          >
            {ws && (
              <WorkspaceIndicator colour={ws.colour} name={ws.name} />
            )}
            <span className={`ActivityFeed-event-op ActivityFeed-event-op--${event.operation}`}>
              {event.operation === 'created' ? '+' : '~'}
            </span>
            <span className="ActivityFeed-event-value">{event.item.value}</span>
            <span className="ActivityFeed-event-time">{formatRelative(event.seenAt)}</span>
          </button>
        );
      })}
    </div>
  );
}
