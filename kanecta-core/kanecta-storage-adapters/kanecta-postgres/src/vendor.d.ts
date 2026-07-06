// Minimal structural type declarations for `pg`, which ships no types and has
// no @types/pg installed in this monorepo. Only the surface actually used by
// this adapter is modelled; everything hangs off `any` deliberately, since the
// query result shape is fully dynamic (arbitrary SQL → arbitrary rows).
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

  export class Client {
    constructor(config?: any);
    connect(): Promise<void>;
    query(text: string, params?: any[]): Promise<QueryResult>;
    end(): Promise<void>;
  }
}
