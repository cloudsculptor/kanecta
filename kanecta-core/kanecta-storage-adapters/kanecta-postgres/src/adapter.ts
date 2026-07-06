// PostgresAdapter — implements the Kanecta adapter interface against PostgreSQL.
// API is identical to FilesystemAdapter (same method names, same return shapes)
// but every method is async. Callers must await all calls.
//
// Usage:
//   const adapter = await PostgresAdapter.init(pool, owner);   // fresh DB
//   const adapter = await PostgresAdapter.open(pool);           // existing DB

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { version as specVersion } from '@kanecta/specification';
import { Pool } from 'pg';
import { createEmbeddingProvider, reciprocalRankFusion } from './embeddings';

const ROOT_ID         = '00000000-0000-0000-0000-000000000000';
const DEFAULT_LICENSE = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739';
const WELL_KNOWN_TYPES = new Set(['root']);
const WELL_KNOWN_ORDER: string[] = [];
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_RE  = /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi;

// Built-in rel types seeded in migration 018 — also the fallback before the
// rel_types table exists (migration safety).
const BUILT_IN_REL_TYPES = [
  'relates-to', 'depends-on', 'enables', 'contradicts',
  'blocks', 'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes',
];

// All built-in type names (primitive + structured + well-known). Used by
// resolveTypeId() to distinguish items that don't need a registered type
// definition from custom user-defined types.
const BUILT_IN_TYPES = new Set([
  // Primitive value types
  'string', 'number', 'text', 'heading', 'url', 'image', 'markdown',
  // Structured built-in types
  'object', 'file', 'function', 'runner', 'symlink',
  'action', 'activity', 'agent', 'alias', 'annotation', 'aspect-type',
  'cell', 'component', 'connector', 'context', 'eval', 'eval-run',
  'document', 'formula', 'grant', 'grid', 'item_history', 'pipeline', 'pipeline-run',
  'query', 'reference', 'relationship', 'relationship-type', 'subscription',
  'tree', 'node', 'view', 'type',
  // Well-known root types
  'root',
]);

// Keep the old export name for backward compatibility.
const PRIMITIVE_TYPES = BUILT_IN_TYPES;
const VALID_REL_TYPES = BUILT_IN_REL_TYPES;

class UnknownTypeError extends Error {
  code: string;
  typeName: string;

  constructor(typeName: string) {
    super(`unknown type "${typeName}" — not a registered type definition`);
    this.name = 'UnknownTypeError';
    this.code = 'UNKNOWN_TYPE';
    this.typeName = typeName;
  }
}

// ─── Row → item shape ─────────────────────────────────────────────────────────

function rowToItem(row: any): any {
  if (!row) return null;
  return {
    id:           row.id,
    specVersion:  row.spec_version,
    parentId:     row.parent_id,
    value:        row.value,
    type:         row.type,
    typeId:       row.type_id,
    owner:        row.owner,
    license:      row.license,
    sortOrder:    row.sort_order,
    confidence:   row.confidence,
    status:       row.status,
    tags:         row.tags ?? [],
    createdAt:    row.created_at?.toISOString() ?? null,
    modifiedAt:   row.modified_at?.toISOString() ?? null,
    createdBy:    row.created_by,
    modifiedBy:   row.modified_by,
    cachedAt:     row.cached_at?.toISOString() ?? null,
    expiresAt:    row.expires_at?.toISOString() ?? null,
    deletedAt:    row.deleted_at?.toISOString() ?? null,
    connectorId:       row.connector_id ?? null,
    materialized:      row.materialized ?? null,
    completedAt:       row.completed_at?.toISOString() ?? null,
    dueAt:             row.due_at?.toISOString() ?? null,
    visibility:        row.visibility ?? 'private',
    aspect:            row.aspect ?? null,
    sourceSystem:      row.source_system ?? null,
    sourceExternalId:  row.source_external_id ?? null,
  };
}

function parseLinks(value: any): string[] {
  if (!value || typeof value !== 'string') return [];
  const links = new Set<string>();
  let m;
  const re = new RegExp(LINK_RE.source, 'gi');
  while ((m = re.exec(value)) !== null) links.add(m[1]);
  return [...links];
}

