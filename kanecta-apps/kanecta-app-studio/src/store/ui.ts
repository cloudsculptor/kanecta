import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PanelConfig, PanelLayout, SidebarState, FilterState, SortState } from '../types/ui';

const defaultPanel: PanelConfig = {
  id: 'default',
  viewType: 'home',
};

interface UiState {
  layout: PanelLayout;
  sidebarState: SidebarState;
  rightPanelOpen: boolean;
  focusedItemId: string | null;
  filtersByPanel: Record<string, FilterState>;
  sortsByPanel: Record<string, SortState>;
  vscodeAvailable: boolean;

  addPanel: (config?: Partial<PanelConfig>) => void;
  removePanel: (id: string) => void;
  updatePanel: (id: string, updates: Partial<PanelConfig>) => void;
  setPanelSizes: (sizes: number[]) => void;
  setSidebarState: (state: SidebarState) => void;
  setRightPanelOpen: (open: boolean) => void;
  setFocusedItem: (id: string | null) => void;
  setPanelFilter: (panelId: string, filter: FilterState) => void;
  setPanelSort: (panelId: string, sort: SortState) => void;
  setVscodeAvailable: (available: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      layout: { panels: [defaultPanel], sizes: [100] },
      sidebarState: 'expanded',
      rightPanelOpen: false,
      focusedItemId: null,
      filtersByPanel: {},
      sortsByPanel: {},
      vscodeAvailable: false,

      addPanel: (config = {}) =>
        set((s) => {
          const id = crypto.randomUUID();
          const newPanel: PanelConfig = { id, viewType: 'tree', ...config };
          const count = s.layout.panels.length + 1;
          const sizes = Array(count).fill(100 / count);
          return { layout: { panels: [...s.layout.panels, newPanel], sizes } };
        }),

      removePanel: (id) =>
        set((s) => {
          const panels = s.layout.panels.filter((p) => p.id !== id);
          if (panels.length === 0) return s;
          const sizes = Array(panels.length).fill(100 / panels.length);
          return { layout: { panels, sizes } };
        }),

      updatePanel: (id, updates) =>
        set((s) => ({
          layout: {
            ...s.layout,
            panels: s.layout.panels.map((p) => (p.id === id ? { ...p, ...updates } : p)),
          },
        })),

      setPanelSizes: (sizes) =>
        set((s) => ({ layout: { ...s.layout, sizes } })),

      setSidebarState: (sidebarState) => set({ sidebarState }),

      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),

      setFocusedItem: (focusedItemId) =>
        set({ focusedItemId, rightPanelOpen: focusedItemId !== null }),

      setPanelFilter: (panelId, filter) =>
        set((s) => ({ filtersByPanel: { ...s.filtersByPanel, [panelId]: filter } })),

      setPanelSort: (panelId, sort) =>
        set((s) => ({ sortsByPanel: { ...s.sortsByPanel, [panelId]: sort } })),

      setVscodeAvailable: (vscodeAvailable) => set({ vscodeAvailable }),
    }),
    { name: 'kanecta-ui' },
  ),
);
