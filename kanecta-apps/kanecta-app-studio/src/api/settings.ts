import type { ApiClient } from './client';

export interface AppSettings {
  themeName: string;
  sidebarBg: string;
  sidebarFg: string;
  sidebarFgSelected: string;
  contentBg: string;
  contentBorder: string;
}

export function settingsApi(client: ApiClient) {
  return {
    get: () => client.get<AppSettings>('/app/studio/settings'),
    save: (settings: AppSettings) => client.post<{ ok: boolean }>('/app/studio/settings', settings),
  };
}
