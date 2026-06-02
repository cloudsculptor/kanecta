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
  { name: 'White',     sidebarBg: '#ffffff', sidebarFg: '#5a6a60', sidebarFgSelected: '#444444', contentBg: '#ffffff', contentBorder: '#e0e0e0', showContentBorder: true,  locationBorder: '#cccccc' },
  { name: 'Light',     sidebarBg: '#f5f5f5', sidebarFg: '#5a6a60', sidebarFgSelected: '#444444', contentBg: '#ffffff', contentBorder: '#e0e0e0', showContentBorder: true,  locationBorder: '#cccccc' },
  { name: 'Dark',      sidebarBg: '#535754', sidebarFg: '#ffffff', sidebarFgSelected: '#e0e0e0', contentBg: '#ffffff', contentBorder: '#e0e0e0', showContentBorder: true,  locationBorder: '#888888' },
  { name: 'Solarised', sidebarBg: '#073642', sidebarFg: '#ffffff', sidebarFgSelected: '#93a1a1', contentBg: '#fdf6e3', contentBorder: '#e0e0e0', showContentBorder: true,  locationBorder: '#93a1a1' },
  { name: 'Blue',      sidebarBg: '#000080', sidebarFg: '#ffffff', sidebarFgSelected: '#5a6a60', contentBg: '#ffffff', contentBorder: '#e0e0e0', showContentBorder: true,  locationBorder: '#4060a0' },
  { name: 'Green',     sidebarBg: '#20a138', sidebarFg: '#ffffff', sidebarFgSelected: '#5a6a60', contentBg: '#ffffff', contentBorder: '#e0e0e0', showContentBorder: false, locationBorder: '#15712a' },
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
