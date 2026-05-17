'use strict';

// PostgresAdapter implements the Kanecta items adapter interface against a
// PostgreSQL database conforming to specification.db.postgres.md.
//
// Usage:
//   const adapter = await PostgresAdapter.init(pool, owner);
//   const adapter = await PostgresAdapter.open(pool);
//
// `pool` is a pg.Pool instance. The caller owns the pool lifecycle.

class PostgresAdapter {
  constructor(pool) {
    this._pool = pool;
    this._config = null;
  }

  // Create schema and well-known root nodes. Idempotent.
  static async init(pool, owner) {
    const adapter = new PostgresAdapter(pool);
    await adapter._migrate();
    await adapter._ensureConfig(owner);
    await adapter._initRoots();
    return adapter;
  }

  // Open an existing database. Throws if schema or config is missing.
  static async open(pool) {
    const adapter = new PostgresAdapter(pool);
    const cfg = await adapter._loadConfig();
    if (!cfg) throw new Error('Not a Kanecta database: config table missing or empty');
    adapter._config = cfg;
    return adapter;
  }

  get config() {
    if (!this._config) throw new Error('Adapter not initialised — call open() or init()');
    return this._config;
  }

  // ─── Migrations ────────────────────────────────────────────────────────────

  async _migrate() {
    const fs = require('fs');
    const path = require('path');
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await this._pool.query(sql);
    }
  }

  async _ensureConfig(owner) {
    await this._pool.query(`
      INSERT INTO config (key, value) VALUES ('owner', $1), ('spec_version', '1.2.0')
      ON CONFLICT (key) DO NOTHING
    `, [owner]);
    this._config = await this._loadConfig();
  }

  async _loadConfig() {
    try {
      const { rows } = await this._pool.query('SELECT key, value FROM config');
      if (!rows.length) return null;
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    } catch {
      return null;
    }
  }

  // ─── Well-known root nodes ─────────────────────────────────────────────────

  async _initRoots() {
    throw new Error('PostgresAdapter._initRoots() not yet implemented');
  }

  // ─── Item CRUD ─────────────────────────────────────────────────────────────

  async create(_opts) {
    throw new Error('PostgresAdapter.create() not yet implemented');
  }

  async get(_id) {
    throw new Error('PostgresAdapter.get() not yet implemented');
  }

  async update(_id, _changes, _actor) {
    throw new Error('PostgresAdapter.update() not yet implemented');
  }

  async delete(_id, _actor) {
    throw new Error('PostgresAdapter.delete() not yet implemented');
  }

  async deleteWarnings(_id) {
    throw new Error('PostgresAdapter.deleteWarnings() not yet implemented');
  }

  // ─── Aliases ───────────────────────────────────────────────────────────────

  async resolve(_idOrAlias) {
    throw new Error('PostgresAdapter.resolve() not yet implemented');
  }

  async resolveAlias(_alias) {
    throw new Error('PostgresAdapter.resolveAlias() not yet implemented');
  }

  async setAlias(_alias, _id) {
    throw new Error('PostgresAdapter.setAlias() not yet implemented');
  }

  async removeAlias(_alias) {
    throw new Error('PostgresAdapter.removeAlias() not yet implemented');
  }

  async listAliases() {
    throw new Error('PostgresAdapter.listAliases() not yet implemented');
  }

  // ─── Annotations ───────────────────────────────────────────────────────────

  async annotate(_targetId, _opts) {
    throw new Error('PostgresAdapter.annotate() not yet implemented');
  }

  async annotations(_targetId) {
    throw new Error('PostgresAdapter.annotations() not yet implemented');
  }

  // ─── Relationships ─────────────────────────────────────────────────────────

  async relate(_sourceId, _type, _targetId, _opts) {
    throw new Error('PostgresAdapter.relate() not yet implemented');
  }

  async relationships(_id) {
    throw new Error('PostgresAdapter.relationships() not yet implemented');
  }

  async backlinks(_id) {
    throw new Error('PostgresAdapter.backlinks() not yet implemented');
  }

  async listRelationships() {
    throw new Error('PostgresAdapter.listRelationships() not yet implemented');
  }

  // ─── History ───────────────────────────────────────────────────────────────

  async history(_id) {
    throw new Error('PostgresAdapter.history() not yet implemented');
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  async byTag(_tag) {
    throw new Error('PostgresAdapter.byTag() not yet implemented');
  }

  async byType(_typeId) {
    throw new Error('PostgresAdapter.byType() not yet implemented');
  }

  // ─── Tree ──────────────────────────────────────────────────────────────────

  async loadAll() {
    throw new Error('PostgresAdapter.loadAll() not yet implemented');
  }

  async children(_parentId) {
    throw new Error('PostgresAdapter.children() not yet implemented');
  }

  async tree(_rootId, _maxDepth) {
    throw new Error('PostgresAdapter.tree() not yet implemented');
  }

  async getRoot() {
    throw new Error('PostgresAdapter.getRoot() not yet implemented');
  }

  async getDataRoot() {
    throw new Error('PostgresAdapter.getDataRoot() not yet implemented');
  }

  // ─── Index maintenance ─────────────────────────────────────────────────────

  async rebuildIndexes() {
    throw new Error('PostgresAdapter.rebuildIndexes() not yet implemented');
  }
}

module.exports = { PostgresAdapter };
