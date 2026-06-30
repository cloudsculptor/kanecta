import { useEffect, useRef } from 'react';
import { useWorkingSetStore } from '../store/workingSet';
import { useReviewStore } from '../store/review';
import { diffItems, buildItemMap } from '../lib/activity';
import type { KanectaItem } from '../types/kanecta';

export function useLiveActivity() {
  const { workingSets, getApi } = useWorkingSetStore();
  const { appendActivity, setReviewQueue, seenItemIds } = useReviewStore();

  const snapshotRef = useRef<Map<string, Map<string, KanectaItem>>>(new Map());

  useEffect(() => {
    const timers: ReturnType<typeof setInterval>[] = [];

    for (const workingSet of workingSets) {
      const poll = async () => {
        try {
          const api = getApi(workingSet.id);
          const items: KanectaItem[] = await api.items.list();
          const previous = snapshotRef.current.get(workingSet.id) ?? new Map<string, KanectaItem>();
          const events = diffItems(workingSet.id, previous, items);
          snapshotRef.current.set(workingSet.id, buildItemMap(items));

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
      timers.push(setInterval(poll, workingSet.pollIntervalMs));
    }

    return () => {
      for (const t of timers) clearInterval(t);
    };
  }, [workingSets, getApi, appendActivity, setReviewQueue, seenItemIds]);
}
