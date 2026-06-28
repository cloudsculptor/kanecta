import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfidenceBadge, type ConfidenceLevel } from '@kanecta/component-confidence-badge';
import { TypeBadge } from '@kanecta/component-type-badge';
import type { ConflictPair, MissionWorkspace } from './types';
import './ConflictList.css';

interface ConflictListProps {
  conflicts: ConflictPair[];
  workspaces: MissionWorkspace[];
  onDeleteItem: (workspaceId: string, itemId: string) => Promise<unknown>;
  onResolved?: (conflictId: string) => void;
  queryKeyPrefix?: string;
}

interface ConflictCardProps {
  conflict: ConflictPair;
  workspaces: MissionWorkspace[];
  onDeleteItem: (workspaceId: string, itemId: string) => Promise<unknown>;
  onResolved?: (id: string) => void;
  queryKeyPrefix?: string;
}

function ConflictCard({ conflict, workspaces, onDeleteItem, onResolved, queryKeyPrefix = '' }: ConflictCardProps) {
  const qc = useQueryClient();
  const wsMap = new Map(workspaces.map((w) => [w.id, w]));

  const wsA = wsMap.get(conflict.workspaceIdA);
  const wsB = wsMap.get(conflict.workspaceIdB);

  const keepA = useMutation({
    mutationFn: () => onDeleteItem(conflict.workspaceIdB, conflict.itemB.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mc-items', queryKeyPrefix] });
      onResolved?.(conflict.id);
    },
  });

  const keepB = useMutation({
    mutationFn: () => onDeleteItem(conflict.workspaceIdA, conflict.itemA.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mc-items', queryKeyPrefix] });
      onResolved?.(conflict.id);
    },
  });

  const dismiss = () => onResolved?.(conflict.id);

  return (
    <div className="ConflictList-card">
      <div className="ConflictList-card-header">
        <span className="ConflictList-card-reason">{conflict.reason.replace(/-/g, ' ')}</span>
        <span className="ConflictList-card-sim">{Math.round(conflict.similarity * 100)}% similar</span>
      </div>

      <div className="ConflictList-card-sides">
        {[
          { item: conflict.itemA, ws: wsA, keepFn: () => keepA.mutate() },
          { item: conflict.itemB, ws: wsB, keepFn: () => keepB.mutate() },
        ].map(({ item, ws, keepFn }, idx) => (
          <div key={idx} className="ConflictList-card-side">
            {ws && (
              <div className="ConflictList-card-ws" style={{ borderColor: ws.colour, color: ws.colour }}>
                {ws.name}
              </div>
            )}
            <div className="ConflictList-card-badges">
              <TypeBadge type={item.type} />
              <ConfidenceBadge confidence={(item.confidence ?? null) as ConfidenceLevel | null} />
            </div>
            <p className="ConflictList-card-value">{item.value}</p>
            <button className="ConflictList-card-keep" onClick={keepFn}>Keep this</button>
          </div>
        ))}
      </div>

      <button className="ConflictList-card-dismiss" onClick={dismiss}>Dismiss</button>
    </div>
  );
}

export function ConflictList({ conflicts, workspaces, onDeleteItem, onResolved, queryKeyPrefix }: ConflictListProps) {
  if (conflicts.length === 0) {
    return <div className="ConflictList-empty">No conflicts detected</div>;
  }

  return (
    <div className="ConflictList">
      {conflicts.map((conflict) => (
        <ConflictCard
          key={conflict.id}
          conflict={conflict}
          workspaces={workspaces}
          onDeleteItem={onDeleteItem}
          onResolved={onResolved}
          queryKeyPrefix={queryKeyPrefix}
        />
      ))}
    </div>
  );
}
