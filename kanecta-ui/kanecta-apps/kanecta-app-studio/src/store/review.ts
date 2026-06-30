import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KanectaItem } from '../types/kanecta';
import type { ActivityEvent } from '../types/workingSet';

interface ReviewState {
  unreviewedThreshold: number;
  reviewQueue: KanectaItem[];
  conveyorIndex: number;
  activityLog: ActivityEvent[];
  seenItemIds: Set<string>;

  setUnreviewedThreshold: (n: number) => void;
  setReviewQueue: (items: KanectaItem[]) => void;
  advanceConveyor: () => void;
  resetConveyor: () => void;
  appendActivity: (events: ActivityEvent[]) => void;
  clearActivity: () => void;
  markSeen: (ids: string[]) => void;

  get unreviewedCount(): number;
}

export const useReviewStore = create<ReviewState>()(
  persist(
    (set, get) => ({
      unreviewedThreshold: 20,
      reviewQueue: [],
      conveyorIndex: 0,
      activityLog: [],
      seenItemIds: new Set<string>(),

      get unreviewedCount() {
        return get().reviewQueue.length;
      },

      setUnreviewedThreshold: (unreviewedThreshold) => set({ unreviewedThreshold }),

      setReviewQueue: (reviewQueue) => set({ reviewQueue, conveyorIndex: 0 }),

      advanceConveyor: () =>
        set((s) => ({
          conveyorIndex: Math.min(s.conveyorIndex + 1, s.reviewQueue.length),
        })),

      resetConveyor: () => set({ conveyorIndex: 0 }),

      appendActivity: (events) =>
        set((s) => ({
          activityLog: [...events, ...s.activityLog].slice(0, 500),
        })),

      clearActivity: () => set({ activityLog: [] }),

      markSeen: (ids) =>
        set((s) => {
          const next = new Set(s.seenItemIds);
          for (const id of ids) next.add(id);
          return { seenItemIds: next };
        }),
    }),
    {
      name: 'kanecta-review',
      partialize: (s) => ({
        unreviewedThreshold: s.unreviewedThreshold,
        activityLog: s.activityLog,
        seenItemIds: [...s.seenItemIds],
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<ReviewState> & { seenItemIds?: string[] };
        return {
          ...current,
          unreviewedThreshold: p.unreviewedThreshold ?? current.unreviewedThreshold,
          activityLog: (p.activityLog as ActivityEvent[]) ?? current.activityLog,
          seenItemIds: new Set<string>((p.seenItemIds as string[]) ?? []),
        };
      },
    },
  ),
);
