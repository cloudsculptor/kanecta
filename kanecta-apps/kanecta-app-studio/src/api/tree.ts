import type { ApiClient } from './client';
import type { KanectaItemWithChildren } from '../types/kanecta';

export function treeApi(client: ApiClient) {
  return {
    full: (depth?: number) =>
      client.get<KanectaItemWithChildren[]>(
        `/tree${depth != null ? `?depth=${depth}` : ''}`,
      ),

    rebuildIndexes: () =>
      client.post<{ rebuilt: boolean; itemCount: number }>('/rebuild-indexes'),
  };
}
