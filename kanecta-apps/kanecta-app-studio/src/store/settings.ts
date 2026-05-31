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
}

export const THEMES: ThemeDefinition[] = [
  { name: 'White',     sidebarBg: '#ffffff', sidebarFg: '#5a6a60', sidebarFgSelected: '#444444', contentBg: '#ffffff', contentBorder: '#e0e0e0', showContentBorder: true },
  { name: 'Light',     sidebarBg: '#f5f5f5', sidebarFg: '#5a6a60', sidebarFgSelected: '#444444', contentBg: '#ffffff', contentBorder: '#e0e0e0', showContentBorder: true },
  { name: 'Dark',      sidebarBg: '#535754', sidebarFg: '#ffffff', sidebarFgSelected: '#e0e0e0', contentBg: '#ffffff', contentBorder: '#3a3a3a', showContentBorder: true },
  { name: 'Solarised', sidebarBg: '#073642', sidebarFg: '#ffffff', sidebarFgSelected: '#93a1a1', contentBg: '#fdf6e3', contentBorder: '#d4c89a', showContentBorder: true },
  { name: 'Blue',      sidebarBg: '#000080', sidebarFg: '#ffffff', sidebarFgSelected: '#5a6a60', contentBg: '#ffffff', contentBorder: '#b0c8e0', showContentBorder: true },
  { name: 'Green',     sidebarBg: '#20a138', sidebarFg: '#ffffff', sidebarFgSelected: '#5a6a60', contentBg: '#ffffff', contentBorder: '#20a138', showContentBorder: false },
];

interface SettingsState {
  themeName: string;
  sidebarBg: string;
  sidebarFg: string;
  sidebarFgSelected: string;
  contentBg: string;
  contentBorder: string;
  showContentBorder: boolean;
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
        }),
    }),
    { name: 'kanecta-settings' },
  ),
);