function objTableName(typeId: string): string {
  return `obj_${typeId.replace(/-/g, '_')}`;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

class PostgresAdapter {
  _pool: Pool;
  _config: any;
  _relTypesCache: string[] | null;
  _embeddingProvider: any;
  _embeddingsEnabled: boolean;

  constructor(pool: Pool, { embeddings = null }: any = {}) {
    this._pool              = pool;
    this._config            = null;
    this._relTypesCache     = null;
    this._embeddingProvider = createEmbeddingProvider(embeddings);
    this._embeddingsEnabled = embeddings?.enabled !== false;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  static async init(pool: Pool, owner: any, { embeddings = null }: any = {}) {
    const adapter = new PostgresAdapter(pool, { embeddings });
    await adapter._migrate();
    await adapter._ensureConfig(owner);
    await adapter._initRoots();
    await adapter._loadRelTypes();
    if (adapter._embeddingProvider) await adapter._ensureEmbeddingTable();
    return adapter;
  }

  static async open(pool: Pool, { embeddings = null }: any = {}) {
    const adapter = new PostgresAdapter(pool, { embeddings });
    const cfg = await adapter._loadConfig();
    if (!cfg) throw new Error('Not a Kanecta database: config missing or empty');
    adapter._config = cfg;
    await adapter._loadRelTypes();
    if (adapter._embeddingProvider) await adapter._ensureEmbeddingTable();
    return adapter;
  }

  get config() {
    if (!this._config) throw new Error('Adapter not initialised — call open() or init()');
    return this._config;
  }

  get relTypes() {
    return this._relTypesCache ?? [...BUILT_IN_REL_TYPES];
  }

  // ─── Migrations ─────────────────────────────────────────────────────────────

  async _migrate() {
    const dir  = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

    // Migrations are forward-only and run exactly once, in filename order. A
    // ledger records what's been applied so reopening a datastore does not
    // re-run (and fail on) non-idempotent statements like ADD CONSTRAINT.
    await this._pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );

    // Baseline: a schema that was already migrated before this ledger existed
    // (items table present, no ledger rows) is recorded as fully applied so we
    // never re-run migrations against a live database.
    const { rows: count } = await this._pool.query('SELECT COUNT(*)::int AS n FROM schema_migrations');
    if (count[0].n === 0) {
      const { rows: has } = await this._pool.query("SELECT to_regclass('items') IS NOT NULL AS has_items");
      if (has[0].has_items) {
        for (const file of files) {
          await this._pool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        }
        return;
      }
    }

    const { rows } = await this._pool.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map(r => r.filename));
    for (const file of files) {
      if (applied.has(file)) continue;
      await this._pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await this._pool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
    }
  }

  async _ensureConfig(owner: any) {
    await this._pool.query(
      `INSERT INTO config (key, value) VALUES ('owner', $1), ('spec_version', '1.4.0')
       ON CONFLICT (key) DO NOTHING`,
      [owner],
    );
    this._config = await this._loadConfig();
  }

  async _loadConfig() {
    try {
      const { rows } = await this._pool.query('SELECT key, value FROM config');
      if (!rows.length) return null;
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    } catch { return null; }
  }

  // ─── Relationship types ──────────────────────────────────────────────────────

  async _loadRelTypes() {
    try {
      const { rows } = await this._pool.query('SELECT type FROM rel_types ORDER BY type');
      this._relTypesCache = rows.map(r => r.type);
    } catch {
      this._relTypesCache = [...BUILT_IN_REL_TYPES];
    }
  }

  async addRelTypes(names: any) {
    const invalid = names.filter((n: any) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(n));
    if (invalid.length)
      throw new Error(`Invalid relationship type name(s): ${invalid.join(', ')} — must be lowercase kebab-case starting with a letter`);
    for (const name of names) {
      await this._pool.query(
        'INSERT INTO rel_types (type) VALUES ($1) ON CONFLICT DO NOTHING', [name],
      );
    }
    await this._loadRelTypes();
  }

  // ─── Well-known root nodes ───────────────────────────────────────────────────

  async _initRoots() {
    const existing = await this.get(ROOT_ID);
    if (!existing) await this._createWellKnownNode(ROOT_ID, ROOT_ID, 'root', 0);
    const children = await this.children(ROOT_ID);
    const existingTypes = new Set(children.map((c: any) => c.type));
    for (let i = 0; i < WELL_KNOWN_ORDER.length; i++) {
      const type = WELL_KNOWN_ORDER[i];
      if (!existingTypes.has(type)) {
        await this._createWellKnownNode(crypto.randomUUID(), ROOT_ID, type, i);
      }
    }
  }

  async _createWellKnownNode(id: any, parentId: any, type: any, sortOrder: any) {
    const now    = new Date();
    const owner  = this.config.owner;
    const value  = type;
    // Compute path: root is self-referencing, so its path = id; others get parent path prefix.
    let path;
    if (id === parentId) {
      path = id;
    } else {
      const parentPath = await this._getPath(parentId);
      path = parentPath != null ? `${parentPath}/${id}` : id;
    }
    await this._pool.query(
      `INSERT INTO items (id, spec_version, parent_id, path, value, type, owner, license, sort_order,
         created_at, modified_at, created_by, modified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$7,$7)
       ON CONFLICT (id) DO NOTHING`,
      [id, specVersion, parentId, path, value, type, owner, DEFAULT_LICENSE, sortOrder, now],
    );
    await this._snapshot(id, 'create', owner, now);
    return this.get(id);
  }

  async getRoot()     { return this._getByType('root'); }

  async _getByType(type: any) {
    const { rows } = await this._pool.query(
      'SELECT * FROM items WHERE type = $1 LIMIT 1', [type],
    );
    return rowToItem(rows[0] ?? null);
  }

  _assertEditable(item: any, id: any) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID)
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be modified`);
  }

  _assertDeletable(item: any, id: any) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID)
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be deleted`);
  }

  // ─── Materialized path ───────────────────────────────────────────────────────

  async _getPath(id: any) {
    if (!id) return null;
    const { rows } = await this._pool.query('SELECT path FROM items WHERE id = $1', [id]);
    return rows[0]?.path ?? null;
  }

  _pathDepth(path: any) {
    if (!path) return 0;
    return (path.match(/\//g) || []).length;
  }

  async _cascadePathUpdate(id: any, newPath: any) {
    const oldPath = await this._getPath(id);
    await this._pool.query('UPDATE items SET path = $1 WHERE id = $2', [newPath, id]);
    if (oldPath) {
      const oldPrefix = oldPath + '/';
      // Update all descendants whose path starts with the old prefix.
      // SUBSTRING(path FROM length) extracts the part after the old prefix.
      await this._pool.query(
        // $2::int forces SUBSTRING's positional form; without the cast an
        // untyped parameter is treated as the regex-pattern form and returns
        // null, wiping every descendant's path.
        `UPDATE items
         SET path = $1 || '/' || SUBSTRING(path FROM $2::int)
         WHERE path LIKE $3 AND id != $4`,
        [newPath, oldPrefix.length + 1, oldPrefix + '%', id],
      );
    }
  }

  // ─── History ────────────────────────────────────────────────────────────────

  async _snapshot(idOrItem: any, changeType: any, changedBy: any, now?: any) {
    const item = typeof idOrItem === 'string' ? await this.get(idOrItem) : idOrItem;
    if (!item) return;
    await this._pool.query(
      `INSERT INTO history (id, item_id, snapshot, snapshot_at, changed_by, change_type)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), item.id, JSON.stringify(item), now ?? new Date(), changedBy, changeType],
    );
  }

  // ─── Item CRUD ───────────────────────────────────────────────────────────────

  async get(id: any) {
    const { rows } = await this._pool.query('SELECT * FROM items WHERE id = $1', [id]);
    return rowToItem(rows[0] ?? null);
  }

  async _typeDefExists(typeId: any) {
    if (!typeId) return false;
    const { rows } = await this._pool.query(
      `SELECT 1 FROM items WHERE id = $1 AND type = 'type' LIMIT 1`, [typeId],
    );
    return rows.length > 0;
  }

  _guardTypeIdRef(typeId: any, strict: any) {
    const effectiveStrict = strict !== undefined ? !!strict : !!this.config.strictTypeIds;
    if (effectiveStrict) {
      const err: any = new Error(`unknown typeId "${typeId}" — no registered type definition`);
      err.name = 'UnknownTypeError';
      err.code = 'UNKNOWN_TYPE';
      err.typeId = typeId;
      throw err;
    }
    return `typeId ${typeId} has no type definition — node written anyway; run \`kanecta doctor\``;
  }

  async create({
    parentId, value = null, type = 'string', typeId = null,
    owner, license = null, sortOrder, confidence = null, status = null,
    tags = [], createdBy, objectData = null, dueAt = null, aspect = null,
    expiresAt = null, connectorId = null, materialized = null, cachedAt = null,
    sourceSystem = null, sourceExternalId = null,
    strict,
  }: any = {}) {
    if (WELL_KNOWN_TYPES.has(type))
      throw new Error(`Type '${type}' is well-known and cannot be created via create()`);

    let typeWarning: any = null;
    if (type === 'object' && typeId && !(await this._typeDefExists(typeId))) {
      typeWarning = this._guardTypeIdRef(typeId, strict);
    }

    if (parentId == null) {
      parentId = ROOT_ID;
    }

    const id       = crypto.randomUUID();
    const now      = new Date();
    const ownerVal = owner || this.config.owner;
    const actor    = createdBy || ownerVal;

    if (sortOrder == null) {
      const siblings = await this.children(parentId);
      sortOrder = siblings.length === 0 ? 0 : Math.max(...siblings.map((s: any) => s.sortOrder)) + 1;
    }

    // Compute materialized path
    const parentPath = parentId ? await this._getPath(parentId) : null;
    const itemPath   = parentPath != null ? `${parentPath}/${id}` : id;

    await this._pool.query(
      `INSERT INTO items
         (id, spec_version, parent_id, path, value, type, type_id, owner, license, sort_order,
          confidence, status, tags, created_at, modified_at, created_by, modified_by,
          due_at, visibility, aspect, expires_at, connector_id, materialized, cached_at,
          source_system, source_external_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$15,$16,'private',$17,$18,$19,$20,$21,$22,$23)`,
      [
        id, specVersion, parentId, itemPath, value,
        type, type === 'object' ? typeId : null,
        ownerVal, license ?? DEFAULT_LICENSE,
        sortOrder, confidence, status, tags,
        now, actor, dueAt, aspect,
        expiresAt, connectorId, materialized, cachedAt,
        sourceSystem, sourceExternalId,
      ],
    );

    for (const link of parseLinks(value)) {
      await this._pool.query(
        'INSERT INTO links (source_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [id, link],
      );
    }

    if (objectData && type === 'object' && typeId) {
      await this.writeObjectJson(id, typeId, objectData);
    }

    const item = await this.get(id);
    await this._snapshot(item, 'create', actor, now);
    if (typeWarning) {
      Object.defineProperty(item, 'warning', { value: typeWarning, enumerable: false, configurable: true });
    }
    return item;
  }

  async update(id: any, changes: any, actor?: any, { strict }: any = {}) {
    const current = await this.get(id);
    this._assertEditable(current, id);

    const newType   = 'type'   in changes ? changes.type   : current.type;
    const newTypeId = 'typeId' in changes ? changes.typeId : current.typeId;
    let typeWarning: any = null;
    if (newType === 'object' && newTypeId && newTypeId !== current.typeId
        && !(await this._typeDefExists(newTypeId))) {
      typeWarning = this._guardTypeIdRef(newTypeId, strict);
    }

    actor = actor || this.config.owner;
    const now = new Date();
    await this._snapshot(current, 'update', actor, now);

    const sets:   any[] = [];
    const params: any[] = [];
    let   p      = 1;

    const maybeSet = (col: any, val: any) => { sets.push(`${col} = $${p++}`); params.push(val); };

    if ('value' in changes) {
      const oldLinks = parseLinks(current.value);
      const newLinks = parseLinks(changes.value);
      for (const l of oldLinks) if (!newLinks.includes(l))
        await this._pool.query('DELETE FROM links WHERE source_id=$1 AND target_id=$2', [id, l]);
      for (const l of newLinks) if (!oldLinks.includes(l))
        await this._pool.query('INSERT INTO links (source_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, l]);
      maybeSet('value', changes.value);
    }

    if ('type' in changes)        maybeSet('type',         changes.type);
    if ('typeId' in changes)      maybeSet('type_id',      changes.typeId);
    if ('sortOrder' in changes)   maybeSet('sort_order',   changes.sortOrder);
    if ('confidence' in changes)  maybeSet('confidence',   changes.confidence);
    if ('status' in changes)      maybeSet('status',       changes.status);
    if ('license' in changes)     maybeSet('license',      changes.license);
    if ('completedAt' in changes) maybeSet('completed_at', changes.completedAt);
    if ('dueAt' in changes)       maybeSet('due_at',       changes.dueAt);
    if ('visibility' in changes)  maybeSet('visibility',   changes.visibility);
    if ('aspect' in changes)      maybeSet('aspect',       changes.aspect);
    if ('tags' in changes)        maybeSet('tags',         changes.tags);
    if ('expiresAt' in changes)   maybeSet('expires_at',   changes.expiresAt);
    if ('deletedAt' in changes)   maybeSet('deleted_at',   changes.deletedAt);
    if ('connectorId' in changes)       maybeSet('connector_id',       changes.connectorId);
    if ('materialized' in changes)      maybeSet('materialized',       changes.materialized);
    if ('cachedAt' in changes)          maybeSet('cached_at',          changes.cachedAt);
    if ('sourceSystem' in changes)      maybeSet('source_system',      changes.sourceSystem);
    if ('sourceExternalId' in changes)  maybeSet('source_external_id', changes.sourceExternalId);

    // Cascade path when parentId changes
    if ('parentId' in changes && changes.parentId !== current.parentId) {
      const parentPath = await this._getPath(changes.parentId);
      const newPath    = parentPath != null ? `${parentPath}/${id}` : id;
      await this._cascadePathUpdate(id, newPath);
      maybeSet('parent_id', changes.parentId);
    }

    maybeSet('modified_at', now);
    maybeSet('modified_by', actor);

    if (sets.length) {
      await this._pool.query(
        `UPDATE items SET ${sets.join(', ')} WHERE id = $${p}`,
        [...params, id],
      );
    }

    const result = await this.get(id);
    if (typeWarning && result) {
      Object.defineProperty(result, 'warning', { value: typeWarning, enumerable: false, configurable: true });
    }
    return result;
  }

  async deleteWarnings(id: any) {
    const { rows: linkRows } = await this._pool.query(
      'SELECT COUNT(*) FROM links WHERE target_id = $1', [id],
    );
    const { rows: relRows } = await this._pool.query(
      'SELECT COUNT(*) FROM relationships WHERE target_id = $1', [id],
    );
    const warnings = [];
    if (parseInt(linkRows[0].count) > 0)
      warnings.push(`${linkRows[0].count} item(s) link to this via [[uuid]] syntax`);
    if (parseInt(relRows[0].count) > 0)
      warnings.push(`${relRows[0].count} inbound relationship(s) point to this item`);
    return warnings;
  }

  async delete(id: any, actor?: any) {
    const item = await this.get(id);
    this._assertDeletable(item, id);
    actor = actor || this.config.owner;
    const now = new Date();
    const warnings = await this.deleteWarnings(id);
    await this._snapshot(item, 'delete', actor, now);
    await this._pool.query('DELETE FROM aliases WHERE target_id = $1', [id]);
    // Derived backlink rows reference items via FK in both directions — clear
    // them before removing the item.
    await this._pool.query('DELETE FROM links WHERE source_id = $1 OR target_id = $1', [id]);
    await this._pool.query('DELETE FROM items WHERE id = $1', [id]);
    return { warnings };
  }

  // ─── Soft delete / restore ───────────────────────────────────────────────────

  async softDelete(id: any, actor?: any) {
    const item = await this.get(id);
    if (!item) throw new Error(`Item not found: ${id}`);
    this._assertDeletable(item, id);
    actor = actor || this.config.owner;
    const now = new Date();
    await this._snapshot(item, 'soft-delete', actor, now);
    await this._pool.query(
      'UPDATE items SET deleted_at = $1, modified_at = $1, modified_by = $2 WHERE id = $3',
      [now, actor, id],
    );
    return this.get(id);
  }

  async restore(id: any, actor?: any) {
    const item = await this.get(id);
    if (!item) throw new Error(`Item not found: ${id}`);
    actor = actor || this.config.owner;
    const now = new Date();
    await this._snapshot(item, 'restore', actor, now);
    await this._pool.query(
      'UPDATE items SET deleted_at = NULL, modified_at = $1, modified_by = $2 WHERE id = $3',
      [now, actor, id],
    );
    return this.get(id);
  }

  // ─── Aliases ─────────────────────────────────────────────────────────────────

  async resolveAlias(alias: any) {
    const { rows } = await this._pool.query(
      'SELECT target_id FROM aliases WHERE alias = $1', [alias.toLowerCase()],
    );
    return rows[0]?.target_id ?? null;
  }

  async resolve(idOrAlias: any) {
    if (UUID_RE.test(idOrAlias)) return this.get(idOrAlias);
    const id = await this.resolveAlias(idOrAlias);
    return id ? this.get(id) : null;
  }

  async setAlias(alias: any, id: any) {
    await this._pool.query(
      'INSERT INTO aliases (alias, target_id) VALUES ($1,$2) ON CONFLICT (alias) DO UPDATE SET target_id = $2',
      [alias.toLowerCase(), id],
    );
  }

  async removeAlias(alias: any) {
    await this._pool.query('DELETE FROM aliases WHERE alias = $1', [alias.toLowerCase()]);
  }

  async listAliases() {
    const { rows } = await this._pool.query('SELECT alias, target_id FROM aliases ORDER BY alias');
    return rows.map(r => ({ alias: r.alias, targetId: r.target_id }));
  }

  // ─── Annotations ─────────────────────────────────────────────────────────────

  async annotate(targetId: any, { author, content, parentAnnotationId = null }: any = {}) {
    const id  = crypto.randomUUID();
    const now = new Date();
    await this._pool.query(
      `INSERT INTO annotations (id, target_id, author, content, created_at, parent_annotation_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, targetId, author || this.config.owner, content, now, parentAnnotationId],
    );
    return { id, targetId, author: author || this.config.owner, content, createdAt: now.toISOString(), parentAnnotationId };
  }

  async annotations(targetId: any) {
    const { rows } = await this._pool.query(
      `SELECT * FROM annotations WHERE target_id = $1 ORDER BY created_at, id`,
      [targetId],
    );
    return rows.map(r => ({
      id:                 r.id,
      targetId:           r.target_id,
      author:             r.author,
      content:            r.content,
      createdAt:          r.created_at?.toISOString(),
      parentAnnotationId: r.parent_annotation_id,
    }));
  }

  // ─── Relationships ────────────────────────────────────────────────────────────

  async relate(sourceId: any, type: any, targetId: any, { createdBy, note = null }: any = {}) {
    const validTypes = this._relTypesCache ?? BUILT_IN_REL_TYPES;
    if (!validTypes.includes(type))
      throw new Error(`Invalid relationship type: ${type}. Valid: ${validTypes.join(', ')}`);
    const id    = crypto.randomUUID();
    const now   = new Date();
    const actor = createdBy || this.config.owner;
    await this._pool.query(
      `INSERT INTO relationships (id, source_id, target_id, type, created_at, created_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, sourceId, targetId, type, now, actor, note],
    );
    return { id, sourceId, targetId, type, createdAt: now.toISOString(), createdBy: actor, note };
  }

  async relationships(id: any) {
    const { rows: out } = await this._pool.query(
      `SELECT * FROM relationships WHERE source_id = $1 ORDER BY created_at`, [id],
    );
    const { rows: inn } = await this._pool.query(
      `SELECT * FROM relationships WHERE target_id = $1 ORDER BY created_at`, [id],
    );
    return {
      outbound: out.map(r => ({ id: r.id, targetId: r.target_id, type: r.type, createdAt: r.created_at?.toISOString(), createdBy: r.created_by, note: r.note })),
      inbound:  inn.map(r => ({ id: r.id, sourceId: r.source_id, type: r.type, createdAt: r.created_at?.toISOString(), createdBy: r.created_by, note: r.note })),
    };
  }

  async backlinks(id: any) {
    const { rows } = await this._pool.query(
      'SELECT source_id FROM links WHERE target_id = $1', [id],
    );
    return rows.map(r => r.source_id);
  }

  async listRelationships() {
    const { rows } = await this._pool.query('SELECT * FROM relationships ORDER BY created_at');
    return rows.map(r => ({
      id: r.id, sourceId: r.source_id, targetId: r.target_id,
      type: r.type, createdAt: r.created_at?.toISOString(), createdBy: r.created_by, note: r.note,
    }));
  }

  // ─── History ─────────────────────────────────────────────────────────────────

  async history(id: any) {
    const { rows } = await this._pool.query(
      `SELECT * FROM history WHERE item_id = $1 ORDER BY snapshot_at`, [id],
    );
    return rows.map(r => ({
      ...r.snapshot,
      snapshotAt: r.snapshot_at?.toISOString(),
      changedBy:  r.changed_by,
      changeType: r.change_type,
    }));
  }

  // ─── Tree / navigation ───────────────────────────────────────────────────────

  async children(parentId: any, aspect: any = undefined) {
    if (aspect === undefined) {
      // No aspect filter: return all children (aspect IS NULL)
      const { rows } = await this._pool.query(
        `SELECT * FROM items WHERE parent_id = $1 AND id != $1 AND aspect IS NULL
         ORDER BY sort_order`,
        [parentId],
      );
      return rows.map(rowToItem);
    }
    if (aspect === null) {
      // Explicit null: only items with no aspect (same as above for normal use)
      const { rows } = await this._pool.query(
        `SELECT * FROM items WHERE parent_id = $1 AND id != $1 AND aspect IS NULL
         ORDER BY sort_order`,
        [parentId],
      );
      return rows.map(rowToItem);
    }
    // Named aspect filter
    const { rows } = await this._pool.query(
      `SELECT * FROM items WHERE parent_id = $1 AND id != $1 AND aspect = $2
       ORDER BY sort_order`,
      [parentId, aspect],
    );
    return rows.map(rowToItem);
  }

  async ancestors(id: any) {
    const { rows } = await this._pool.query('SELECT path FROM items WHERE id = $1', [id]);
    if (!rows.length || !rows[0].path) return [];
    const segments    = rows[0].path.split('/');
    const ancestorIds = segments.slice(0, -1);
    if (!ancestorIds.length) return [];
    const placeholders = ancestorIds.map((_: any, i: number) => `$${i + 1}`).join(', ');
    const { rows: aRows } = await this._pool.query(
      `SELECT * FROM items WHERE id IN (${placeholders})`, ancestorIds,
    );
    const byId = new Map(aRows.map(r => [r.id, rowToItem(r)]));
    return ancestorIds.map((aid: any) => byId.get(aid)).filter(Boolean);
  }

  async subtreeCount(rootId: any) {
    const { rows } = await this._pool.query('SELECT path FROM items WHERE id = $1', [rootId]);
    if (!rows.length || !rows[0].path) return 0;
    const rootPath = rows[0].path;
    const { rows: cnt } = await this._pool.query(
      'SELECT COUNT(*) AS n FROM items WHERE path = $1 OR path LIKE $2',
      [rootPath, rootPath + '/%'],
    );
    return parseInt(cnt[0].n) || 0;
  }

  async tree(rootId: any, maxDepth: any = Infinity) {
    if (!rootId) {
      rootId = ROOT_ID;
    }

    const { rows: rootRows } = await this._pool.query(
      'SELECT path FROM items WHERE id = $1', [rootId],
    );
    if (!rootRows.length) return [];

    const rootPath = rootRows[0].path;

    // Fall back to recursive CTE if path not populated (migration safety).
    if (!rootPath) return this._treeSlow(rootId, maxDepth);

    const rootDepth = this._pathDepth(rootPath);
    let rows;

    if (maxDepth === Infinity) {
      const { rows: r } = await this._pool.query(
        `SELECT * FROM items WHERE path = $1 OR path LIKE $2 ORDER BY path`,
        [rootPath, rootPath + '/%'],
      );
      rows = r;
    } else {
      const maxSlashes = rootDepth + maxDepth;
      const { rows: r } = await this._pool.query(
        `SELECT * FROM items
         WHERE (path = $1 OR path LIKE $2)
           AND (LENGTH(path) - LENGTH(REPLACE(path, '/', ''))) <= $3
         ORDER BY path`,
        [rootPath, rootPath + '/%', maxSlashes],
      );
      rows = r;
    }

    const items   = rows.map(rowToItem);
    const pathMap = new Map(rows.map(r => [r.id, r.path]));

    // Build parent→children map and DFS-traverse for deterministic order.
    const byParent = new Map<any, any>();
    for (const item of items) {
      if (item.id === item.parentId) continue; // root is self-parented — never nest it under itself
      const pid = item.parentId;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(item);
    }
    for (const children of byParent.values()) {
      children.sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    }

    const itemById = new Map(items.map(item => [item.id, item]));
    const result: any[] = [];
    const visit    = (id: any, depth: any) => {
      const item = itemById.get(id);
      if (item) result.push({ item, depth });
      for (const child of (byParent.get(id) || [])) visit(child.id, depth + 1);
    };
    visit(rootId, 0);
    return result;
  }

  async _treeSlow(rootId: any, maxDepth: any = Infinity) {
    const depthLimit = Number.isFinite(maxDepth) ? maxDepth : 100;
    const { rows } = await this._pool.query(
      `WITH RECURSIVE subtree AS (
         SELECT *, 0 AS depth FROM items WHERE id = $1
         UNION ALL
         SELECT i.*, s.depth + 1
         FROM items i
         JOIN subtree s ON i.parent_id = s.id AND i.id != i.parent_id
         WHERE s.depth < $2
       )
       SELECT * FROM subtree ORDER BY depth, sort_order`,
      [rootId, depthLimit],
    );
    return rows.map(r => ({ item: rowToItem(r), depth: r.depth }));
  }

  // ─── Queries ──────────────────────────────────────────────────────────────────

  async byTag(tag: any) {
    const { rows } = await this._pool.query(
      'SELECT id FROM items WHERE $1 = ANY(tags)', [tag],
    );
    return rows.map(r => r.id);
  }

  async byType(typeId: any) {
    const { rows } = await this._pool.query(
      'SELECT id FROM items WHERE type_id = $1', [typeId],
    );
    return rows.map(r => r.id);
  }

  // Look up a single item by its external-source key. (source_system,
  // source_external_id) is UNIQUE (migration 020), so this is the idempotency
  // primitive for ingestion — the Postgres peer of the filesystem adapter's
  // bySource: upsert = bySource() ? update() : create(). Returns the read-model
  // item or null.
  async bySource(sourceSystem: any, sourceExternalId: any) {
    if (!sourceSystem || !sourceExternalId) return null;
    const { rows } = await this._pool.query(
      'SELECT * FROM items WHERE source_system = $1 AND source_external_id = $2 LIMIT 1',
      [sourceSystem, sourceExternalId],
    );
    return rows.length ? rowToItem(rows[0]) : null;
  }

  async loadAll() {
    const { rows } = await this._pool.query('SELECT * FROM items ORDER BY sort_order');
    return rows.map(rowToItem);
  }

  async resolveTypeId(name: any) {
    if (!name) return { unknown: true };
    if (BUILT_IN_TYPES.has(name)) return { primitive: true };
    const { rows } = await this._pool.query(
      `SELECT id FROM items WHERE value = $1 AND type = 'type' LIMIT 1`, [name],
    );
    if (rows.length) return { id: rows[0].id };
    return { unknown: true };
  }

  async query({
    type, where, rootId, sort, limit,
    strictTypes, includeDeleted, expiredOnly, excludeExpired,
  }: any = {}) {
    const conditions = [];
    const params     = [];
    let   p          = 1;
    let   typeWarning: any = null;

    if (type) {
      const resolved = await this.resolveTypeId(type);
      if ((resolved as any).unknown) {
        if (strictTypes) throw new UnknownTypeError(type);
        typeWarning = `unknown type "${type}" — not a registered type definition; run \`kanecta doctor\``;
      }
    }

    // Soft-delete filter
    if (!includeDeleted) conditions.push('deleted_at IS NULL');

    // Expiry filters
    if (expiredOnly) {
      conditions.push(`expires_at IS NOT NULL AND expires_at < NOW()`);
    } else if (excludeExpired) {
      conditions.push(`(expires_at IS NULL OR expires_at >= NOW())`);
    }

    // rootId scoping — use path index if available, fall back to CTE
    if (rootId) {
      const rootPath = await this._getPath(rootId);
      if (rootPath) {
        conditions.push(`(path = $${p} OR path LIKE $${p + 1})`);
        params.push(rootPath, rootPath + '/%'); p += 2;
      } else {
        conditions.push(
          `id IN (
            WITH RECURSIVE sub AS (
              SELECT id FROM items WHERE id = $${p}
              UNION ALL
              SELECT i.id FROM items i JOIN sub s ON i.parent_id = s.id AND i.id != i.parent_id
            ) SELECT id FROM sub
          )`,
        );
        params.push(rootId); p++;
      }
    }

    if (type && typeWarning) {
      // Unknown type (non-strict): it matches nothing — return an empty set
      // with the warning attached, rather than silently ignoring the filter.
      conditions.push('FALSE');
    } else if (type) {
      conditions.push(
        `(type = $${p} OR (type = 'object' AND type_id IN (SELECT id FROM items WHERE value = $${p} AND type = 'type')))`,
      );
      params.push(type); p++;
    }

    const whereClause = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await this._pool.query(
      `SELECT * FROM items${whereClause}`, params,
    );
    let items = rows.map(rowToItem);

    // where clause: in-JS filtering on objectData fields
    if (where && Object.keys(where).length) {
      const withData = await Promise.all(items.map(async (item: any) => {
        if (item.type !== 'object' || !item.typeId) return { ...item, objectData: null };
        const objectData = await this.readObjectJson(item.id, item.typeId);
        return { ...item, objectData };
      }));
      items = withData.filter((item: any) => {
        if (!item.objectData) return false;
        for (const [field, predicate] of Object.entries<any>(where)) {
          const fv = item.objectData[field];
          const op = predicate?.op ?? '=';
          const ev = predicate?.value ?? predicate;
          if (op === '='        && fv !== ev) return false;
          if (op === '!='       && fv === ev) return false;
          if (op === 'in'       && !ev?.includes(fv)) return false;
          if (op === 'contains' && !String(fv ?? '').toLowerCase().includes(String(ev).toLowerCase())) return false;
          if (op === '>'        && !(fv > ev)) return false;
          if (op === '<'        && !(fv < ev)) return false;
        }
        return true;
      });
    }

    if (sort?.field) {
      const { field, dir = 'asc' } = sort;
      const desc = dir.toLowerCase() === 'desc';
      items.sort((a: any, b: any) => {
        const va = a[field] ?? a.objectData?.[field] ?? null;
        const vb = b[field] ?? b.objectData?.[field] ?? null;
        if (va === null) return desc ? -1 : 1;
        if (vb === null) return desc ? 1 : -1;
        return va < vb ? (desc ? 1 : -1) : va > vb ? (desc ? -1 : 1) : 0;
      });
    }

    const finalLimit = limit > 0 ? limit : (limit === undefined ? 50 : 0);
    const result = finalLimit > 0 ? items.slice(0, finalLimit) : items;

    if (typeWarning) {
      Object.defineProperty(result, 'warning', { value: typeWarning, enumerable: false, configurable: true });
    }
    return result;
  }

  // ─── Full-text search ─────────────────────────────────────────────────────────

  async search(query: any, { rootId = null, limit = 10 }: any = {}) {
    const { rows } = await this._pool.query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM items WHERE id = $2
         UNION ALL
         SELECT i.id FROM items i JOIN subtree s ON i.parent_id = s.id AND i.id != i.parent_id
       )
       SELECT i.*, ts_rank(si.tsv, plainto_tsquery('english', $1)) AS rank
       FROM items i
       JOIN search_index si ON si.item_id = i.id
       WHERE si.tsv @@ plainto_tsquery('english', $1)
         AND ($2::uuid IS NULL OR i.id IN (SELECT id FROM subtree))
       ORDER BY rank DESC
       LIMIT $3`,
      [query, rootId, limit],
    );
    return rows.map(rowToItem);
  }

  // ─── Object data (obj_* tables) ───────────────────────────────────────────────

  async readObjectJson(id: any, typeId?: any) {
    if (!typeId) {
      const item = await this.get(id);
      typeId = item?.typeId;
    }
    if (!typeId) return null;
    const table = objTableName(typeId);
    try {
      const { rows } = await this._pool.query(
        `SELECT * FROM "${table}" WHERE item_id = $1`, [id],
      );
      if (!rows[0]) return null;
      const { item_id, ...rest } = rows[0]; // eslint-disable-line no-unused-vars
      return Object.fromEntries(
        Object.entries(rest).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]),
      );
    } catch { return null; }
  }

  async writeObjectJson(id: any, typeId?: any, data?: any) {
    // Support both the adapter form (id, typeId, data) and the Datastore facade's
    // (id, data): when `data` is omitted the second arg IS the payload, and the
    // typeId is looked up from the item (mirrors readObjectJson). Without this,
    // every facade caller — the API's object-write endpoints, connectorEngine —
    // silently no-ops against Postgres (the payload lands in `typeId`).
    if (data === undefined) { data = typeId; typeId = undefined; }
    if (!typeId) {
      const item = await this.get(id);
      typeId = item?.typeId;
    }
    if (!typeId) return;
    const table        = objTableName(typeId);
    const camelToSnake = (s: string) => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    const entries      = Object.entries(data).map(([k, v]) => [camelToSnake(k), v]);
    const cols         = entries.map(([k]) => `"${k}"`).join(', ');
    const vals         = entries.map(([, v]) => v);
    const sets         = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(', ');
    const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
    try {
      await this._pool.query(
        `INSERT INTO "${table}" (item_id, ${cols}) VALUES ($1, ${placeholders})
         ON CONFLICT (item_id) DO UPDATE SET ${sets}`,
        [id, ...vals],
      );
    } catch (e: any) {
      console.warn(`writeObjectJson: table ${table} not found for type ${typeId}:`, e.message);
    }
  }

  // ─── Function data ───────────────────────────────────────────────────────────

  async readFunctionJson(id: any) {
    const { rows } = await this._pool.query('SELECT * FROM functions WHERE item_id = $1', [id]);
    const fn = rows[0];
    if (!fn) return null;

    const [{ rows: typeParamRows }, { rows: paramRows }, { rows: throwRows }] = await Promise.all([
      this._pool.query(
        `SELECT name, constraint_expr, default_type FROM function_type_parameters
         WHERE function_id = $1 ORDER BY sort_order`, [id],
      ),
      this._pool.query(
        `SELECT name, type, type_id, optional, rest, default_value, description FROM function_parameters
         WHERE function_id = $1 ORDER BY sort_order`, [id],
      ),
      this._pool.query(
        `SELECT type, description FROM function_throws
         WHERE function_id = $1 ORDER BY sort_order`, [id],
      ),
    ]);

    const result: any = {};
    result.runtime = fn.runtime ?? 'typescript';
    if (fn.description != null)    result.description = fn.description;
    if (fn.is_async)               result.async = true;
    if (fn.is_ai)                  result.ai = true;
    if (fn.skill_id)               result.skill = fn.skill_id;
    if (typeParamRows.length) {
      result.typeParameters = typeParamRows.map((r: any) => {
        const tp: any = { name: r.name };
        if (r.constraint_expr != null) tp.constraint = r.constraint_expr;
        if (r.default_type != null)    tp.default = r.default_type;
        return tp;
      });
    }
    result.parameters = paramRows.map((r: any) => {
      const p: any = { name: r.name };
      if (r.type != null)          p.type = r.type;
      if (r.type_id != null)       p.typeId = r.type_id;
      if (r.optional)              p.optional = true;
      if (r.rest)                  p.rest = true;
      if (r.default_value != null) p.defaultValue = r.default_value;
      if (r.description != null)   p.description = r.description;
      return p;
    });
    if (fn.return_type != null)    result.returnType = fn.return_type;
    if (fn.return_type_id != null) result.returnTypeId = fn.return_type_id;
    if (throwRows.length) {
      result.throws = throwRows.map((r: any) => ({
        type: r.type,
        ...(r.description != null ? { description: r.description } : {}),
      }));
    }
    if (fn.deprecated_notice != null) result.deprecated = fn.deprecated_notice;
    if (fn.body != null)               result.body = fn.body;
    if (!fn.include_kanecta_sdk)       result.includeKanectaSdk = false;
    if (fn.dependencies?.length)       result.dependencies = fn.dependencies;
    if (fn.bundle_hash != null)        result.bundleHash = fn.bundle_hash;
    return result;
  }

  async writeFunctionJson(id: any, data: any) {
    const {
      runtime = 'typescript',
      description = null, async: isAsync = false, ai = false, skill = null,
      typeParameters = [], parameters = [], returnType = null, returnTypeId = null,
      throws = [], deprecated = null, body = null, includeKanectaSdk = true,
      dependencies = [], bundleHash = null,
    } = data;

    await this._pool.query(
      `INSERT INTO functions (
         item_id, runtime, description, is_async, is_ai, skill_id, return_type, return_type_id,
         deprecated_notice, body, include_kanecta_sdk, dependencies, bundle_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (item_id) DO UPDATE SET
         runtime = $2, description = $3, is_async = $4, is_ai = $5, skill_id = $6,
         return_type = $7, return_type_id = $8, deprecated_notice = $9,
         body = $10, include_kanecta_sdk = $11, dependencies = $12, bundle_hash = $13`,
      [id, runtime, description, isAsync, ai, skill, returnType, returnTypeId,
       deprecated, body, includeKanectaSdk, dependencies,
       bundleHash ? JSON.stringify(bundleHash) : null],
    );

    await Promise.all([
      this._pool.query('DELETE FROM function_type_parameters WHERE function_id = $1', [id]),
      this._pool.query('DELETE FROM function_parameters WHERE function_id = $1', [id]),
      this._pool.query('DELETE FROM function_throws WHERE function_id = $1', [id]),
    ]);

    for (const [i, tp] of typeParameters.entries()) {
      await this._pool.query(
        `INSERT INTO function_type_parameters (id, function_id, sort_order, name, constraint_expr, default_type)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [crypto.randomUUID(), id, i, tp.name, tp.constraint ?? null, tp.default ?? null],
      );
    }
    for (const [i, param] of parameters.entries()) {
      await this._pool.query(
        `INSERT INTO function_parameters (id, function_id, sort_order, name, type, type_id, optional, rest, default_value, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [crypto.randomUUID(), id, i, param.name, param.type ?? null, param.typeId ?? null, param.optional ?? false, param.rest ?? false, param.defaultValue ?? null, param.description ?? null],
      );
    }
    for (const [i, t] of throws.entries()) {
      await this._pool.query(
        `INSERT INTO function_throws (id, function_id, sort_order, type, description)
         VALUES ($1,$2,$3,$4,$5)`,
        [crypto.randomUUID(), id, i, t.type, t.description ?? null],
      );
    }
  }

  // ─── Connector queries ────────────────────────────────────────────────────────

  // All stub items (materialized=false) managed by a specific connector.
  async listStubs(connectorId: any) {
    const { rows } = await this._pool.query(
      `SELECT * FROM items
       WHERE connector_id = $1 AND materialized = false AND deleted_at IS NULL`,
      [connectorId],
    );
    return rows.map(rowToItem);
  }

  // All connector-managed items whose cached_at is older than beforeAt.
  // Used by ConnectorEngine to drive scheduled refresh.
  async listDueForRefresh(beforeAt: any) {
    const { rows } = await this._pool.query(
      `SELECT * FROM items
       WHERE connector_id IS NOT NULL AND cached_at < $1 AND deleted_at IS NULL`,
      [beforeAt],
    );
    return rows.map(rowToItem);
  }

  // ─── Time data ───────────────────────────────────────────────────────────────

  async getDocument(id: any) {
    const flat = await this.get(id);
    if (!flat) return null;
    const payload = (['object', 'type'].includes(flat.type))
      ? await this.readObjectJson(id, flat.typeId).catch(() => null)
      : null;
    const time = await this.readTimeJson(id).catch(() => null);
    return {
      item: {
        id: flat.id, parentId: flat.parentId, type: flat.type, typeId: flat.typeId ?? null,
        value: flat.value ?? null, sortOrder: flat.sortOrder ?? 0, aspect: flat.aspect ?? null,
      },
      meta: {
        specVersion: flat.specVersion, owner: flat.owner ?? null, license: flat.license ?? null,
        visibility: flat.visibility ?? 'private', confidence: flat.confidence ?? null,
        status: flat.status ?? null, tags: flat.tags ?? [], createdAt: flat.createdAt,
        modifiedAt: flat.modifiedAt, createdBy: flat.createdBy ?? null, modifiedBy: flat.modifiedBy ?? null,
        completedAt: flat.completedAt ?? null, dueAt: flat.dueAt ?? null,
        expiresAt: flat.expiresAt ?? null, deletedAt: flat.deletedAt ?? null,
        cachedAt: flat.cachedAt ?? null, connectorId: flat.connectorId ?? null,
        materialized: flat.materialized ?? null, files: flat.files ?? {},
        layer: flat.layer ?? null, sourceSystem: flat.sourceSystem ?? null,
        sourceExternalId: flat.sourceExternalId ?? null, icon: flat.icon ?? null,
      },
      payload: payload ?? null,
      time: time && Object.keys(time).length > 0 ? time : null,
    };
  }

  async readTimeJson(id: any) {
    const { rows } = await this._pool.query('SELECT time_data FROM items WHERE id = $1', [id]);
    return rows[0]?.time_data ?? null;
  }

  async writeTimeJson(id: any, data: any) {
    await this._pool.query(
      'UPDATE items SET time_data = $1 WHERE id = $2', [data, id],
    );
  }

  async deleteTimeJson(id: any) {
    await this._pool.query('UPDATE items SET time_data = NULL WHERE id = $1', [id]);
  }

  async readScheduleJson(id: any) {
    const { rows } = await this._pool.query('SELECT schedule_data FROM items WHERE id = $1', [id]);
    return rows[0]?.schedule_data ?? null;
  }

  async writeScheduleJson(id: any, data: any) {
    await this._pool.query(
      'UPDATE items SET schedule_data = $1 WHERE id = $2', [data, id],
    );
  }

  // ─── Document type helpers ─────────────────────────────────────────────────

  // Stable UUID of the synthetic 'document' type item — seeded from
  // built-in-types/types/document.json and identical across all installations.
  static get DOCUMENT_TYPE_UUID() { return 'b4e2f1c3-a0d5-4e6f-8b9c-d7f2e1a3b5c0'; }

  async createDocument(targetId: any, name: any, {
    expandState = null,
    roleMap = null,
    isOrgDefault = false,
    baseDocumentId = null,
    owner, visibility = 'private',
  }: any = {}) {
    if (!targetId) throw new Error('createDocument: targetId is required');
    if (!name)     throw new Error('createDocument: name is required');
    const item = await this.create({
      type: 'document',
      parentId: PostgresAdapter.DOCUMENT_TYPE_UUID,
      value: name,
      owner,
      visibility,
    });
    const payload = {
      targetId,
      name,
      expandState: expandState ?? { defaultDepth: 2, exceptions: {} },
      roleMap: roleMap ?? { byDepth: { '1': 'heading', '2': 'subheading', '3': 'body' }, byType: {} },
      isOrgDefault,
      baseDocumentId: baseDocumentId ?? null,
    };
    await this.writeDocumentPayload(item.id, payload);
    return item;
  }

  async readDocumentPayload(id: any) {
    const { rows } = await this._pool.query(
      'SELECT payload FROM documents WHERE item_id = $1', [id],
    );
    return rows[0]?.payload ?? null;
  }

  async writeDocumentPayload(id: any, payload: any) {
    await this._pool.query(
      `INSERT INTO documents (item_id, payload) VALUES ($1, $2)
       ON CONFLICT (item_id) DO UPDATE SET payload = EXCLUDED.payload`,
      [id, JSON.stringify(payload)],
    );
  }

  async listDocuments(targetId: any) {
    const { rows } = await this._pool.query(`
      SELECT i.*
      FROM items i
      JOIN documents d ON d.item_id = i.id
      WHERE i.type = 'document'
        AND d.payload->>'targetId' = $1
        AND i.deleted_at IS NULL
      ORDER BY i.id
    `, [targetId]);
    return rows.map(rowToItem);
  }

  // Active schedule items whose next fire time is at or before beforeAt.
  async listDueSchedules(beforeAt: any) {
    const { rows } = await this._pool.query(
      "SELECT * FROM items WHERE type = 'schedule' AND status = 'active' AND due_at <= $1 AND deleted_at IS NULL",
      [beforeAt],
    );
    return rows.map(r => (this as any).rowToItem(r));
  }

  // ─── Type definitions ─────────────────────────────────────────────────────────

  async createType(value: any, { schema, createdBy, id: explicitId }: any = {}) {
    const id    = explicitId || crypto.randomUUID();
    const now   = new Date();
    const owner = this.config.owner;
    const actor = createdBy || owner;

    await this._pool.query(
      `INSERT INTO items (id, spec_version, parent_id, path, value, type, owner, license, sort_order,
         created_at, modified_at, created_by, modified_by)
       VALUES ($1, $2, $1, $7, $3, 'type', $4, $5, 0, $6, $6, $4, $4)
       ON CONFLICT (id) DO NOTHING`,
      // $7 is the text `path` (a type item's path is its own id). It is a
      // separate parameter from $1 (uuid id/parent_id) so PG doesn't try to
      // deduce one type for a value used as both uuid and text.
      [id, specVersion, value.trim(), owner, DEFAULT_LICENSE, now, String(id)],
    );

    const resolvedSchema = schema || {
      meta: { icon: '', description: '', details: '', keywords: '', tags: '', skills: { claude: '' } },
      jsonSchema: {
        '$schema': 'http://json-schema.org/draft-07/schema#',
        '$id': '',
        title: value.trim(),
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    };

    const meta      = resolvedSchema.meta ?? {};
    const tableName = resolvedSchema.sqlSchema?.length ? objTableName(id) : null;

    await this._pool.query(
      `INSERT INTO types (
         item_id, table_name,
         meta_icon, meta_description, meta_details, meta_keywords, meta_tags,
         meta_primary_field, meta_ai_instructions_claude,
         meta_functions_consumed_by, meta_functions_produced_by,
         json_schema, sql_schema, sync, superseded_by, implements, extends
       ) VALUES (
         $1, $2,
         $3, $4, $5, $6, $7,
         $8, $9,
         $10, $11,
         $12, $13, $14, $15, $16, $17
       )
       ON CONFLICT (item_id) DO UPDATE SET
         table_name = $2,
         meta_icon = $3, meta_description = $4, meta_details = $5, meta_keywords = $6, meta_tags = $7,
         meta_primary_field = $8, meta_ai_instructions_claude = $9,
         meta_functions_consumed_by = $10, meta_functions_produced_by = $11,
         json_schema = $12, sql_schema = $13, sync = $14, superseded_by = $15, implements = $16, extends = $17`,
      [
        id, tableName,
        meta.icon ?? null, meta.description ?? '', meta.details ?? null, meta.keywords ?? null, meta.tags ?? null,
        meta.primaryField ?? null, meta.skills?.claude ?? null,
        meta.functions?.consumedBy ?? [], meta.functions?.producedBy ?? [],
        JSON.stringify(resolvedSchema.jsonSchema), resolvedSchema.sqlSchema ?? [],
        meta.sync ?? [], meta.supersededBy ?? [], meta.implements ?? [], meta.extends ?? [],
      ],
    );

    if (resolvedSchema.sqlSchema?.length) {
      for (const ddl of resolvedSchema.sqlSchema) {
        const createIfNotExists = ddl.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
        await this._pool.query(createIfNotExists);
      }
      await this._attachObjectSearchTrigger(objTableName(id));
    }

    await this._snapshot(id, 'create', actor, now);
    const metadata = await this.get(id);
    return { metadata, schema: resolvedSchema };
  }

  async readTypeJson(id: any) {
    const { rows } = await this._pool.query('SELECT * FROM types WHERE item_id = $1', [id]);
    const t = rows[0];
    if (!t) return null;
    const meta = {
      icon: t.meta_icon ?? '',
      description: t.meta_description ?? '',
      details: t.meta_details ?? '',
      keywords: t.meta_keywords ?? '',
      tags: t.meta_tags ?? '',
      primaryField: t.meta_primary_field ?? '',
      skills: { claude: t.meta_ai_instructions_claude ?? '' },
      functions: { consumedBy: t.meta_functions_consumed_by ?? [], producedBy: t.meta_functions_produced_by ?? [] },
      sync: t.sync ?? [],
      supersededBy: t.superseded_by ?? [],
      implements: t.implements ?? [],
      extends: t.extends ?? [],
    };
    return { meta, jsonSchema: t.json_schema, sqlSchema: t.sql_schema ?? [] };
  }

  async writeTypeJson(id: any, data: any) {
    const meta = data.meta ?? {};
    await this._pool.query(
      `UPDATE types SET
         meta_icon = $2, meta_description = $3, meta_details = $4, meta_keywords = $5, meta_tags = $6,
         meta_primary_field = $7, meta_ai_instructions_claude = $8,
         meta_functions_consumed_by = $9, meta_functions_produced_by = $10,
         json_schema = $11, sync = $12, superseded_by = $13, implements = $14, extends = $15
       WHERE item_id = $1`,
      [
        id,
        meta.icon ?? null, meta.description ?? '', meta.details ?? null, meta.keywords ?? null, meta.tags ?? null,
        meta.primaryField ?? null, meta.skills?.claude ?? null,
        meta.functions?.consumedBy ?? [], meta.functions?.producedBy ?? [],
        JSON.stringify(data.jsonSchema), meta.sync ?? [], meta.supersededBy ?? [], meta.implements ?? [], meta.extends ?? [],
      ],
    );
  }

  async _attachObjectSearchTrigger(tableName: any) {
    await this._pool.query(`DROP TRIGGER IF EXISTS trg_object_search_vector ON "${tableName}"`);
    await this._pool.query(
      `CREATE TRIGGER trg_object_search_vector
         AFTER INSERT OR UPDATE OR DELETE ON "${tableName}"
         FOR EACH ROW EXECUTE FUNCTION kanecta_update_object_search_vector()`,
    );
  }

  // ─── Semantic / hybrid search (pgvector) ─────────────────────────────────────

  get embeddingsEnabled() {
    return !!this._embeddingProvider && this._embeddingsEnabled;
  }

  _requireEmbeddingProvider() {
    if (!this._embeddingProvider) {
      throw new Error(
        'Semantic search requires an embedding provider — set `cloud.embeddings` in the workspace config',
      );
    }
    return this._embeddingProvider;
  }

  _requireEmbeddingsEnabled() {
    const provider = this._requireEmbeddingProvider();
    if (!this._embeddingsEnabled) {
      throw new Error(
        'Semantic search is disabled (`cloud.embeddings.enabled: false`) — typically because the backfill is still running',
      );
    }
    return provider;
  }

  async semanticSearch(query: any, { rootId = null, limit = 10 }: any = {}) {
    const provider = this._requireEmbeddingsEnabled();
    const [queryEmbedding] = await provider.embed([query]);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const { rows } = await this._pool.query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM items WHERE id = $3
         UNION ALL
         SELECT i.id FROM items i JOIN subtree s ON i.parent_id = s.id AND i.id != i.parent_id
       )
       SELECT i.*, (e.embedding OPERATOR(public.<=>) $1::public.vector) AS distance
       FROM items i
       JOIN item_embeddings e ON e.item_id = i.id AND e.model = $2
       WHERE ($3::uuid IS NULL OR i.id IN (SELECT id FROM subtree))
       ORDER BY distance ASC
       LIMIT $4`,
      [vectorLiteral, provider.model, rootId, limit],
    );
    return rows.map(rowToItem);
  }

  async hybridSearch(query: any, { rootId = null, limit = 10 }: any = {}) {
    if (!this.embeddingsEnabled) return this.search(query, { rootId, limit });
    const fanOut = Math.max(limit * 2, 20);
    const [ftsResults, vectorResults] = await Promise.all([
      this.search(query, { rootId, limit: fanOut }),
      this.semanticSearch(query, { rootId, limit: fanOut }),
    ]);
    return reciprocalRankFusion([ftsResults, vectorResults]).slice(0, limit);
  }

  async _ensureEmbeddingTable() {
    const provider   = this._embeddingProvider;
    const dimensions = Number(provider.dimensions);
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error(`Invalid embedding dimensions for provider '${provider.name}': ${provider.dimensions}`);
    }
    await this._pool.query(`
      CREATE TABLE IF NOT EXISTS item_embeddings (
        item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        model        TEXT NOT NULL,
        embedding    public.VECTOR(${dimensions}) NOT NULL,
        content_hash TEXT NOT NULL,
        embedded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (item_id, model)
      )
    `);
    await this._pool.query(`
      CREATE INDEX IF NOT EXISTS idx_item_embeddings_hnsw
        ON item_embeddings USING hnsw (embedding public.vector_cosine_ops)
    `);
    await this._pool.query(
      `INSERT INTO pending_embeddings (item_id)
       SELECT i.id FROM items i
       WHERE NOT EXISTS (
         SELECT 1 FROM item_embeddings e WHERE e.item_id = i.id AND e.model = $1
       )
       ON CONFLICT (item_id) DO NOTHING`,
      [provider.model],
    );
  }

  async _embeddingContent(item: any) {
    const parts = [];
    if (item.value) parts.push(String(item.value));
    if (item.type === 'object' && item.typeId) {
      const data = await this.readObjectJson(item.id, item.typeId);
      if (data) {
        for (const [field, value] of Object.entries(data)) {
          if (value != null && value !== '') parts.push(`${field}: ${value}`);
        }
      }
    }
    return parts.join('\n');
  }

  async embedItem(id: any) {
    const provider = this._requireEmbeddingProvider();
    const item = await this.get(id);
    if (!item) return false;
    const content     = await this._embeddingContent(item);
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const { rows } = await this._pool.query(
      'SELECT content_hash FROM item_embeddings WHERE item_id = $1 AND model = $2',
      [id, provider.model],
    );
    if (rows[0]?.content_hash === contentHash) return false;
    const [embedding] = await provider.embed([content]);
    const vectorLiteral = `[${embedding.join(',')}]`;
    await this._pool.query(
      `INSERT INTO item_embeddings (item_id, model, embedding, content_hash, embedded_at)
       VALUES ($1, $2, $3::public.vector, $4, now())
       ON CONFLICT (item_id, model) DO UPDATE
         SET embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash, embedded_at = now()`,
      [id, provider.model, vectorLiteral, contentHash],
    );
    return true;
  }

  async processPendingEmbeddings({ limit = 50 }: any = {}) {
    this._requireEmbeddingProvider();
    const { rows } = await this._pool.query(
      'SELECT item_id FROM pending_embeddings ORDER BY queued_at LIMIT $1', [limit],
    );
    let embedded = 0, skipped = 0, failed = 0;
    for (const { item_id } of rows) {
      try {
        if (await this.embedItem(item_id)) embedded++; else skipped++;
        await this._pool.query('DELETE FROM pending_embeddings WHERE item_id = $1', [item_id]);
      } catch (e: any) {
        failed++;
        console.warn(`processPendingEmbeddings: failed to embed ${item_id}:`, e.message);
      }
    }
    return { processed: rows.length, embedded, skipped, failed };
  }

  // ─── Index maintenance ────────────────────────────────────────────────────────

  async rebuildIndexes() {
    await this._pool.query('DELETE FROM links');
    const { rows } = await this._pool.query(`SELECT id, value FROM items WHERE value IS NOT NULL`);
    for (const row of rows) {
      for (const link of parseLinks(row.value)) {
        await this._pool.query(
          'INSERT INTO links (source_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [row.id, link],
        );
      }
    }
    const { rows: [{ count }] } = await this._pool.query('SELECT COUNT(*) FROM items');
    return parseInt(count);
  }

  // ─── Integrity checks ──────────────────────────────────────────────────────

  async checkIntegrity({ checks }: any = {}) {
    const wanted  = Array.isArray(checks) && checks.length ? new Set(checks) : null;
    const run     = (name: any) => !wanted || wanted.has(name);
    const findings = [];

    if (run('orphan-type-id')) {
      const { rows } = await this._pool.query(
        `SELECT i.id, i.type_id
           FROM items i
           LEFT JOIN items t ON t.id = i.type_id AND t.type = 'type'
          WHERE i.type = 'object' AND i.type_id IS NOT NULL AND t.id IS NULL`,
      );
      for (const row of rows) {
        findings.push({
          check:    'orphan-type-id',
          severity: 'error',
          nodeId:   row.id,
          typeId:   row.type_id,
          message:  `object ${row.id} references typeId ${row.type_id}, which has no type definition`,
          fix:      'register the missing type definition, or remove/retype the node',
        });
      }
    }

    if (run('disconnected-items')) {
      const { rows } = await this._pool.query(
        `SELECT i.id FROM items i
         WHERE i.path IS NULL AND i.type NOT IN ('root')`,
      );
      for (const row of rows) {
        findings.push({
          check:    'disconnected-items',
          severity: 'warn',
          nodeId:   row.id,
          message:  `item ${row.id} has no materialized path — not reachable from root`,
          fix:      'run rebuildPaths() or re-parent the item',
        });
      }
    }

    return findings;
  }

  // Recompute materialized paths for all items from the root down.
  async rebuildPaths() {
    await this._pool.query(`
      WITH RECURSIVE paths AS (
        SELECT id, id::text AS path FROM items
        WHERE id = '00000000-0000-0000-0000-000000000000'
        UNION ALL
        SELECT i.id, p.path || '/' || i.id::text
        FROM items i
        JOIN paths p ON i.parent_id = p.id AND i.id != i.parent_id
      )
      UPDATE items SET path = paths.path FROM paths WHERE items.id = paths.id
    `);
  }

  // ─── Branching ──────────────────────────────────────────────────────────────

  async createBranch(name: any) {
    if (!name || typeof name !== 'string' || !name.trim()) throw new Error('branch name is required');
    name = name.trim();
    if (name === 'main') throw new Error('Cannot create a branch named "main"');
    const existing = await this._pool.query('SELECT id FROM branches WHERE name = $1 AND deleted_at IS NULL', [name]);
    if (existing.rows.length) throw new Error(`Branch "${name}" already exists`);
    const { rows } = await this._pool.query(
      'INSERT INTO branches (name, base_branch) VALUES ($1, $2) RETURNING id, name, base_branch, created_at',
      [name, 'main'],
    );
    const r = rows[0];
    return { id: r.id, name: r.name, baseBranch: r.base_branch, createdAt: r.created_at.toISOString() };
  }

  async listBranches() {
    const { rows } = await this._pool.query(
      'SELECT id, name, base_branch, created_at, merged_at, deleted_at FROM branches WHERE deleted_at IS NULL ORDER BY created_at',
    );
    return rows.map(r => ({
      id: r.id, name: r.name, baseBranch: r.base_branch,
      createdAt: r.created_at.toISOString(),
      mergedAt:  r.merged_at?.toISOString() ?? null,
      deletedAt: r.deleted_at?.toISOString() ?? null,
    }));
  }

  async getBranch(name: any) {
    const { rows } = await this._pool.query(
      'SELECT id, name, base_branch, created_at, merged_at, deleted_at FROM branches WHERE name = $1 AND deleted_at IS NULL',
      [name],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, name: r.name, baseBranch: r.base_branch, createdAt: r.created_at.toISOString(), mergedAt: r.merged_at?.toISOString() ?? null };
  }

  // Write an array of change entries to branch_changes. Each entry: { itemId, changeType, section, data }.
  // Callers pass the full five-section breakdown.
  async applyBranchChanges(branchId: any, changes: any) {
    if (!changes?.length) return;
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const stmt = `
        INSERT INTO branch_changes (branch_id, item_id, change_type, section, data, changed_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (branch_id, item_id, section) DO UPDATE
          SET change_type = EXCLUDED.change_type, data = EXCLUDED.data, changed_at = now()
      `;
      for (const c of changes) {
        await client.query(stmt, [branchId, c.itemId, c.changeType, c.section, c.data ? JSON.stringify(c.data) : null]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getBranchChanges(branchId: any) {
    const { rows } = await this._pool.query(
      'SELECT item_id, change_type, section, data, changed_at FROM branch_changes WHERE branch_id = $1 ORDER BY item_id, section',
      [branchId],
    );
    return rows.map(r => ({
      itemId: r.item_id, changeType: r.change_type, section: r.section,
      data: r.data, changedAt: r.changed_at.toISOString(),
    }));
  }

  // Pre-flight scan: returns the blast radius for all items in a branch.
  // Blocks merge when any reference item with blockDeletion=true targets a deleted item.
  async preFlightScan(branchId: any) {
    // Collect the set of deleted item IDs on this branch
    const { rows: delRows } = await this._pool.query(
      "SELECT DISTINCT item_id FROM branch_changes WHERE branch_id = $1 AND change_type = 'delete'",
      [branchId],
    );
    const deletedIds = delRows.map(r => r.item_id);

    // Get all changed item IDs (creates, updates, deletes)
    const { rows: allRows } = await this._pool.query(
      "SELECT DISTINCT item_id, change_type FROM branch_changes WHERE branch_id = $1 AND section = 'item'",
      [branchId],
    );

    const adds    = allRows.filter(r => r.change_type === 'create').map(r => r.item_id);
    const edits   = allRows.filter(r => r.change_type === 'update').map(r => r.item_id);
    const deletes = deletedIds;
    const changedIds = [...new Set([...adds, ...edits, ...deletes])];

    // Blast radius: items that reference any of the changed IDs
    let structuralRefs: any[] = [];
    let blockingRefs: any[]   = [];
    if (changedIds.length) {
      const { rows: refRows } = await this._pool.query(
        'SELECT source_item_id, target_item_id, reference_type, field_name FROM item_references WHERE target_item_id = ANY($1)',
        [changedIds],
      ).catch(() => ({ rows: [] })); // item_references may not exist on older schemas
      structuralRefs = refRows.map(r => ({
        sourceId: r.source_item_id, targetId: r.target_item_id,
        referenceType: r.reference_type, fieldName: r.field_name,
      }));

      // Check for reference items with blockDeletion:true pointing at deleted items
      if (deletes.length) {
        // Reference items store targetId and blockDeletion flag in the main items value field
        // or time_data column as JSON — query items of type 'reference' pointing at deleted IDs.
        // This is a best-effort check; full payload scanning is handled by the SyncEngine.
        const { rows: blockRows } = await this._pool.query(`
          SELECT id FROM items
          WHERE type = 'reference'
            AND parent_id = ANY($1)
        `, [deletes]).catch(() => ({ rows: [] }));
        blockingRefs = blockRows.map(r => ({ referenceItemId: r.id }));
      }
    }

    return {
      branchId,
      summary: { adds: adds.length, edits: edits.length, deletes: deletes.length },
      structuralRefs,
      blockingRefs,
      blocked: blockingRefs.length > 0,
    };
  }

  // Atomically merge all branch_changes into main tables, then mark branch merged.
  async mergeBranch(branchId: any) {
    const { rows: branchRows } = await this._pool.query(
      'SELECT id, name FROM branches WHERE id = $1 AND deleted_at IS NULL AND merged_at IS NULL',
      [branchId],
    );
    if (!branchRows.length) throw new Error(`Branch ${branchId} not found or already merged`);

    const changeRows = await this.getBranchChanges(branchId);

    // Group by item
    const byItem = new Map<any, any>();
    for (const r of changeRows) {
      if (!byItem.has(r.itemId)) byItem.set(r.itemId, { changeType: r.changeType, sections: {} });
      const entry = byItem.get(r.itemId);
      if (r.changeType === 'delete') entry.changeType = 'delete';
      if (r.data) entry.sections[r.section] = r.data;
    }

    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');

      for (const [itemId, entry] of byItem) {
        if (entry.changeType === 'delete') {
          await client.query('DELETE FROM items WHERE id = $1', [itemId]);
        } else {
          const item    = entry.sections.item    ?? {};
          const meta    = entry.sections.meta    ?? {};
          const payload = entry.sections.payload ?? null;

          if (entry.changeType === 'create') {
            // Insert into items table
            await client.query(`
              INSERT INTO items (id, parent_id, value, type, type_id, sort_order, aspect, spec_version,
                owner, license, visibility, confidence, status, tags,
                created_at, modified_at, created_by, modified_by,
                expires_at, deleted_at, connector_id, materialized,
                source_system, source_external_id, path)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
              ON CONFLICT (id) DO UPDATE SET
                parent_id = EXCLUDED.parent_id, value = EXCLUDED.value, type = EXCLUDED.type,
                type_id = EXCLUDED.type_id, sort_order = EXCLUDED.sort_order, aspect = EXCLUDED.aspect,
                modified_at = EXCLUDED.modified_at, modified_by = EXCLUDED.modified_by
            `, [
              itemId, item.parentId ?? null, item.value ?? null, item.type ?? 'text',
              item.typeId ?? null, item.sortOrder ?? 0, item.aspect ?? null,
              meta.specVersion ?? specVersion,
              meta.owner ?? this.config.owner, meta.license ?? DEFAULT_LICENSE, meta.visibility ?? 'private',
              meta.confidence ?? null, meta.status ?? null, meta.tags ?? [],
              meta.createdAt ? new Date(meta.createdAt) : new Date(),
              meta.modifiedAt ? new Date(meta.modifiedAt) : new Date(),
              meta.createdBy ?? this.config.owner, meta.modifiedBy ?? this.config.owner,
              meta.expiresAt ? new Date(meta.expiresAt) : null,
              meta.deletedAt ? new Date(meta.deletedAt) : null,
              meta.connectorId ?? null, meta.materialized ?? null,
              meta.sourceSystem ?? null, meta.sourceExternalId ?? null,
              null, // path: recomputed by rebuildPaths
            ]);
          } else {
            // Update existing item
            await client.query(`
              UPDATE items SET
                parent_id = COALESCE($2, parent_id), value = COALESCE($3, value),
                type = COALESCE($4, type), type_id = $5, sort_order = COALESCE($6, sort_order),
                aspect = $7, modified_at = $8, modified_by = COALESCE($9, modified_by),
                expires_at = $10, deleted_at = $11, connector_id = $12, materialized = $13,
                visibility = COALESCE($14, visibility), status = $15, tags = COALESCE($16, tags)
              WHERE id = $1
            `, [
              itemId, item.parentId ?? null, item.value ?? null, item.type ?? null,
              item.typeId ?? null, item.sortOrder ?? null, item.aspect ?? null,
              meta.modifiedAt ? new Date(meta.modifiedAt) : new Date(),
              meta.modifiedBy ?? null,
              meta.expiresAt  ? new Date(meta.expiresAt)  : null,
              meta.deletedAt  ? new Date(meta.deletedAt)  : null,
              meta.connectorId ?? null, meta.materialized ?? null,
              meta.visibility ?? null, meta.status ?? null, meta.tags ?? null,
            ]);
          }

          // Payload for object types is stored via writeObjectJson (on-disk JSON),
          // not in a separate DB table. The payload section in branch_changes carries
          // merge metadata only; full payload sync is handled by the SyncEngine.
        }
      }

      // Mark branch merged and clear changes
      await client.query('UPDATE branches SET merged_at = now() WHERE id = $1', [branchId]);
      await client.query('DELETE FROM branch_changes WHERE branch_id = $1', [branchId]);

      // Rebuild paths for items that moved or were created
      await client.query(`
        WITH RECURSIVE paths AS (
          SELECT id, id::text AS path FROM items
          WHERE id = '00000000-0000-0000-0000-000000000000'
          UNION ALL
          SELECT i.id, p.path || '/' || i.id::text
          FROM items i
          JOIN paths p ON i.parent_id = p.id AND i.id != i.parent_id
        )
        UPDATE items SET path = paths.path FROM paths WHERE items.id = paths.id AND items.path IS DISTINCT FROM paths.path
      `);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return { merged: byItem.size, branchName: branchRows[0].name };
  }

  async deleteBranch(name: any) {
    if (!name || name === 'main') throw new Error('Cannot delete the main branch');
    const { rows } = await this._pool.query('SELECT id FROM branches WHERE name = $1 AND deleted_at IS NULL', [name]);
    if (!rows.length) throw new Error(`Branch "${name}" not found`);
    await this._pool.query('UPDATE branches SET deleted_at = now() WHERE id = $1', [rows[0].id]);
    await this._pool.query('DELETE FROM branch_changes WHERE branch_id = $1', [rows[0].id]);
  }
}

export {
  PostgresAdapter, UnknownTypeError,
  PRIMITIVE_TYPES, BUILT_IN_TYPES, ROOT_ID,
  WELL_KNOWN_TYPES, VALID_REL_TYPES, UUID_RE,
};
