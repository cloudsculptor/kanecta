import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../store/workspace';
import { useReviewStore } from '../store/review';
import { diffItems, buildItemMap } from '../lib/activity';
import type { KanectaItem } from '../types/kanecta';

export function useLiveActivity() {
  const { workspaces, getApi } = useWorkspaceStore();
  const { appendActivity, setReviewQueue, seenItemIds } = useReviewStore();

  const snapshotRef = useRef<Map<string, Map<string, KanectaItem>>>(new Map());

  useEffect(() => {
    const timers: ReturnType<typeof setInterval>[] = [];

    for (const workspace of workspaces) {
      const poll = async () => {
        try {
          const api = getApi(workspace.id);
          const items: KanectaItem[] = await api.items.list();
          const previous = snapshotRef.current.get(workspace.id) ?? new Map<string, KanectaItem>();
          const events = diffItems(workspace.id, previous, items);
          snapshotRef.current.set(workspace.id, buildItemMap(items));

          if (events.length > 0) {
            appendActivity(events);
          }

          const unreviewed = items.filter((i) => !seenItemIds.has(i.id));
          setReviewQueue(unreviewed);
        } catch {
          // network error — silently skip this tick
        }
      };

      void poll();
      timers.push(setInterval(poll, workspace.pollIntervalMs));
    }

    return () => {
      for (const t of timers) clearInterval(t);
    };
  }, [workspaces, getApi, appendActivity, setReviewQueue, seenItemIds]);
}
