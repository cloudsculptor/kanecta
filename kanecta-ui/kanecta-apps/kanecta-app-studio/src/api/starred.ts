import type { KanectaApiClient } from '@kanecta/api-client';
import type { ClipboardEntry } from './breadcrumb';

export function starredApi(client: KanectaApiClient) {
  return {
    list: () => client.starred.get() as unknown as Promise<ClipboardEntry[]>,
    add: (id: string, name: string, type: string, typeId: string) =>
      client.starred.add({ id, name, type, typeId }),
    remove: (id: string) => client.starred.remove(id),
  };
}
