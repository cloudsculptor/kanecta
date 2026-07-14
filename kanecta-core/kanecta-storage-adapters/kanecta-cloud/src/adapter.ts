// CloudAdapter implements the Kanecta datastore adapter interface by composing
// an items adapter (@kanecta/database, backed by Postgres) and a files adapter
// (@kanecta/s3, backed by any S3-compatible store). It lets kanecta-lib treat
// "cloud" storage as a single adapter, the same shape as @kanecta/filesystem,
// even though items and files live in two different backends.
//
// Usage:
//   const adapter = await CloudAdapter.init({ items, files }, owner);
//   const adapter = await CloudAdapter.open({ items, files });
//
// `items` is a @kanecta/database adapter instance (items CRUD, aliases,
// annotations, relationships, history, types, queries — see PostgresAdapter).
// `files` is a @kanecta/s3 adapter instance (putFile/getFile/deleteFile/listFiles).
// The caller owns the lifecycle of both.

const ITEM_METHODS = [
  'create', 'get', 'update', 'delete', 'deleteWarnings', 'createType',
  'resolve', 'resolveAlias', 'setAlias', 'removeAlias', 'listAliases',
  'annotate', 'annotations',
  'relTypes', 'addRelTypes', 'relate', 'relationships', 'backlinks',
  'history', 'byTag', 'byType', 'listRelationships',
  'loadAll', 'children', 'tree', 'query', 'rebuildIndexes',
  'readObjectJson', 'writeObjectJson', 'readFunctionJson', 'writeFunctionJson',
  'readTypeJson', 'writeTypeJson', '_listTypeDefs',
  'getRoot', 'getDataRoot',
  'resolveTypeId', 'checkIntegrity', 'softDelete', 'restore',
  'readTimeJson', 'writeTimeJson', 'deleteTimeJson', 'transaction',
];

const FILE_METHODS = ['putFile', 'getFile', 'deleteFile', 'listFiles'];

interface AdapterPair {
  items: any;
  files: any;
}

// The item/file methods are attached to the prototype dynamically below, so
// expose them via an index signature (declaration-merged with the class).
export interface CloudAdapter {
  [method: string]: any;
}

export class CloudAdapter {
  private _items: any;
  private _files: any;

  constructor({ items, files }: AdapterPair) {
    this._items = items;
    this._files = files;
  }

  // `items` and `files` are already-initialised/opened adapter instances —
  // CloudAdapter only composes them, it doesn't manage their lifecycle.
  static async init({ items, files }: AdapterPair): Promise<CloudAdapter> {
    return new CloudAdapter({ items, files });
  }

  static async open({ items, files }: AdapterPair): Promise<CloudAdapter> {
    return new CloudAdapter({ items, files });
  }

  get config() { return this._items.config; }

  // Surface the items backend's Postgres pool so pool-based features on
  // kanecta-api (the GraphQL engine, the pg authz source) work uniformly on a
  // Postgres-backed cloud working set — not just on a direct pg adapter. Reads
  // through to the composed items adapter; undefined if items isn't pg-backed.
  get _pool() { return this._items?._pool; }
}

for (const name of ITEM_METHODS) {
  (CloudAdapter.prototype as any)[name] = function (this: any, ...args: any[]) { return this._items[name](...args); };
}

for (const name of FILE_METHODS) {
  (CloudAdapter.prototype as any)[name] = function (this: any, ...args: any[]) { return this._files[name](...args); };
}
