'use strict';

const {
  FilesystemAdapter,
  ROOT_ID, WELL_KNOWN_TYPES, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE,
} = require('@kanecta/filesystem');

class Datastore {
  constructor(adapter) {
    this._adapter = adapter;
  }

  // Filesystem-specific path properties (only valid in FILE mode).
  get root() { return this._adapter.root; }
  get k() { return this._adapter.k; }

  get config() { return this._adapter.config; }

  static isDatastore(location) {
    return FilesystemAdapter.isDatastore(location);
  }

  static init(location, owner, { items = 'FILE', files = 'FILE' } = {}) {
    if (items === 'REMOTE' || files === 'REMOTE') {
      throw new Error('REMOTE mode adapters are not yet installed. Set items and files to "FILE".');
    }
    return new Datastore(FilesystemAdapter.init(location, owner));
  }

  static open(location, { items = 'FILE', files = 'FILE' } = {}) {
    if (items === 'REMOTE' || files === 'REMOTE') {
      throw new Error('REMOTE mode adapters are not yet installed. Set items and files to "FILE".');
    }
    return new Datastore(FilesystemAdapter.open(location));
  }

  // ─── Item CRUD ─────────────────────────────────────────────────────────────

  create(opts)                         { return this._adapter.create(opts); }
  get(id)                              { return this._adapter.get(id); }
  update(id, changes, actor)           { return this._adapter.update(id, changes, actor); }
  delete(id, actor)                    { return this._adapter.delete(id, actor); }
  deleteWarnings(id)                   { return this._adapter.deleteWarnings(id); }
  createType(value, opts)              { return this._adapter.createType(value, opts); }

  // ─── Aliases ───────────────────────────────────────────────────────────────

  resolve(idOrAlias)                   { return this._adapter.resolve(idOrAlias); }
  resolveAlias(alias)                  { return this._adapter.resolveAlias(alias); }
  setAlias(alias, id)                  { return this._adapter.setAlias(alias, id); }
  removeAlias(alias)                   { return this._adapter.removeAlias(alias); }
  listAliases()                        { return this._adapter.listAliases(); }

  // ─── Annotations ───────────────────────────────────────────────────────────

  annotate(targetId, opts)             { return this._adapter.annotate(targetId, opts); }
  annotations(targetId)               { return this._adapter.annotations(targetId); }

  // ─── Relationships ─────────────────────────────────────────────────────────

  relate(sourceId, type, targetId, opts) { return this._adapter.relate(sourceId, type, targetId, opts); }
  get relTypes()                       { return this._adapter.relTypes; }
  addRelTypes(names)                   { return this._adapter.addRelTypes(names); }
  relationships(id)                    { return this._adapter.relationships(id); }
  backlinks(id)                        { return this._adapter.backlinks(id); }
  listRelationships()                  { return this._adapter.listRelationships(); }

  // ─── History ───────────────────────────────────────────────────────────────

  history(id)                          { return this._adapter.history(id); }

  // ─── Queries ───────────────────────────────────────────────────────────────

  byTag(tag)                           { return this._adapter.byTag(tag); }
  byType(typeId)                       { return this._adapter.byType(typeId); }
  query(opts)                          { return this._adapter.query(opts); }

  // ─── Tree ──────────────────────────────────────────────────────────────────

  loadAll()                            { return this._adapter.loadAll(); }
  children(parentId)                   { return this._adapter.children(parentId); }
  tree(rootId, maxDepth)               { return this._adapter.tree(rootId, maxDepth); }
  readObjectJson(id)                   { return this._adapter.readObjectJson(id); }
  writeObjectJson(id, data)            { return this._adapter.writeObjectJson(id, data); }
  readFunctionJson(id)                 { return this._adapter.readFunctionJson(id); }
  writeFunctionJson(id, data)          { return this._adapter.writeFunctionJson(id, data); }
  getRoot()                            { return this._adapter.getRoot(); }
  getDataRoot()                        { return this._adapter.getDataRoot(); }

  // ─── Index maintenance ─────────────────────────────────────────────────────

  rebuildIndexes()                     { return this._adapter.rebuildIndexes(); }
}

module.exports = { Datastore, ROOT_ID, WELL_KNOWN_TYPES, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE };
