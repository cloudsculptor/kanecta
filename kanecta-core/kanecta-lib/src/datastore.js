'use strict';

const {
  ROOT_ID, TYPES_NODE, WELL_KNOWN_TYPES, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE, DEFAULT_LICENSE,
} = require('@kanecta/sqlite-fs');

const datastoreUtils = require('@kanecta/datastore-utils');

class Datastore {
  constructor(adapter) {
    this._adapter = adapter;
  }

  // Filesystem-specific path properties (only valid in FILE mode).
  get root() { return this._adapter.root; }
  get k()    { return this._adapter.k; }

  get config() { return this._adapter.config; }

  static isDatastore(location) {
    return datastoreUtils.isDatastore(location);
  }

  // Open a cloud (Postgres + S3) datastore.
  // `cloudConfig` must have:
  //   { pg: { connectionString }, s3: { endpoint, accessKeyId, secretAccessKey, bucket },
  //     embeddings?: { provider, apiKey, model, dimensions } }
  // `embeddings` is optional — full-text search works without it; semantic
  // and hybrid search require a configured provider (see @kanecta/database's
  // embeddings.js for supported providers, e.g. 'voyage', and 'mock' for tests).
  static async openCloud(cloudConfig) {
    const adapter = await datastoreUtils.openCloudAdapter(cloudConfig);
    return new Datastore(adapter);
  }

  // Init a new cloud datastore (runs migrations, creates root nodes).
  static async initCloud(cloudConfig, owner) {
    const adapter = await datastoreUtils.createCloudAdapter(cloudConfig, owner);
    return new Datastore(adapter);
  }

  static init(location, owner, { items = 'FILE', files = 'FILE' } = {}) {
    if (items === 'REMOTE' || files === 'REMOTE') {
      throw new Error('Use Datastore.initCloud(cloudConfig, owner) for cloud mode.');
    }
    return new Datastore(datastoreUtils.createFilesystemAdapter(location, owner));
  }

  static open(location, { items = 'FILE', files = 'FILE' } = {}) {
    if (items === 'REMOTE' || files === 'REMOTE') {
      throw new Error('Use Datastore.openCloud(cloudConfig) for cloud mode.');
    }
    return new Datastore(datastoreUtils.openFilesystemAdapter(location));
  }

  // Open a datastore from a working-set config — see ~/.config/kanecta/config.json
  // `workingSets.<name>` shape. This is the single dispatch point so consumers
  // don't need to branch on the backend themselves.
  static async openWorkingSet(workingSet, { branch } = {}) {
    // 1.4.0 format: { local, remotes, defaultBranch }. `local` is a path string
    // or { type: 'filesystem', path }. `branch` (caller-resolved) selects the
    // active branch for THIS instance via useBranch — it is never persisted as a
    // shared default, so concurrent consumers stay independent.
    if (workingSet.local) {
      const localPath =
        typeof workingSet.local === 'string' ? workingSet.local : workingSet.local.path;
      const ds = Datastore.open(localPath);
      const target = branch || workingSet.defaultBranch || workingSet.branch;
      if (target) ds.useBranch(target);
      return ds;
    }
    // 1.3.x format: { mode, datastore, cloud }
    switch (workingSet.mode) {
      case 'FILESYSTEM':
        return Datastore.open(workingSet.datastore);
      case 'CLOUD':
        return Datastore.openCloud(workingSet.cloud);
      case 'DUAL_FILESYSTEM_PRIMARY':
      case 'DUAL_CLOUD_PRIMARY':
        throw new Error(`Working-set mode '${workingSet.mode}' is not yet implemented.`);
      default:
        throw new Error(`Unknown working-set mode: '${workingSet.mode}'`);
    }
  }

  // ─── Item CRUD ─────────────────────────────────────────────────────────────

  async create(opts)                         { return this._adapter.create(opts); }
  async get(id)                              { return this._adapter.get(id); }
  async update(id, changes, actor, opts)     { return this._adapter.update(id, changes, actor, opts); }
  async delete(id, actor)                    { return this._adapter.delete(id, actor); }
  async deleteWarnings(id)                   { return this._adapter.deleteWarnings(id); }
  async createType(value, opts)              { return this._adapter.createType(value, opts); }

  // ─── Aliases ───────────────────────────────────────────────────────────────

  async resolve(idOrAlias)                   { return this._adapter.resolve(idOrAlias); }
  async resolveAlias(alias)                  { return this._adapter.resolveAlias(alias); }
  async setAlias(alias, id)                  { return this._adapter.setAlias(alias, id); }
  async removeAlias(alias)                   { return this._adapter.removeAlias(alias); }
  async listAliases()                        { return this._adapter.listAliases(); }

  // ─── Annotations ───────────────────────────────────────────────────────────

