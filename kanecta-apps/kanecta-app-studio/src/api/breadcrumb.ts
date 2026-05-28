import type { ApiClient } from './client';

export interface ClipboardEntry {
  id: string;
  name: string;
  timestamp: string;
}

export function breadcrumbApi(client: ApiClient) {
  return {
    getClipboard: () => client.get<ClipboardEntry[]>('/breadcrumb/clipboard'),
    addClipboard: (id: string, name: string) =>
      client.post<{ ok: boolean }>('/breadcrumb/clipboard', { id, name }),
  };
}
