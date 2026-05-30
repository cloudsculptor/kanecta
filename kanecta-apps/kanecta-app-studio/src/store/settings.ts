import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  background: string;
  foreground: string;
  contentBackground: string;
  contentForeground: string;
  setTheme: (
    background: string,
    foreground: string,
    contentBackground?: string,
    contentForeground?: string,
  ) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      background: '#ffffff',
      foreground: '#000000',
      contentBackground: '#ffffff',
      contentForeground: '#1a1a1a',
      setTheme: (background, foreground, contentBackground, contentForeground) =>
        set((s) => ({
          background,
          foreground,
          contentBackground: contentBackground ?? s.contentBackground,
          contentForeground: contentForeground ?? s.contentForeground,
        })),
    }),
    { name: 'kanecta-settings' },
  ),
);
