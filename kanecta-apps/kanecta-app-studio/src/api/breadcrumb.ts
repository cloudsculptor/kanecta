import type { KanectaApiClient } from '@kanecta/api-client';

export interface ClipboardEntry {
  id: string;
  name: string;
  type: string;
  typeId: string;
  timestamp: string;
}

export function breadcrumbApi(client: KanectaApiClient) {
  return {
    getClipboard: () => client.breadcrumb.getClipboard() as unknown as Promise<ClipboardEntry[]>,
    addClipboard: (id: string, name: string, type: string, typeId: string) =>
      client.breadcrumb.addClipboard({ id, name, type, typeId }),
    getViewed: () => client.breadcrumb.getViewed() as unknown as Promise<ClipboardEntry[]>,
    addViewed: (id: string, name: string, type: string, typeId: string) =>
      client.breadcrumb.addViewed({ id, name, type, typeId }),
  };
}
