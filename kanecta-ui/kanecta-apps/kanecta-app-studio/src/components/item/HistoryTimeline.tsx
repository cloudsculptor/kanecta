import { useQuery } from '@tanstack/react-query';
import { useWorkingSetStore } from '../../store/workingSet';
import type { HistoryEntry } from '../../types/kanecta';
import './HistoryTimeline.scss';

interface HistoryTimelineProps {
  itemId: string;
}

const OP_LABELS: Record<HistoryEntry['operation'], string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
};

export function HistoryTimeline({ itemId }: HistoryTimelineProps) {
  const { getApi } = useWorkingSetStore();
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['history', itemId],
    queryFn: () => getApi().items.history(itemId),
    enabled: !!itemId,
  });

  if (isLoading) return <div className="HistoryTimeline-empty">Loading…</div>;
  if (history.length === 0) return <div className="HistoryTimeline-empty">No history</div>;

  const sorted = [...history].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <div className="HistoryTimeline">
      {sorted.map((entry) => (
        <div key={entry.id} className="HistoryTimeline-entry">
          <div className={`HistoryTimeline-dot HistoryTimeline-dot--${entry.operation}`} />
          <div className="HistoryTimeline-body">
            <span className="HistoryTimeline-op">{OP_LABELS[entry.operation]}</span>
            <span className="HistoryTimeline-time">
              {new Date(entry.timestamp).toLocaleString()}
            </span>
            {entry.snapshot.value && (
              <span className="HistoryTimeline-value">{entry.snapshot.value}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
