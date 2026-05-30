import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  background: string;
  foreground: string;
  contentBackground: string;
  setTheme: (background: string, foreground: string, contentBackground?: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      background: '#ffffff',
      foreground: '#000000',
      contentBackground: '#ffffff',
      setTheme: (background, foreground, contentBackground) =>
        set((s) => ({ background, foreground, contentBackground: contentBackground ?? s.contentBackground })),
    }),
    { name: 'kanecta-settings' },
  ),
);
