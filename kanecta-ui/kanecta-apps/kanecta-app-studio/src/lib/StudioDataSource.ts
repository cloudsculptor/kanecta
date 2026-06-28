import type { DataSource, KanectaItem, QueryFilter } from '@kanecta/component-core';
import type { KanectaItemDocument } from '@kanecta/api-client';
import { createApi } from '../api';

type StudioApi = ReturnType<typeof createApi>;

function docToFlat(doc: KanectaItemDocument): KanectaItem {
  return {
    id: doc.item.id,
    parentId: doc.item.parentId ?? undefined,
    type: doc.item.type as KanectaItem['type'],
    typeId: doc.item.typeId ?? undefined,
    value: doc.item.value ?? undefined,
    sortOrder: doc.item.sortOrder ?? 0,
    tags: doc.meta.tags ?? [],
    confidence: doc.meta.confidence ?? null,
    status: doc.meta.status ?? null,
    createdAt: doc.meta.createdAt,
    modifiedAt: doc.meta.modifiedAt,
    completedAt: doc.meta.completedAt ?? null,
    icon: doc.meta.icon ?? null,
    childCount: doc.childCount,
    _hasObject: doc._hasObject,
    _synthetic: doc._synthetic,
  } as KanectaItem;
}

export function createStudioDataSource(api: StudioApi): DataSource {
  return {
    async get(id) {
      const doc = await api.items.get(id) as unknown as KanectaItemDocument;
      return docToFlat(doc) as KanectaItem;
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
