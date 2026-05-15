import type { ApiClient } from './client';

export interface AliasEntry {
  alias: string;
  targetId: string;
}

export function aliasesApi(client: ApiClient) {
  return {
    list: () => client.get<AliasEntry[]>('/aliases'),

    resolve: (alias: string) => client.get<AliasEntry>(`/aliases/${alias}`),

    set: (alias: string, targetId: string) =>
      client.post<AliasEntry>('/aliases', { alias, targetId }),

    remove: (alias: string) => client.delete<{ removed: string }>(`/aliases/${alias}`),
  };
}
