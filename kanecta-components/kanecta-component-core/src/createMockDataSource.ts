import type { DataSource } from './DataSource.js';
import type { KanectaItem, QueryFilter } from './types.js';

export function createMockDataSource(items: KanectaItem[]): DataSource {
  let store = [...items];

  function match(item: KanectaItem, filter: QueryFilter): boolean {
    if (filter.parentId !== undefined && item.parentId !== filter.parentId) return false;
    if (filter.type !== undefined && item.type !== filter.type) return false;
    if (filter.search !== undefined) {
      const q = filter.search.toLowerCase();
      if (!item.value.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  function nest(item: KanectaItem, depth: number): KanectaItem {
    if (depth <= 1) return item;
    const children = store.filter(i => i.parentId === item.id);
    if (children.length === 0) return item;
    return { ...item, childCount: children.length };
  }

  return {
    async get(id, options) {
      const item = store.find(i => i.id === id);
      if (!item) throw new Error(`Mock: item ${id} not found`);
      return nest(item, options?.depth ?? 1);
    },

    async query(filter) {
      return store.filter(i => match(i, filter));
    },

    async create(partial) {
      const item: KanectaItem = {
        id: crypto.randomUUID(),
        value: '',
        type: 'task',
        parentId: null,
        sortOrder: store.length,
        tags: [],
        confidence: null,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        ...partial,
      };
      store = [...store, item];
      return item;
    },

    async update(id, patch) {
      const idx = store.findIndex(i => i.id === id);
      if (idx === -1) throw new Error(`Mock: item ${id} not found`);
      const updated = { ...store[idx], ...patch, modifiedAt: new Date().toISOString() };
      store = [...store.slice(0, idx), updated, ...store.slice(idx + 1)];
      return updated;
    },

    async delete(id) {
      store = store.filter(i => i.id !== id);
    },
  };
}
