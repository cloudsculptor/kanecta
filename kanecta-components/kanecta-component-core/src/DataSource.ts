import type { KanectaItem, QueryFilter } from './types.js';

export interface DataSource {
  get(id: string, options?: { depth?: number }): Promise<KanectaItem>;
  query(filter: QueryFilter): Promise<KanectaItem[]>;
  create(item: Partial<KanectaItem>): Promise<KanectaItem>;
  update(id: string, patch: Partial<KanectaItem>): Promise<KanectaItem>;
  delete(id: string): Promise<void>;
}
