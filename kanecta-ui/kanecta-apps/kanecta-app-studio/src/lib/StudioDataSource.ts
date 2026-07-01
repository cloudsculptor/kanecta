import type { DataSource, KanectaItem, QueryFilter } from '@kanecta/component-core';
import { createApi } from '../api';

type StudioApi = ReturnType<typeof createApi>;

export function createStudioDataSource(api: StudioApi): DataSource {
  return {
    async get(id) {
      // api.items.get already returns the flat read model.
      return api.items.get(id) as unknown as KanectaItem;
    },

    async query(filter: QueryFilter) {
      if (filter.parentId) {
        return api.items.children(filter.parentId) as Promise<KanectaItem[]>;
      }
      return api.items.list() as Promise<KanectaItem[]>;
    },

    async create(partial) {
      return api.items.create(partial as never) as Promise<KanectaItem>;
    },

    async update(id, patch) {
      if ('completedAt' in patch) {
        if (patch.completedAt) {
          return api.items.complete(id) as Promise<KanectaItem>;
        } else {
          return api.items.uncomplete(id) as Promise<KanectaItem>;
        }
      }
      return api.items.update(id, patch as never) as Promise<KanectaItem>;
    },

    async delete(id) {
      await api.items.delete(id);
    },
  };
}
