import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ThemeDefinition {
  name: string;
  sidebarBg: string;
  sidebarFg: string;
  sidebarFgSelected: string;
  contentBg: string;
  contentBorder: string;
  showContentBorder: boolean;
  locationBorder: string;
}

export const THEMES: ThemeDefinition[] = [
  { name: 'White',     sidebarBg: 'var(--color-surface)', sidebarFg: 'var(--color-text-secondary)', sidebarFgSelected: 'var(--color-text)', contentBg: 'var(--color-surface)', contentBorder: 'var(--color-border)', showContentBorder: true,  locationBorder: 'var(--color-border)' },
  { name: 'Light',     sidebarBg: 'var(--color-surface-raised)', sidebarFg: 'var(--color-text-secondary)', sidebarFgSelected: 'var(--color-text)', contentBg: 'var(--color-surface)', contentBorder: 'var(--color-border)', showContentBorder: true,  locationBorder: 'var(--color-border)' },
  { name: 'Dark',      sidebarBg: '#535754', sidebarFg: '#ffffff', sidebarFgSelected: '#e0e0e0', contentBg: 'var(--color-surface)', contentBorder: 'var(--color-border)', showContentBorder: true,  locationBorder: '#888888' },
  { name: 'Solarised', sidebarBg: '#073642', sidebarFg: '#ffffff', sidebarFgSelected: '#93a1a1', contentBg: 'var(--color-surface)', contentBorder: 'var(--color-border)', showContentBorder: true,  locationBorder: '#93a1a1' },
  { name: 'Blue',      sidebarBg: '#000080', sidebarFg: '#ffffff', sidebarFgSelected: '#5a6a60', contentBg: 'var(--color-surface)', contentBorder: 'var(--color-border)', showContentBorder: true,  locationBorder: '#4060a0' },
  { name: 'Green',     sidebarBg: '#20a138', sidebarFg: '#ffffff', sidebarFgSelected: '#5a6a60', contentBg: 'var(--color-surface)', contentBorder: 'var(--color-border)', showContentBorder: false, locationBorder: '#15712a' },
];

interface SettingsState {
  themeName: string;
  sidebarBg: string;
  sidebarFg: string;
  sidebarFgSelected: string;
  contentBg: string;
  contentBorder: string;
  showContentBorder: boolean;
  locationBorder: string;
  applyTheme: (theme: ThemeDefinition) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeName: 'Light',
      ...THEMES[0],
      applyTheme: (theme) =>
        set({
          themeName: theme.name,
          sidebarBg: theme.sidebarBg,
          sidebarFg: theme.sidebarFg,
          sidebarFgSelected: theme.sidebarFgSelected,
          contentBg: theme.contentBg,
          contentBorder: theme.contentBorder,
          showContentBorder: theme.showContentBorder,
          locationBorder: theme.locationBorder,
        }),
    }),
    { name: 'kanecta-settings' },
  ),
);