  async annotate(targetId, opts)             { return this._adapter.annotate(targetId, opts); }
  async annotations(targetId)               { return this._adapter.annotations(targetId); }

  // ─── Relationships ─────────────────────────────────────────────────────────

  async relate(sourceId, type, targetId, opts) { return this._adapter.relate(sourceId, type, targetId, opts); }
  get relTypes()                             { return this._adapter.relTypes; }
  async addRelTypes(names)                   { return this._adapter.addRelTypes(names); }
  async relationships(id)                    { return this._adapter.relationships(id); }
  async backlinks(id)                        { return this._adapter.backlinks(id); }
  async listRelationships()                  { return this._adapter.listRelationships(); }

  // ─── History ───────────────────────────────────────────────────────────────

  async history(id)                          { return this._adapter.history(id); }

  // ─── Queries ───────────────────────────────────────────────────────────────

  async byTag(tag)                           { return this._adapter.byTag(tag); }
  async byType(typeId)                       { return this._adapter.byType(typeId); }
  async bySource(system, externalId)         { return this._adapter.bySource(system, externalId); }
  async query(opts)                          { return this._adapter.query(opts); }
  async resolveTypeId(name)                  { return this._adapter.resolveTypeId(name); }

  // ─── Tree ──────────────────────────────────────────────────────────────────

  async loadAll()                            { return this._adapter.loadAll(); }
  async children(parentId, aspect)           { return this._adapter.children(parentId, aspect); }
  async tree(rootId, maxDepth)               { return this._adapter.tree(rootId, maxDepth); }
  async getDocument(id)                      { return this._adapter.getDocument(id); }
  createDocument(targetId, name, opts)       { return this._adapter.createDocument(targetId, name, opts); }
  listDocuments(targetId)                    { return this._adapter.listDocuments(targetId); }
  readDocumentPayload(id)                    { return this._adapter.readDocumentPayload(id); }
  writeDocumentPayload(id, payload)          { return this._adapter.writeDocumentPayload(id, payload); }
  async readObjectJson(id)                   { return this._adapter.readObjectJson(id); }
  async writeObjectJson(id, data)            { return this._adapter.writeObjectJson(id, data); }
  async readFunctionJson(id)                 { return this._adapter.readFunctionJson(id); }
  async writeFunctionJson(id, data)          { return this._adapter.writeFunctionJson(id, data); }
  async readTypeJson(id)                     { return this._adapter.readTypeJson(id); }
  async writeTypeJson(id, data)              { return this._adapter.writeTypeJson(id, data); }
  async listTypeDefs()                       { return this._adapter._listTypeDefs(); }
  async getRoot()                            { return this._adapter.getRoot(); }

  // ─── File store ────────────────────────────────────────────────────────────

  async putFile(itemId, filename, body, opts)  { return this._adapter.putFile(itemId, filename, body, opts); }
  async getFile(itemId, filename)              { return this._adapter.getFile(itemId, filename); }
  async deleteFile(itemId, filename)           { return this._adapter.deleteFile(itemId, filename); }
  async listFiles(itemId)                      { return this._adapter.listFiles(itemId); }

  // ─── Index maintenance ─────────────────────────────────────────────────────

  async rebuildIndexes()                     { return this._adapter.rebuildIndexes(); }

  // ─── Integrity checks ────────────────────────────────────────────────────────

  async checkIntegrity(opts)                 { return this._adapter.checkIntegrity(opts); }

  // ─── Soft-delete lifecycle ────────────────────────────────────────────────────

  async softDelete(id, actor)                { return this._adapter.softDelete(id, actor); }
  async restore(id, actor)                   { return this._adapter.restore(id, actor); }

  // ─── Time section ─────────────────────────────────────────────────────────────

  async readTimeJson(id)                     { return this._adapter.readTimeJson(id); }
  async writeTimeJson(id, data)              { return this._adapter.writeTimeJson(id, data); }
  async deleteTimeJson(id)                   { return this._adapter.deleteTimeJson(id); }

  // ─── Branching ────────────────────────────────────────────────────────────────

  currentBranch()          { return this._adapter.currentBranch(); }
  // opts: { fill: 'full' | 'sparse', upstream: { branch } | { remote, branch } }
  createBranch(name, opts)  { return this._adapter.createBranch(name, opts); }
  switchBranch(name)       { return this._adapter.switchBranch(name); }
  useBranch(name)          { return this._adapter.useBranch(name); }
  listBranches()           { return this._adapter.listBranches(); }
  deleteBranch(name)       { return this._adapter.deleteBranch(name); }
  branchDiff(name)         { return this._adapter.branchDiff(name); }
  mergeBranchLocally(name) { return this._adapter.mergeBranchLocally(name); }
}

module.exports = { Datastore, ROOT_ID, TYPES_NODE, WELL_KNOWN_TYPES, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE, DEFAULT_LICENSE };
