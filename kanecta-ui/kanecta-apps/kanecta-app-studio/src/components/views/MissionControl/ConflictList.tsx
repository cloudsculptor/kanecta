import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConflictPair } from '../../../lib/conflicts';
import { useWorkingSetStore } from '../../../store/workingSet';
import { ConfidenceBadge } from '@kanecta/component-confidence-badge';
import { TypeBadge } from '@kanecta/component-type-badge';
import './ConflictList.scss';

interface ConflictListProps {
  conflicts: ConflictPair[];
  onResolved?: (conflictId: string) => void;
}

interface ConflictCardProps {
  conflict: ConflictPair;
  onResolved?: (id: string) => void;
}

function ConflictCard({ conflict, onResolved }: ConflictCardProps) {
  const { workingSets, getApi } = useWorkingSetStore();
  const qc = useQueryClient();
  const wsMap = new Map(workingSets.map((w) => [w.id, w]));

  const wsA = wsMap.get(conflict.workingSetIdA);
  const wsB = wsMap.get(conflict.workingSetIdB);

  const keepA = useMutation({
    mutationFn: () => getApi(conflict.workingSetIdB).items.delete(conflict.itemB.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items-list'] });
      onResolved?.(conflict.id);
    },
  });

  const keepB = useMutation({
    mutationFn: () => getApi(conflict.workingSetIdA).items.delete(conflict.itemA.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items-list'] });
      onResolved?.(conflict.id);
    },
  });

  const dismiss = () => onResolved?.(conflict.id);

  return (
    <div className="ConflictList-card">
      <div className="ConflictList-card-header">
        <span className="ConflictList-card-reason">{conflict.reason.replace(/-/g, ' ')}</span>
        <span className="ConflictList-card-sim">
          {Math.round(conflict.similarity * 100)}% similar
        </span>
      </div>

      <div className="ConflictList-card-sides">
        {[
          { item: conflict.itemA, ws: wsA, keepFn: () => keepA.mutate() },
          { item: conflict.itemB, ws: wsB, keepFn: () => keepB.mutate() },
        ].map(({ item, ws, keepFn }, idx) => (
          <div key={idx} className="ConflictList-card-side">
            {ws && (
              <div
                className="ConflictList-card-ws"
                style={{ borderColor: ws.colour, color: ws.colour }}
              >
                {ws.name}
              </div>
            )}
            <div className="ConflictList-card-badges">
              <TypeBadge type={item.type} />
              <ConfidenceBadge confidence={item.confidence} />
            </div>
            <p className="ConflictList-card-value">{item.value}</p>
            <button className="ConflictList-card-keep" onClick={keepFn}>
              Keep this
            </button>
          </div>
        ))}
      </div>

      <button className="ConflictList-card-dismiss" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}

export function ConflictList({ conflicts, onResolved }: ConflictListProps) {
  if (conflicts.length === 0) {
    return <div className="ConflictList-empty">No conflicts detected</div>;
  }

  return (
    <div className="ConflictList">
      {conflicts.map((conflict) => (
        <ConflictCard key={conflict.id} conflict={conflict} onResolved={onResolved} />
      ))}
    </div>
  );
}
