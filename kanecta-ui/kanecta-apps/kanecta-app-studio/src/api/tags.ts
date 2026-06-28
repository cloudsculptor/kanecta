import type { KanectaApiClient } from '@kanecta/api-client';
import type { KanectaItem } from '../types/kanecta';

export function tagsApi(client: KanectaApiClient) {
  return {
    byTag: (tag: string) => client.tags.byTag(tag) as unknown as Promise<KanectaItem[]>,
  };
}
