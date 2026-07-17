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

// Every public capability of the composed items adapter must be listed here —
// a missing name means the method silently doesn't exist on a cloud working
// set ('this._items.x is not a function' at runtime). The parity test in
// tests/adapter.test.ts diffs this list against the Postgres adapter's public
// surface, so forgetting to extend it fails CI instead of production.
const ITEM_METHODS = [
  'create', 'get', 'update', 'delete', 'deleteWarnings', 'createType',
  'resolve', 'resolveAlias', 'setAlias', 'removeAlias', 'listAliases',
  'annotate', 'annotations',
  'addRelTypes', 'relate', 'unrelate', 'relationships', 'backlinks',
  'history', 'byTag', 'byType', 'bySource', 'listRelationships',
  'loadAll', 'children', 'tree', 'ancestors', 'subtreeCount', 'query', 'rebuildIndexes', 'rebuildPaths',
  'readObjectJson', 'writeObjectJson', 'readFunctionJson', 'writeFunctionJson',
  'readTypeJson', 'writeTypeJson', '_listTypeDefs',
  'readScheduleJson', 'writeScheduleJson', 'listDueSchedules',
  'getDocument', 'createDocument', 'readDocumentPayload', 'writeDocumentPayload', 'listDocuments',
  'listStubs', 'listDueForRefresh',
  'getRoot', 'getDataRoot',
  'resolveTypeId', 'checkIntegrity', 'softDelete', 'restore',
  'readTimeJson', 'writeTimeJson', 'deleteTimeJson', 'transaction',
  'recordActivity', 'activityFor', 'listActivity',
  'search', 'semanticSearch', 'hybridSearch', 'embedItem', 'processPendingEmbeddings',
  'createBranch', 'listBranches', 'getBranch', 'getBranchChanges',
  'applyBranchChanges', 'preFlightScan', 'mergeBranch', 'deleteBranch',
  'listProjectedRelations', 'graphNeighbors', 'countProjectedGraphEdges',
  'rebuildGraphProjection', 'dropGraphProjection',
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

  // Getter passthroughs — the dynamic method proxy below only covers
  // functions, so property-shaped surface reads through explicitly. relTypes
  // was previously (wrongly) in ITEM_METHODS: it is a GETTER on the Postgres
  // adapter, so the method proxy made `cloud.relTypes` a function and
  // `ds.relTypes.includes(...)` crashed on cloud working sets.
  get relTypes() { return this._items.relTypes; }
  get graphEnabled() { return this._items.graphEnabled; }
  get embeddingsEnabled() { return this._items.embeddingsEnabled; }
  get transactionMode() { return this._items.transactionMode; }

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
