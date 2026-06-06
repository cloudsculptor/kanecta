'use strict';

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
  'getRoot', 'getDataRoot',
];

const FILE_METHODS = ['putFile', 'getFile', 'deleteFile', 'listFiles'];

class CloudAdapter {
  constructor({ items, files }) {
    this._items = items;
    this._files = files;
  }

  // `items` and `files` are already-initialised/opened adapter instances —
  // CloudAdapter only composes them, it doesn't manage their lifecycle.
  static async init({ items, files }) {
    return new CloudAdapter({ items, files });
  }

  static async open({ items, files }) {
    return new CloudAdapter({ items, files });
  }

  get config() { return this._items.config; }
}

for (const name of ITEM_METHODS) {
  CloudAdapter.prototype[name] = function (...args) { return this._items[name](...args); };
}

for (const name of FILE_METHODS) {
  CloudAdapter.prototype[name] = function (...args) { return this._files[name](...args); };
}

module.exports = { CloudAdapter };
