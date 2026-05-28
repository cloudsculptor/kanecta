import type { ApiClient } from './client';

export interface ClipboardEntry {
  id: string;
  name: string;
  type: string;
  typeId: string;
  timestamp: string;
}

export function breadcrumbApi(client: ApiClient) {
  return {
    getClipboard: () => client.get<ClipboardEntry[]>('/breadcrumb/clipboard'),
    addClipboard: (id: string, name: string, type: string, typeId: string) =>
      client.post<{ ok: boolean }>('/breadcrumb/clipboard', { id, name, type, typeId }),
    getViewed: () => client.get<ClipboardEntry[]>('/breadcrumb/viewed'),
    addViewed: (id: string, name: string, type: string, typeId: string) =>
      client.post<{ ok: boolean }>('/breadcrumb/viewed', { id, name, type, typeId }),
  };
}
