import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkingSetConfig } from '../types/workingSet';
import { createApi } from '../api';

const PRIMARY_WORKING_SET_ID = 'primary';

interface WorkingSetState {
  workingSets: WorkingSetConfig[];
  activeWorkingSetId: string;
  addWorkingSet: (config: Omit<WorkingSetConfig, 'id'>) => string;
  updateWorkingSet: (id: string, updates: Partial<WorkingSetConfig>) => void;
  removeWorkingSet: (id: string) => void;
  setActiveWorkingSet: (id: string) => void;
  getActiveWorkingSet: () => WorkingSetConfig | undefined;
  getApi: (workingSetId?: string) => ReturnType<typeof createApi>;
}

export const useWorkingSetStore = create<WorkingSetState>()(
  persist(
    (set, get) => ({
      workingSets: [
        {
          id: PRIMARY_WORKING_SET_ID,
          name: 'Kanecta Internal',
          apiUrl: import.meta.env.VITE_KANECTA_API_URL ?? '/api',
          colour: '#1976d2',
          pollIntervalMs: 5000,
        },
      ],
      activeWorkingSetId: PRIMARY_WORKING_SET_ID,

      addWorkingSet: (config) => {
        const id = crypto.randomUUID();
        set((s) => ({ workingSets: [...s.workingSets, { ...config, id }] }));
        return id;
      },

      updateWorkingSet: (id, updates) =>
        set((s) => ({
          workingSets: s.workingSets.map((w) => (w.id === id ? { ...w, ...updates } : w)),
        })),

      removeWorkingSet: (id) =>
        set((s) => ({
          workingSets: s.workingSets.filter((w) => w.id !== id),
          activeWorkingSetId:
            s.activeWorkingSetId === id ? PRIMARY_WORKING_SET_ID : s.activeWorkingSetId,
        })),

      setActiveWorkingSet: (id) => set({ activeWorkingSetId: id }),

      getActiveWorkingSet: () => {
        const { workingSets, activeWorkingSetId } = get();
        return workingSets.find((w) => w.id === activeWorkingSetId);
      },

      getApi: (workingSetId) => {
        const { workingSets, activeWorkingSetId } = get();
        const id = workingSetId ?? activeWorkingSetId;
        const workingSet = workingSets.find((w) => w.id === id);
        return createApi(workingSet?.apiUrl ?? '/api');
      },
    }),
    { name: 'kanecta-working-sets' },
  ),
);
