import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspaceConfig } from '../types/workspace';
import { createApi } from '../api';

const PRIMARY_WORKSPACE_ID = 'primary';

interface WorkspaceState {
  workspaces: WorkspaceConfig[];
  activeWorkspaceId: string;
  addWorkspace: (config: Omit<WorkspaceConfig, 'id'>) => string;
  updateWorkspace: (id: string, updates: Partial<WorkspaceConfig>) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;
  getActiveWorkspace: () => WorkspaceConfig | undefined;
  getApi: (workspaceId?: string) => ReturnType<typeof createApi>;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [
        {
          id: PRIMARY_WORKSPACE_ID,
          name: 'Kanecta Internal',
          apiUrl: import.meta.env.VITE_KANECTA_API_URL ?? '/api',
          colour: '#1976d2',
          pollIntervalMs: 5000,
        },
      ],
      activeWorkspaceId: PRIMARY_WORKSPACE_ID,

      addWorkspace: (config) => {
        const id = crypto.randomUUID();
        set((s) => ({ workspaces: [...s.workspaces, { ...config, id }] }));
        return id;
      },

      updateWorkspace: (id, updates) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...updates } : w)),
        })),

      removeWorkspace: (id) =>
        set((s) => ({
          workspaces: s.workspaces.filter((w) => w.id !== id),
          activeWorkspaceId:
            s.activeWorkspaceId === id ? PRIMARY_WORKSPACE_ID : s.activeWorkspaceId,
        })),

      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

      getActiveWorkspace: () => {
        const { workspaces, activeWorkspaceId } = get();
        return workspaces.find((w) => w.id === activeWorkspaceId);
      },

      getApi: (workspaceId) => {
        const { workspaces, activeWorkspaceId } = get();
        const id = workspaceId ?? activeWorkspaceId;
        const workspace = workspaces.find((w) => w.id === id);
        return createApi(workspace?.apiUrl ?? '/api');
      },
    }),
    { name: 'kanecta-workspaces' },
  ),
);
