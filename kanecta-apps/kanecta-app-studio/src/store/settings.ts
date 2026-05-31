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
  { name: 'Light',     sidebarBg: '#f5f5f5', sidebarFg: '#ffffff', sidebarFgSelected: '#444444', contentBg: '#ffffff', contentBorder: '#e0e0e0', showContentBorder: true },
  { name: 'Dark',      sidebarBg: '#1e1e1e', sidebarFg: '#ffffff', sidebarFgSelected: '#e0e0e0', contentBg: '#252526', contentBorder: '#3a3a3a', showContentBorder: true },
  { name: 'Solarised', sidebarBg: '#073642', sidebarFg: '#ffffff', sidebarFgSelected: '#93a1a1', contentBg: '#fdf6e3', contentBorder: '#d4c89a', showContentBorder: true },
  { name: 'Navy',      sidebarBg: '#001f3f', sidebarFg: '#ffffff', sidebarFgSelected: '#b0d0f0', contentBg: '#ffffff', contentBorder: '#b0c8e0', showContentBorder: true },
  { name: 'Forest',    sidebarBg: '#1a3325', sidebarFg: '#ffffff', sidebarFgSelected: '#a8e8c0', contentBg: '#fafff8', contentBorder: '#b8d8c0', showContentBorder: true },
  { name: 'Slate',     sidebarBg: '#2c3e50', sidebarFg: '#ffffff', sidebarFgSelected: '#dce8f0', contentBg: '#ffffff', contentBorder: '#c0d0e0', showContentBorder: true },
  { name: 'Midnight',  sidebarBg: '#0d0d1a', sidebarFg: '#ffffff', sidebarFgSelected: '#a0b0e0', contentBg: '#ffffff', contentBorder: '#c0c8e8', showContentBorder: true },
  { name: 'Rose',      sidebarBg: '#2d1520', sidebarFg: '#ffffff', sidebarFgSelected: '#f0a0c0', contentBg: '#fff8f9', contentBorder: '#e8c0cc', showContentBorder: true },
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
