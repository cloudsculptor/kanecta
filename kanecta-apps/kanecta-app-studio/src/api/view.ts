import type { KanectaApiClient } from '@kanecta/api-client';

export interface ViewSettings {
  levels: number | 'all';
}

export function viewApi(client: KanectaApiClient) {
  return {
    get: (id: string) => client.view.get(id) as unknown as Promise<ViewSettings | null>,
    save: (id: string, levels: number | 'all') => client.view.save(id, { levels }),
  };
}
