import type { ApiClient } from './client';
import type { ClipboardEntry } from './breadcrumb';

export function starredApi(client: ApiClient) {
  return {
    list: () => client.get<ClipboardEntry[]>('/app/studio/starred'),
    add: (id: string, name: string, type: string, typeId: string) =>
      client.post<{ ok: boolean }>('/app/studio/starred', { id, name, type, typeId }),
    remove: (id: string) => client.delete<{ ok: boolean }>(`/app/studio/starred/${id}`),
  };
}
