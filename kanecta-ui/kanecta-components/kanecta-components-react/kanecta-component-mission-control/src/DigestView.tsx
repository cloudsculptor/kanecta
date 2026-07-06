import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { buildDigest, detectConflicts } from './utils';
import { ConflictList } from './ConflictList';
import type { DigestViewProps, MissionItem } from './types';
import './DigestView.scss';

function formatDate(isoString: string | null): string {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString();
}

export function DigestView({
  workspaces,
  activityLog,
  reviewQueueLength,
  onFetchWorkspaceItems,
  onDeleteItem,
  queryKeyPrefix = '',
}: DigestViewProps) {
  const [tab, setTab] = useState<'digest' | 'conflicts'>('digest');
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

  const results = useQueries({
    queries: workspaces.map((ws) => ({
      queryKey: ['digest-items', queryKeyPrefix, ws.id],
      queryFn: () => onFetchWorkspaceItems(ws.id),
      refetchInterval: ws.pollIntervalMs,
    })),
  });

  const allItems: MissionItem[] = results.flatMap((r) => (r.data ?? []));

  const conflicts = useMemo(() => {
    const wsItems = workspaces.map((ws, i) => ({
      workspaceId: ws.id,
      items: results[i].data ?? [],
    }));
    return detectConflicts(wsItems).filter((c) => !resolvedIds.has(c.id));
  }, [results, workspaces, resolvedIds]);

  const digest = useMemo(
    () => buildDigest(activityLog, allItems, conflicts.length, reviewQueueLength),
    [activityLog, allItems, conflicts.length, reviewQueueLength],
  );

  const handleConflictResolved = (id: string) =>
    setResolvedIds((s) => new Set([...s, id]));

  return (
    <div className="DigestView">
      <div className="DigestView-tabs">
        <button
          className={`DigestView-tab${tab === 'digest' ? ' DigestView-tab--active' : ''}`}
          onClick={() => setTab('digest')}
        >
          Digest
        </button>
        <button
          className={`DigestView-tab${tab === 'conflicts' ? ' DigestView-tab--active' : ''}`}
          onClick={() => setTab('conflicts')}
        >
          Conflicts {conflicts.length > 0 && <span className="DigestView-badge">{conflicts.length}</span>}
        </button>
      </div>

      {tab === 'digest' && (
        <div className="DigestView-content">
          <div className="DigestView-summary">
            <div className="DigestView-summary-stat">
              <span className="DigestView-summary-value">{digest.totalEvents}</span>
              <span className="DigestView-summary-label">events</span>
            </div>
            <div className="DigestView-summary-stat">
              <span className="DigestView-summary-value DigestView-summary-value--warn">{digest.conflictCount}</span>
              <span className="DigestView-summary-label">conflicts</span>
            </div>
            <div className="DigestView-summary-stat">
              <span className="DigestView-summary-value">{digest.reviewBacklogCount}</span>
              <span className="DigestView-summary-label">to review</span>
            </div>
            <div className="DigestView-summary-stat">
              <span className="DigestView-summary-value DigestView-summary-active">{formatDate(digest.lastActiveAt)}</span>
              <span className="DigestView-summary-label">last active</span>
            </div>
          </div>

          <div className="DigestView-groups">
            {digest.groups.length === 0 ? (
              <p className="DigestView-empty">No activity yet</p>
            ) : (
              digest.groups.map((group) => (
                <div key={group.parentId ?? 'root'} className="DigestView-group">
                  <div className="DigestView-group-header">
                    <span className="DigestView-group-parent">{group.parentValue}</span>
                    <span className="DigestView-group-counts">
                      {group.createdCount > 0 && (
                        <span className="DigestView-group-count DigestView-group-count--created">+{group.createdCount}</span>
                      )}
                      {group.modifiedCount > 0 && (
                        <span className="DigestView-group-count DigestView-group-count--modified">~{group.modifiedCount}</span>
                      )}
                    </span>
                  </div>
                  {group.events.slice(0, 3).map((event) => (
                    <div key={event.id} className="DigestView-group-event">
                      <span className="DigestView-group-event-op">{event.operation === 'created' ? '+' : '~'}</span>
                      <span className="DigestView-group-event-value">{event.item.value}</span>
                    </div>
                  ))}
                  {group.events.length > 3 && (
                    <p className="DigestView-group-more">+{group.events.length - 3} more</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'conflicts' && (
        <ConflictList
          conflicts={conflicts}
          workspaces={workspaces}
          onDeleteItem={onDeleteItem}
          onResolved={handleConflictResolved}
          queryKeyPrefix={queryKeyPrefix}
        />
      )}
    </div>
  );
}
