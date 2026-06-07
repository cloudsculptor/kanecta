import type { KanectaApiClient } from '@kanecta/api-client';

export interface AppSettings {
  themeName: string;
  sidebarBg: string;
  sidebarFg: string;
  sidebarFgSelected: string;
  contentBg: string;
  contentBorder: string;
  showContentBorder: boolean;
  locationBorder: string;
}

export function settingsApi(client: KanectaApiClient) {
  return {
    get: () => client.settings.get() as unknown as Promise<AppSettings>,
    save: (settings: AppSettings) => client.settings.save(settings),
  };
}
