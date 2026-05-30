import type { ApiClient } from './client';

export interface AppSettings {
  background: string;
  foreground: string;
  contentBackground: string;
  contentForeground: string;
}

export function settingsApi(client: ApiClient) {
  return {
    get: () => client.get<AppSettings>('/app/studio/settings'),
    save: (settings: AppSettings) => client.post<{ ok: boolean }>('/app/studio/settings', settings),
  };
}
