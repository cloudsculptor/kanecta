import type { KanectaApiClient } from '@kanecta/api-client';

export interface AliasEntry {
  alias: string;
  targetId: string;
}

export function aliasesApi(client: KanectaApiClient) {
  return {
    list: () => client.aliases.list(),

    listForItem: (targetId: string) => client.aliases.list(targetId),

    resolve: (alias: string) => client.aliases.resolve(alias),

    set: (alias: string, targetId: string) => client.aliases.set(alias, targetId),

    remove: (alias: string) => client.aliases.remove(alias),
  };
}
