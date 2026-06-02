import type { ApiClient } from './client';

export interface ViewSettings {
  levels: number | 'all';
}

export function viewApi(client: ApiClient) {
  return {
    get: (id: string) => client.get<ViewSettings | null>(`/app/studio/view/${id}`),
    save: (id: string, levels: number | 'all') =>
      client.put<{ ok: boolean }>(`/app/studio/view/${id}`, { levels }),
  };
}
