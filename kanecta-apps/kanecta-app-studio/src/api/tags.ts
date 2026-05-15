import type { ApiClient } from './client';
import type { KanectaItem } from '../types/kanecta';

export function tagsApi(client: ApiClient) {
  return {
    byTag: (tag: string) => client.get<KanectaItem[]>(`/tags/${encodeURIComponent(tag)}`),
  };
}
