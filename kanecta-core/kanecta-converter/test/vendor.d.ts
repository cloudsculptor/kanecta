// Minimal structural type declaration for `pg`, which ships no types and is not a
// converter dependency (the conversion logic never imports it — only the gated
// integration test in catalog-pg.test.ts does, via a runtime `import('pg')`).
// Everything hangs off `any` deliberately: the catalog row shapes are asserted
// against the typed CatalogRow interfaces in the reader, not here.
declare module 'pg' {
  export interface QueryResult<R = any> {
    rows: R[];
    rowCount: number;
    [key: string]: any;
  }
  export interface PoolClient {
    query(text: string, params?: any[]): Promise<QueryResult>;
    release(): void;
  }
  export class Pool {
    constructor(config?: any);
    query(text: string, params?: any[]): Promise<QueryResult>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
  const _default: { Pool: typeof Pool };
  export default _default;
}
