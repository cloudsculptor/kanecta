'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { version: specVersion } = require('@kanecta/specification');

const ROOT_ID    = '00000000-0000-0000-0000-000000000000';
const TYPES_NODE = '11111111-1111-1111-1111-111111111111';
const WELL_KNOWN_TYPES = new Set(['root', 'system_root', 'app_root', 'component_root', 'data_root']);
const WELL_KNOWN_ORDER = ['system_root', 'app_root', 'component_root', 'data_root'];

const VALID_TYPES = [
  'string', 'number', 'text', 'heading', 'file', 'symlink', 'url', 'image', 'function',
  'markdown', 'runner', 'object', 'annotation', 'connector',
  'root', 'system_root', 'app_root', 'component_root', 'data_root',
];
const VALID_CONFIDENCES = ['experimental', 'exploring', 'decided', 'locked', 'low', 'medium', 'high', 'verified'];
const VALID_REL_TYPES = [
  'relates-to', 'depends-on', 'enables', 'contradicts',
  'blocks', 'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LICENSE = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739';
const LINK_SOURCE = '\\[\\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\]\\]';

class UnknownTypeError extends Error {
  constructor(typeName) {
    super(`unknown type "${typeName}" — not a registered type definition`);
    this.name  = 'UnknownTypeError';
    this.code  = 'UNKNOWN_TYPE';
    this.typeName = typeName;
  }
}

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous  = NORMAL;

CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,
  spec_version  TEXT NOT NULL DEFAULT '1.4.0',
  parent_id     TEXT,
  path          TEXT,
  value         TEXT,
  type          TEXT NOT NULL DEFAULT 'text',
  type_id       TEXT,
  owner         TEXT,
  license       TEXT,
  visibility    TEXT NOT NULL DEFAULT 'private',
  aspect        TEXT,
  sort_order    REAL NOT NULL DEFAULT 0,
  confidence    TEXT,
  status        TEXT,
  tags          TEXT NOT NULL DEFAULT '[]',
  object_data   TEXT,
  function_data TEXT,
  time_data     TEXT,
  icon          TEXT,
  created_at    TEXT NOT NULL,
  modified_at   TEXT NOT NULL,
  created_by    TEXT,
  modified_by   TEXT,
  completed_at  TEXT,
  due_at        TEXT,
  expires_at    TEXT,
  deleted_at    TEXT,
  connector_id        TEXT,
  materialized        INTEGER,
  cached_at           TEXT,
  source_system       TEXT,
  source_external_id  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_source ON items (source_system, source_external_id)
  WHERE source_system IS NOT NULL AND source_external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_parent   ON items(parent_id);
CREATE INDEX IF NOT EXISTS idx_items_path     ON items(path);
CREATE INDEX IF NOT EXISTS idx_items_type     ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_type_id  ON items(type_id);
CREATE INDEX IF NOT EXISTS idx_items_deleted  ON items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_items_expires  ON items(expires_at);
CREATE INDEX IF NOT EXISTS idx_items_aspect   ON items(parent_id, aspect);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (item_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON item_tags(tag);

CREATE TABLE IF NOT EXISTS backlinks (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_backlinks_target ON backlinks(target_id);

CREATE TABLE IF NOT EXISTS relationships (
  id         TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL,
  type       TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id);

CREATE TABLE IF NOT EXISTS annotations (
  id                   TEXT PRIMARY KEY,
  target_id            TEXT NOT NULL,
  author               TEXT,
  content              TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  parent_annotation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_ann_target ON annotations(target_id);

CREATE TABLE IF NOT EXISTS history (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     TEXT NOT NULL,
  change_type TEXT NOT NULL,
  snapshot    TEXT NOT NULL,
  changed_at  TEXT NOT NULL,
  changed_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_hist_item    ON history(item_id);
CREATE INDEX IF NOT EXISTS idx_hist_changed ON history(changed_at);

CREATE TABLE IF NOT EXISTS aliases (
  alias     TEXT PRIMARY KEY,
  target_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS type_defs (
  id            TEXT PRIMARY KEY,
  value         TEXT NOT NULL,
  schema_json   TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

class SqliteFsAdapter {
  constructor(root) {
    this.root    = path.resolve(root);
    this.k       = path.join(this.root, '.kanecta');
    this._db     = null;
    this._config = null;
    this._roots  = null;
  }

  // ─── DB lifecycle ─────────────────────────────────────────────────────────

  _openDb() {
    if (this._db) return this._db;
    const dbPath = path.join(this.k, 'kanecta.db');
    this._db = new Database(dbPath);
    this._db.exec(SCHEMA_SQL);
    // Additive column migrations — safe to re-run; catch duplicate-column errors
    for (const sql of [
      'ALTER TABLE items ADD COLUMN source_system TEXT',
      'ALTER TABLE items ADD COLUMN source_external_id TEXT',
    ]) {
      try { this._db.exec(sql); } catch { /* already exists */ }
    }
    return this._db;
  }

  static isDatastore(root) {
    return fs.existsSync(path.join(root, '.kanecta', 'kanecta.db'));
  }

  static init(root, owner) {
    fs.mkdirSync(path.join(root, '.kanecta'), { recursive: true });
    const adapter = new SqliteFsAdapter(root);
    const db = adapter._openDb();
    const cfg = { owner, specVersion: '1.4.0' };
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(cfg));
    adapter._config = cfg;
    adapter._initRoots();
    adapter.create({ value: 'Welcome to Kanecta!', type: 'text', owner });
    return adapter;
  }

  static open(root) {
    if (!SqliteFsAdapter.isDatastore(root)) throw new Error(`Not a Kanecta datastore: ${root}`);
    const adapter = new SqliteFsAdapter(root);
    adapter._openDb();
    adapter._initRoots();
    return adapter;
  }

  get config() {
    if (!this._config) {
      const row = this._openDb().prepare("SELECT value FROM settings WHERE key = 'app'").get();
      if (!row) throw new Error(`Not a Kanecta datastore: ${this.root}`);
      this._config = JSON.parse(row.value);
    }
    return this._config;
  }

  _saveConfig() {
    this._openDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(this._config));
  }

  // ─── Materialized path helpers ────────────────────────────────────────────
  // Path = slash-separated UUID chain from root to node: "root-id/parent-id/node-id"
  // Enables O(1) subtree reads: WHERE path LIKE parentPath || '/%'
  // Ancestor lookup: WHERE ? LIKE path || '/%' (target's path starts with ancestor's path)

  _getPath(id) {
    const row = this._openDb().prepare('SELECT path FROM items WHERE id = ?').get(id);
    return row?.path ?? null;
  }

  _pathDepth(p) {
    if (!p) return 0;
    return (p.match(/\//g) || []).length;
  }

  // Rewrite path of id and all its descendants when the node moves to a new parent.
  _cascadePathUpdate(db, id, newPath) {
    const oldPath = this._getPath(id);
    if (!oldPath) {
      db.prepare('UPDATE items SET path = ? WHERE id = ?').run(newPath, id);
      return;
    }
    // Update the node itself
    db.prepare('UPDATE items SET path = ? WHERE id = ?').run(newPath, id);
    // Update all descendants: replace old-path prefix with new-path in each path string.
    // Using SUBSTR(path, oldPath.length + 2) to get the suffix after "oldPath/"
    const oldPrefix = oldPath + '/';
    db.prepare(
      `UPDATE items SET path = ? || '/' || SUBSTR(path, ?) WHERE path LIKE ?`
    ).run(newPath, oldPrefix.length + 1, oldPrefix + '%');
  }

  // ─── Row ↔ item conversion ─────────────────────────────────────────────────

  _rowToItem(row) {
    if (!row) return null;
    const item = {
      id:           row.id,
      specVersion:  row.spec_version,
      parentId:     row.parent_id,
      value:        row.value,
      type:         row.type,
      typeId:       row.type_id,
      owner:        row.owner,
      license:      row.license,
      visibility:   row.visibility,
      aspect:       row.aspect,
      sortOrder:    row.sort_order,
      confidence:   row.confidence,
      status:       row.status,
      tags:         JSON.parse(row.tags || '[]'),
      createdAt:    row.created_at,
      modifiedAt:   row.modified_at,
      createdBy:    row.created_by,
      modifiedBy:   row.modified_by,
      completedAt:  row.completed_at,
      dueAt:        row.due_at,
      expiresAt:    row.expires_at,
      deletedAt:    row.deleted_at,
      connectorId:       row.connector_id,
      materialized:      row.materialized === null ? null : (row.materialized === 0 ? false : true),
      cachedAt:          row.cached_at,
      sourceSystem:      row.source_system ?? null,
      sourceExternalId:  row.source_external_id ?? null,
    };
    if (row.icon) item.icon = row.icon;
    return item;
  }

  _itemToCols(item) {
    return {
      id:           item.id,
      spec_version: item.specVersion || specVersion,
      parent_id:    item.parentId ?? null,
      path:         item._path ?? null,
      value:        item.value ?? null,
      type:         item.type,
      type_id:      item.typeId ?? null,
      owner:        item.owner ?? null,
      license:      item.license ?? null,
      visibility:   item.visibility || 'private',
      aspect:       item.aspect ?? null,
      sort_order:   item.sortOrder ?? 0,
      confidence:   item.confidence ?? null,
      status:       item.status ?? null,
      tags:         JSON.stringify(item.tags || []),
      icon:         item.icon ?? null,
      created_at:   item.createdAt,
      modified_at:  item.modifiedAt,
      created_by:   item.createdBy ?? null,
      modified_by:  item.modifiedBy ?? null,
      completed_at: item.completedAt ?? null,
      due_at:       item.dueAt ?? null,
      expires_at:   item.expiresAt ?? null,
      deleted_at:   item.deletedAt ?? null,
      connector_id:       item.connectorId ?? null,
      materialized:       item.materialized === null || item.materialized === undefined
        ? null
        : (item.materialized ? 1 : 0),
      cached_at:          item.cachedAt ?? null,
      source_system:      item.sourceSystem ?? null,
      source_external_id: item.sourceExternalId ?? null,
    };
  }

  // ─── Synthetic node helpers ────────────────────────────────────────────────

  _isSyntheticId(id) { return typeof id === 'string' && id.includes('__'); }

  _parseSyntheticId(id) {
    const sep = id.indexOf('__');
    return { realId: id.slice(0, sep), fieldPath: id.slice(sep + 2) };
  }

  _toTitleCase(key) {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
  }

  _buildSyntheticNode(realId, parentId, key, val, fieldPath, sortOrder) {
    const isObj  = val !== null && typeof val === 'object' && !Array.isArray(val);
    const isNull = val === null || val === undefined;
    return {
      id: `${realId}__${fieldPath}`, parentId,
      value: this._toTitleCase(key), type: 'object', typeId: null,
      owner: null, license: null, sortOrder,
      confidence: null, status: null, tags: [],
      createdAt: null, modifiedAt: null, createdBy: null, modifiedBy: null,
      cachedAt: null, expiresAt: null, deletedAt: null, connectorId: null,
      materialized: null, completedAt: null, dueAt: null,
      _synthetic: true, _fieldPath: fieldPath, _realId: realId,
      childCount: isNull ? 0 : isObj ? Object.keys(val).length : 1,
    };
  }

  _buildValueLeaf(realId, parentFieldPath, val) {
    const isArr   = Array.isArray(val);
    const parentId = parentFieldPath ? `${realId}__${parentFieldPath}` : realId;
    return {
      id: `${realId}__${parentFieldPath}.__`, parentId,
      value: isArr ? val.join(', ') : String(val ?? ''),
      type: 'object', typeId: null, owner: null, license: null, sortOrder: 0,
      confidence: null, status: null, tags: [],
      createdAt: null, modifiedAt: null, createdBy: null, modifiedBy: null,
      cachedAt: null, expiresAt: null, deletedAt: null, connectorId: null,
      materialized: null, completedAt: null, dueAt: null,
      _synthetic: true, _fieldPath: `${parentFieldPath}.__`, _realId: realId,
      childCount: 0,
    };
  }

  _buildSyntheticChildren(realId, obj, parentId, prefix = '') {
    return Object.entries(obj).map(([key, val], i) => {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      return this._buildSyntheticNode(realId, parentId, key, val, fieldPath, i);
    });
  }

  // ─── Link extraction ───────────────────────────────────────────────────────

  _parseLinks(value) {
    if (!value || typeof value !== 'string') return [];
    const links = new Set();
    const re    = new RegExp(LINK_SOURCE, 'g');
    let m;
    while ((m = re.exec(value)) !== null) links.add(m[1]);
    return [...links];
  }

  // ─── History ───────────────────────────────────────────────────────────────

  _snapshot(item, changeType, changedBy, now) {
    this._openDb().prepare(
      'INSERT INTO history (item_id, change_type, snapshot, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)'
    ).run(
      item.id, changeType,
      JSON.stringify({ ...item, snapshotAt: now.toISOString(), changedBy, changeType }),
      now.toISOString(), changedBy,
    );
  }

  // ─── Well-known root nodes ─────────────────────────────────────────────────

  _createWellKnownNode(id, parentId, type, sortOrder) {
    const now   = new Date();
    const owner = this.config.owner;
    const item  = {
      id, specVersion, parentId,
      value: type === 'data_root' ? "Your name or organisation's name here" : type,
      type, typeId: null, owner, license: DEFAULT_LICENSE, visibility: 'private',
      aspect: null, sortOrder, confidence: null, status: null, tags: [],
      createdAt: now.toISOString(), modifiedAt: now.toISOString(),
      createdBy: owner, modifiedBy: owner,
      cachedAt: null, expiresAt: null, deletedAt: null,
      connectorId: null, materialized: null, completedAt: null, dueAt: null,
    };
    // Root node is its own parent — path = just its own id.
    const parentPath = id === parentId ? null : this._getPath(parentId);
    item._path = parentPath != null ? `${parentPath}/${id}` : id;

    const cols = this._itemToCols(item);
    const keys = Object.keys(cols);
    this._openDb().prepare(
      `INSERT INTO items (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    ).run(...Object.values(cols));
    this._snapshot(item, 'create', owner, now);
    return item;
  }

  _initRoots() {
    if (!this.get(ROOT_ID)) this._createWellKnownNode(ROOT_ID, ROOT_ID, 'root', 0);
    const existing = this.children(ROOT_ID).map(c => c.type);
    WELL_KNOWN_ORDER.forEach((type, i) => {
      if (!existing.includes(type)) this._createWellKnownNode(crypto.randomUUID(), ROOT_ID, type, i);
    });
    this._loadRoots();
  }

  _loadRoots() {
    const rootItem = this.get(ROOT_ID);
    const children = this.children(ROOT_ID);
    this._roots = { root: rootItem };
    for (const c of children) {
      if (WELL_KNOWN_TYPES.has(c.type)) this._roots[c.type] = c;
    }
  }

  _getRoots() {
    if (!this._roots) this._loadRoots();
    return this._roots;
  }

  getRoot()     { return this._getRoots().root; }
  getDataRoot() { return this._getRoots().data_root || null; }

  _assertEditable(item, id) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (item.type !== 'data_root' && (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID))
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be modified`);
  }

  _assertDeletable(item, id) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID)
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be deleted`);
  }

  // ─── Item CRUD ─────────────────────────────────────────────────────────────

  create({
    parentId, value = null, type = 'string', typeId = null,
    owner, license = null, sortOrder, confidence = null, status = null, tags = [],
    createdBy, objectData = null, dueAt = null, visibility = 'private', aspect = null,
    strict,
  } = {}) {
    if (WELL_KNOWN_TYPES.has(type))
      throw new Error(`Type '${type}' is a well-known root type and cannot be created via create()`);

    if (parentId == null) {
      const dr = this.getDataRoot();
      if (!dr) throw new Error('Datastore not initialised: data_root not found.');
      parentId = dr.id;
    }

    const id       = crypto.randomUUID();
    const now      = new Date();
    const ownerVal = owner || this.config.owner;
    const actor    = createdBy || ownerVal;

    if (sortOrder == null) {
      const siblings = this.children(parentId, aspect);
      sortOrder = siblings.length === 0 ? 0 : Math.max(...siblings.map(s => s.sortOrder)) + 1;
    }

    const item = {
      id, specVersion, parentId, value, type,
      typeId: type === 'object' ? (typeId || null) : null,
      owner: ownerVal, license: license ?? DEFAULT_LICENSE,
      visibility, aspect, sortOrder, confidence, status,
      tags: [...tags],
      createdAt: now.toISOString(), modifiedAt: now.toISOString(),
      createdBy: actor, modifiedBy: actor,
      cachedAt: null, expiresAt: null, deletedAt: null,
      connectorId: null, materialized: null, completedAt: null, dueAt,
      sourceSystem: null, sourceExternalId: null,
    };

    let typeWarning = null;
    if (type === 'object' && typeId && this._getTypeName(typeId) === null)
      typeWarning = this._guardTypeIdRef(typeId, strict);

    // Resolve icon from type schema
    let resolvedIcon = null;
    if (type === 'object' && typeId) {
      const tr = this._openDb().prepare('SELECT schema_json FROM type_defs WHERE id = ?').get(typeId);
      if (tr) {
        const schema = JSON.parse(tr.schema_json || '{}');
        resolvedIcon = schema?.meta?.icon || null;
      }
    }

    const resolvedObjectData = (type === 'object' && typeId) ? (objectData ?? {}) : null;

    // Materialized path: parent's path + "/" + this id.
    const parentPath = this._getPath(parentId);
    item._path = parentPath != null ? `${parentPath}/${id}` : id;

    const db = this._openDb();
    db.transaction(() => {
      const cols = this._itemToCols({ ...item, icon: resolvedIcon });
      // object_data is already null in cols; overwrite if needed
      cols.object_data = resolvedObjectData !== null ? JSON.stringify(resolvedObjectData) : null;
      const keys = Object.keys(cols);
      db.prepare(
        `INSERT INTO items (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
      ).run(...Object.values(cols));

      for (const link of this._parseLinks(value))
        db.prepare('INSERT OR IGNORE INTO backlinks (source_id, target_id) VALUES (?, ?)').run(id, link);
      for (const tag of tags)
        db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)').run(id, tag);

      this._snapshot(item, 'create', actor, now);
    })();

    if (typeWarning)
      Object.defineProperty(item, 'warning', { value: typeWarning, enumerable: false, configurable: true });

    return item;
  }

  get(id) {
    if (this._isSyntheticId(id)) {
      const { realId, fieldPath } = this._parseSyntheticId(id);
      const obj = this.readObjectJson(realId);
      if (!obj) return null;

      if (fieldPath.endsWith('.__')) {
        const parentPath = fieldPath.slice(0, -3);
        const parts = parentPath ? parentPath.split('.') : [];
        let cur = obj;
        for (const p of parts) {
          if (!cur || typeof cur !== 'object') return null;
          cur = cur[p];
        }
        if (cur === undefined || cur === null) return null;
        return this._buildValueLeaf(realId, parentPath, cur);
      }

      const parts = fieldPath.split('.');
      let cur = obj;
      for (const p of parts.slice(0, -1)) {
        if (!cur || typeof cur !== 'object') return null;
        cur = cur[p];
      }
      const key = parts[parts.length - 1];
      const val = cur?.[key];
      if (val === undefined) return null;
      const parentFieldPath = parts.slice(0, -1).join('.');
      const parentId = parentFieldPath ? `${realId}__${parentFieldPath}` : realId;
      return this._buildSyntheticNode(realId, parentId, key, val, fieldPath, 0);
    }

    const row = this._openDb().prepare('SELECT * FROM items WHERE id = ?').get(id);
    return this._rowToItem(row);
  }

  resolveAlias(alias) {
    const row = this._openDb().prepare('SELECT target_id FROM aliases WHERE alias = ?').get(alias);
    return row ? row.target_id : null;
  }

  resolve(idOrAlias) {
    if (UUID_RE.test(idOrAlias)) return this.get(idOrAlias);
    const id = this.resolveAlias(idOrAlias);
    return id ? this.get(id) : null;
  }

  update(id, changes, actor, { strict } = {}) {
    const current = this.get(id);
    this._assertEditable(current, id);

    let prospectiveTypeId;
    if ('type' in changes && changes.type !== current.type)
      prospectiveTypeId = changes.type === 'object' ? (changes.typeId || null) : null;
    else if ('typeId' in changes && current.type === 'object')
      prospectiveTypeId = changes.typeId;

    let typeWarning = null;
    if (prospectiveTypeId && prospectiveTypeId !== current.typeId && this._getTypeName(prospectiveTypeId) === null)
      typeWarning = this._guardTypeIdRef(prospectiveTypeId, strict);

    actor = actor || this.config.owner;
    const now = new Date();

    const updated = { ...current };

    const oldLinks = this._parseLinks(current.value);
    const newLinks = 'value' in changes ? this._parseLinks(changes.value) : oldLinks;
    if ('value' in changes)     updated.value      = changes.value;
    if ('parentId' in changes)  updated.parentId   = changes.parentId;
    if ('sortOrder' in changes) updated.sortOrder  = changes.sortOrder;
    if ('confidence' in changes) updated.confidence = changes.confidence;
    if ('status' in changes)    updated.status     = changes.status;
    if ('license' in changes)   updated.license    = changes.license;
    if ('visibility' in changes) updated.visibility = changes.visibility;
    if ('aspect' in changes)    updated.aspect     = changes.aspect;
    if ('cachedAt' in changes)  updated.cachedAt   = changes.cachedAt;
    if ('expiresAt' in changes) updated.expiresAt  = changes.expiresAt;
    if ('connectorId' in changes) updated.connectorId = changes.connectorId;
    if ('materialized' in changes) updated.materialized = changes.materialized;
    if ('completedAt' in changes) updated.completedAt = changes.completedAt;
    if ('dueAt' in changes)     updated.dueAt      = changes.dueAt;
    if ('deletedAt' in changes)       updated.deletedAt       = changes.deletedAt;
    if ('tags' in changes)            updated.tags            = changes.tags;
    if ('sourceSystem' in changes)    updated.sourceSystem    = changes.sourceSystem;
    if ('sourceExternalId' in changes) updated.sourceExternalId = changes.sourceExternalId;

    if ('type' in changes && changes.type !== current.type) {
      updated.type   = changes.type;
      updated.typeId = changes.type === 'object' ? (changes.typeId || null) : null;
    } else if ('typeId' in changes && updated.type === 'object') {
      updated.typeId = changes.typeId;
    }

    updated.modifiedAt = now.toISOString();
    updated.modifiedBy = actor;

    const db = this._openDb();
    db.transaction(() => {
      this._snapshot(current, 'update', actor, now);

      // Update icon if typeId changed
      let newIcon = current.icon || null;
      if (updated.typeId && updated.typeId !== current.typeId) {
        const tr = db.prepare('SELECT schema_json FROM type_defs WHERE id = ?').get(updated.typeId);
        if (tr) {
          const schema = JSON.parse(tr.schema_json || '{}');
          newIcon = schema?.meta?.icon || null;
        }
      }

      // Backlink maintenance
      for (const l of oldLinks) if (!newLinks.includes(l)) db.prepare('DELETE FROM backlinks WHERE source_id = ? AND target_id = ?').run(id, l);
      for (const l of newLinks) if (!oldLinks.includes(l)) db.prepare('INSERT OR IGNORE INTO backlinks (source_id, target_id) VALUES (?, ?)').run(id, l);

      // Tag maintenance
      if ('tags' in changes) {
        const oldTags = current.tags || [];
        const newTags = changes.tags;
        for (const t of oldTags) if (!newTags.includes(t)) db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag = ?').run(id, t);
        for (const t of newTags) if (!oldTags.includes(t)) db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)').run(id, t);
      }

      // Materialized path — cascade if parent changed
      let newPath = this._getPath(id);
      if ('parentId' in changes && changes.parentId !== current.parentId) {
        const parentPath = this._getPath(changes.parentId);
        newPath = parentPath != null ? `${parentPath}/${id}` : id;
        this._cascadePathUpdate(db, id, newPath);
      }

      const cols = this._itemToCols({ ...updated, icon: newIcon, _path: newPath });
      const setClauses = Object.keys(cols).filter(k => k !== 'id').map(k => `${k} = ?`).join(', ');
      const vals       = Object.entries(cols).filter(([k]) => k !== 'id').map(([, v]) => v);
      db.prepare(`UPDATE items SET ${setClauses} WHERE id = ?`).run(...vals, id);
    })();

    if (typeWarning)
      Object.defineProperty(updated, 'warning', { value: typeWarning, enumerable: false, configurable: true });

    return updated;
  }

  deleteWarnings(id) {
    const bl   = this.backlinks(id);
    const rels = this.relationships(id);
    const w    = [];
    if (bl.length)                    w.push(`${bl.length} item(s) link to this via [[uuid]] syntax`);
    if ((rels.inbound || []).length)  w.push(`${rels.inbound.length} inbound relationship(s) point to this item`);
    return w;
  }

  delete(id, actor) {
    if (this._isSyntheticId(id)) return { warnings: [] };
    const item = this.get(id);
    this._assertDeletable(item, id);
    actor = actor || this.config.owner;
    const now      = new Date();
    const warnings = this.deleteWarnings(id);

    const db = this._openDb();
    db.transaction(() => {
      this._snapshot(item, 'delete', actor, now);
      db.prepare('DELETE FROM item_tags   WHERE item_id = ?').run(id);
      db.prepare('DELETE FROM backlinks   WHERE source_id = ? OR target_id = ?').run(id, id);
      db.prepare('DELETE FROM relationships WHERE source_id = ? OR target_id = ?').run(id, id);
      db.prepare('DELETE FROM items       WHERE id = ?').run(id);
    })();

    return { warnings };
  }

  softDelete(id, actor) {
    const item = this.get(id);
    this._assertEditable(item, id);
    actor = actor || this.config.owner;
    const now = new Date();
    const db  = this._openDb();
    db.transaction(() => {
      this._snapshot(item, 'soft-delete', actor, now);
      db.prepare('UPDATE items SET deleted_at = ?, modified_at = ?, modified_by = ? WHERE id = ?')
        .run(now.toISOString(), now.toISOString(), actor, id);
    })();
    return { ...item, deletedAt: now.toISOString(), modifiedAt: now.toISOString(), modifiedBy: actor };
  }

  restore(id, actor) {
    const item = this.get(id);
    if (!item) throw new Error(`Item not found: ${id}`);
    actor = actor || this.config.owner;
    const now = new Date();
    const db  = this._openDb();
    db.transaction(() => {
      this._snapshot(item, 'restore', actor, now);
      db.prepare('UPDATE items SET deleted_at = NULL, modified_at = ?, modified_by = ? WHERE id = ?')
        .run(now.toISOString(), actor, id);
    })();
    return { ...item, deletedAt: null, modifiedAt: now.toISOString(), modifiedBy: actor };
  }

  // ─── JSON sidecars (stored in columns) ────────────────────────────────────

  readObjectJson(id) {
    if (this._isSyntheticId(id)) return null;
    const row = this._openDb().prepare('SELECT object_data FROM items WHERE id = ?').get(id);
    if (!row || row.object_data == null) return null;
    return JSON.parse(row.object_data);
  }

  writeObjectJson(id, data) {
    this._openDb().prepare('UPDATE items SET object_data = ? WHERE id = ?').run(JSON.stringify(data), id);
  }

  readFunctionJson(id) {
    if (this._isSyntheticId(id)) return null;
    const row = this._openDb().prepare('SELECT function_data FROM items WHERE id = ?').get(id);
    if (!row || row.function_data == null) return null;
    return JSON.parse(row.function_data);
  }

  writeFunctionJson(id, data) {
    this._openDb().prepare('UPDATE items SET function_data = ? WHERE id = ?').run(JSON.stringify(data), id);
  }

  // ─── Connector queries ────────────────────────────────────────────────────

  // All stub items (materialized=false) managed by a specific connector.
  listStubs(connectorId) {
    const rows = this._openDb()
      .prepare('SELECT * FROM items WHERE connector_id = ? AND materialized = 0 AND deleted_at IS NULL')
      .all(connectorId);
    return rows.map(r => this._rowToItem(r));
  }

  // All connector-managed items whose cached_at is older than beforeAt.
  // Used by ConnectorEngine to drive scheduled refresh.
  listDueForRefresh(beforeAt) {
    const rows = this._openDb()
      .prepare('SELECT * FROM items WHERE connector_id IS NOT NULL AND cached_at < ? AND deleted_at IS NULL')
      .all(beforeAt);
    return rows.map(r => this._rowToItem(r));
  }

  readTimeJson(id) {
    if (this._isSyntheticId(id)) return null;
    const row = this._openDb().prepare('SELECT time_data FROM items WHERE id = ?').get(id);
    if (!row || row.time_data == null) return null;
    return JSON.parse(row.time_data);
  }

  writeTimeJson(id, data) {
    this._openDb().prepare('UPDATE items SET time_data = ? WHERE id = ?').run(JSON.stringify(data), id);
  }

  deleteTimeJson(id) {
    this._openDb().prepare('UPDATE items SET time_data = NULL WHERE id = ?').run(id);
  }

  // ─── File store stubs ──────────────────────────────────────────────────────

  putFile()   { throw new Error('putFile is not supported in sqlite-fs mode'); }
  getFile()   { return null; }
  deleteFile(){}
  listFiles() { return []; }

  // ─── Type definitions ─────────────────────────────────────────────────────

  createType(value, { schema, createdBy, id: explicitId } = {}) {
    if (!value || typeof value !== 'string' || !value.trim()) throw new Error('value is required');
    const id    = explicitId || crypto.randomUUID();
    const now   = new Date();
    const owner = this.config.owner;
    const actor = createdBy || owner;
    const meta  = {
      id, specVersion, parentId: null, value: value.trim(), type: 'type', typeId: null,
      owner, license: null, sortOrder: null, confidence: null, status: null, tags: [],
      createdAt: now.toISOString(), modifiedAt: now.toISOString(),
      createdBy: actor, modifiedBy: actor,
      cachedAt: null, expiresAt: null, deletedAt: null, connectorId: null,
      materialized: null, completedAt: null, dueAt: null,
    };
    const resolvedSchema = schema || {
      meta: {
        icon: '', description: '', details: '', keywords: '', tags: '',
        'ai-instructions': { claude: '' },
      },
      jsonSchema: {
        '$schema': 'http://json-schema.org/draft-07/schema#', '$id': '',
        title: value.trim(), type: 'object', properties: {}, required: [],
        additionalProperties: false,
      },
    };
    this._openDb().prepare(
      'INSERT OR REPLACE INTO type_defs (id, value, schema_json, metadata_json) VALUES (?, ?, ?, ?)'
    ).run(id, value.trim(), JSON.stringify(resolvedSchema), JSON.stringify(meta));
    return { metadata: meta, schema: resolvedSchema };
  }

  readTypeJson(id) {
    const row = this._openDb().prepare('SELECT schema_json FROM type_defs WHERE id = ?').get(id);
    return row ? JSON.parse(row.schema_json) : null;
  }

  writeTypeJson(id, data) {
    this._openDb().prepare('UPDATE type_defs SET schema_json = ? WHERE id = ?').run(JSON.stringify(data), id);
  }

  _getTypeName(typeId) {
    if (!typeId) return null;
    const row = this._openDb().prepare('SELECT value FROM type_defs WHERE id = ?').get(typeId);
    return row ? row.value : null;
  }

  _guardTypeIdRef(typeId, strict) {
    const effectiveStrict = strict !== undefined ? !!strict : !!this.config.strictTypeIds;
    if (effectiveStrict) {
      const err = new Error(`unknown typeId "${typeId}" — no registered type definition`);
      err.name  = 'UnknownTypeError';
      err.code  = 'UNKNOWN_TYPE';
      err.typeId = typeId;
      throw err;
    }
    return `typeId ${typeId} has no type definition — node written anyway; run \`kanecta doctor\``;
  }

  _listTypeDefs() {
    return this._openDb().prepare('SELECT id, value FROM type_defs ORDER BY value').all();
  }

  resolveTypeId(name) {
    if (!name) return { unknown: true };
    if (VALID_TYPES.includes(name)) return { primitive: true };
    for (const def of this._listTypeDefs()) {
      if (def.value === name) return { id: def.id };
    }
    return { unknown: true };
  }

  // ─── Aliases ───────────────────────────────────────────────────────────────

  setAlias(alias, id) {
    this._openDb().prepare('INSERT OR REPLACE INTO aliases (alias, target_id) VALUES (?, ?)').run(alias, id);
  }

  removeAlias(alias) {
    this._openDb().prepare('DELETE FROM aliases WHERE alias = ?').run(alias);
  }

  listAliases() {
    return this._openDb().prepare('SELECT alias, target_id FROM aliases ORDER BY alias').all()
      .map(r => ({ alias: r.alias, targetId: r.target_id }));
  }

  // ─── Annotations ───────────────────────────────────────────────────────────

  annotate(targetId, { author, content, parentAnnotationId = null } = {}) {
    const id  = crypto.randomUUID();
    const now = new Date();
    const ann = {
      id, targetId,
      author: author || this.config.owner,
      content, createdAt: now.toISOString(), parentAnnotationId,
    };
    this._openDb().prepare(
      'INSERT INTO annotations (id, target_id, author, content, created_at, parent_annotation_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, targetId, ann.author, content, ann.createdAt, parentAnnotationId);
    return ann;
  }

  annotations(targetId) {
    return this._openDb()
      .prepare('SELECT * FROM annotations WHERE target_id = ? ORDER BY created_at, id')
      .all(targetId)
      .map(r => ({
        id: r.id, targetId: r.target_id, author: r.author,
        content: r.content, createdAt: r.created_at,
        parentAnnotationId: r.parent_annotation_id,
      }));
  }

  // ─── Relationships ─────────────────────────────────────────────────────────

  get relTypes() {
    const extra = Array.isArray(this.config.relTypes) ? this.config.relTypes : [];
    return [...new Set([...VALID_REL_TYPES, ...extra])];
  }

  addRelTypes(names) {
    const list = (Array.isArray(names) ? names : [names]).map(n => String(n).trim()).filter(Boolean);
    for (const n of list) {
      if (!/^[a-z][a-z0-9-]*$/.test(n))
        throw new Error(`Invalid relationship type name: "${n}" (use a lowercase slug, e.g. "affects")`);
    }
    const cfg     = this.config;
    const builtins = new Set(VALID_REL_TYPES);
    const existing = Array.isArray(cfg.relTypes) ? cfg.relTypes : [];
    cfg.relTypes   = [...new Set([...existing, ...list.filter(n => !builtins.has(n))])];
    this._config   = cfg;
    this._saveConfig();
    return this.relTypes;
  }

  relate(sourceId, type, targetId, { createdBy, note = null } = {}) {
    if (!this.relTypes.includes(type))
      throw new Error(`Invalid relationship type: ${type}. Valid: ${this.relTypes.join(', ')}`);
    const now   = new Date();
    const actor = createdBy || this.config.owner;
    const relId = crypto.randomUUID();
    this._openDb().prepare(
      'INSERT INTO relationships (id, source_id, type, target_id, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(relId, sourceId, type, targetId, note, now.toISOString(), actor);
    return { id: relId, sourceId, targetId, type, createdAt: now.toISOString(), createdBy: actor, note };
  }

  relationships(id) {
    const db  = this._openDb();
    const out = db.prepare('SELECT * FROM relationships WHERE source_id = ?').all(id)
      .map(r => ({ id: r.id, targetId: r.target_id, type: r.type, createdAt: r.created_at, createdBy: r.created_by, note: r.note }));
    const inn = db.prepare('SELECT * FROM relationships WHERE target_id = ?').all(id)
      .map(r => ({ id: r.id, sourceId: r.source_id, type: r.type, createdAt: r.created_at, createdBy: r.created_by, note: r.note }));
    return { outbound: out, inbound: inn };
  }

  backlinks(id) {
    return this._openDb().prepare('SELECT source_id FROM backlinks WHERE target_id = ?').all(id)
      .map(r => r.source_id);
  }

  listRelationships() {
    return this._openDb().prepare('SELECT * FROM relationships ORDER BY created_at').all()
      .map(r => ({ id: r.id, sourceId: r.source_id, targetId: r.target_id, type: r.type, note: r.note, createdAt: r.created_at, createdBy: r.created_by }));
  }

  // ─── History ───────────────────────────────────────────────────────────────

  history(id) {
    return this._openDb()
      .prepare('SELECT * FROM history WHERE item_id = ? ORDER BY changed_at, change_type')
      .all(id)
      .map(r => JSON.parse(r.snapshot));
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  byTag(tag) {
    return this._openDb().prepare('SELECT item_id FROM item_tags WHERE tag = ?').all(tag)
      .map(r => r.item_id);
  }

  byType(typeId) {
    return this._openDb().prepare('SELECT id FROM items WHERE type_id = ?').all(typeId)
      .map(r => r.id);
  }

  // ─── Tree ──────────────────────────────────────────────────────────────────

  loadAll() {
    return this._openDb().prepare('SELECT * FROM items').all().map(r => this._rowToItem(r));
  }

  children(parentId, aspect = null) {
    if (this._isSyntheticId(parentId)) {
      const { realId, fieldPath } = this._parseSyntheticId(parentId);
      if (fieldPath.endsWith('.__')) return [];
      const obj = this.readObjectJson(realId);
      if (!obj) return [];
      const parts = fieldPath.split('.');
      let cur = obj;
      for (const p of parts) {
        if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return [];
        cur = cur[p];
      }
      if (cur === null || cur === undefined) return [];
      if (typeof cur === 'object' && !Array.isArray(cur))
        return this._buildSyntheticChildren(realId, cur, parentId, fieldPath);
      return [this._buildValueLeaf(realId, fieldPath, cur)];
    }

    const db = this._openDb();
    const rows = aspect === null || aspect === undefined
      ? db.prepare('SELECT * FROM items WHERE parent_id = ? AND id != parent_id AND aspect IS NULL ORDER BY sort_order').all(parentId)
      : db.prepare('SELECT * FROM items WHERE parent_id = ? AND id != parent_id AND aspect = ? ORDER BY sort_order').all(parentId, aspect);
    const realChildren = rows.map(r => this._rowToItem(r));

    const obj = this.readObjectJson(parentId);
    if (!obj) return realChildren;
    return [...this._buildSyntheticChildren(parentId, obj, parentId), ...realChildren];
  }

  // Fast subtree read using the materialized path index.
  // Instead of loadAll() + in-memory filter, we do a single indexed SQL range scan:
  //   WHERE path = rootPath OR path LIKE rootPath || '/%'
  // For maxDepth limits we add a depth check in SQL (avoids loading and discarding deep rows).
  // Results are then topologically sorted by parent+sortOrder in JS — the SQL scan is the
  // hot path; the JS sort is O(n log n) on just the subtree, not the full datastore.
  tree(rootId, maxDepth = Infinity) {
    let implicitRoot = false;
    const db = this._openDb();

    if (!rootId) {
      const dr = this.getDataRoot();
      rootId   = dr ? dr.id : null;
      if (!rootId) return [];
      implicitRoot = true;
    }

    // Get the root's materialized path so we can do a prefix scan.
    const rootRow = db.prepare('SELECT path FROM items WHERE id = ?').get(rootId);
    if (!rootRow?.path && !implicitRoot) {
      // No path yet (e.g. item was created without path column); fall back to full scan.
      return this._treeSlow(rootId, maxDepth, implicitRoot);
    }

    const rootPath  = rootRow?.path ?? rootId;
    const rootDepth = (rootPath.match(/\//g) || []).length;

    // Fetch only the subtree — SQL range scan on the path index.
    let rows;
    if (maxDepth === Infinity) {
      rows = db.prepare(
        'SELECT * FROM items WHERE path = ? OR path LIKE ?'
      ).all(rootPath, rootPath + '/%');
    } else {
      // SQLite: count slashes via length(path) - length(replace(path,'/',''))
      rows = db.prepare(
        `SELECT * FROM items WHERE (path = ? OR path LIKE ?)
         AND (length(path) - length(replace(path, '/', ''))) <= ?`
      ).all(rootPath, rootPath + '/%', rootDepth + maxDepth);
    }

    const subtreeItems = rows.map(r => this._rowToItem(r));

    // Build a by-parent map (sorted by sortOrder) and traverse depth-first.
    const byParent = new Map();
    for (const item of subtreeItems) {
      if (item.id === item.parentId) continue;
      if (!byParent.has(item.parentId)) byParent.set(item.parentId, []);
      byParent.get(item.parentId).push(item);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);

    const itemById = new Map(subtreeItems.map(i => [i.id, i]));
    const result   = [];

    const traverse = (id, depth) => {
      if (depth > maxDepth) return;
      if (this._isSyntheticId(id)) {
        const item = this.get(id);
        if (!item) return;
        result.push({ item, depth });
        if (depth < maxDepth) for (const c of this.children(id)) traverse(c.id, depth + 1);
        return;
      }
      const item = itemById.get(id);
      if (!item) return;
      result.push({ item, depth });
      if (depth >= maxDepth) return;
      for (const c of (byParent.get(id) || [])) traverse(c.id, depth + 1);
      const obj = this.readObjectJson(id);
      if (obj) for (const sc of this._buildSyntheticChildren(id, obj, id)) traverse(sc.id, depth + 1);
    };

    if (implicitRoot) {
      for (const c of (byParent.get(rootId) || [])) traverse(c.id, 0);
    } else {
      traverse(rootId, 0);
    }
    return result;
  }

  // Fallback for items missing a path (e.g. migrated datastores).
  _treeSlow(rootId, maxDepth, implicitRoot) {
    const all      = this.loadAll();
    const byParent = new Map();
    for (const item of all) {
      if (item.id === item.parentId) continue;
      if (!byParent.has(item.parentId)) byParent.set(item.parentId, []);
      byParent.get(item.parentId).push(item);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
    const result   = [];
    const traverse = (id, depth) => {
      if (depth > maxDepth) return;
      const item = all.find(i => i.id === id);
      if (!item) return;
      result.push({ item, depth });
      if (depth >= maxDepth) return;
      for (const c of (byParent.get(id) || [])) traverse(c.id, depth + 1);
    };
    if (implicitRoot) {
      for (const c of (byParent.get(rootId) || [])) traverse(c.id, 0);
    } else {
      traverse(rootId, 0);
    }
    return result;
  }

  // Fast ancestor chain for a given item (ordered root → parent, excludes self).
  ancestors(id) {
    const row = this._openDb().prepare('SELECT path FROM items WHERE id = ?').get(id);
    if (!row?.path) return [];
    const segments = row.path.split('/');
    // All segments except the last (which is `id` itself) = ancestor IDs.
    const ancestorIds = segments.slice(0, -1);
    if (!ancestorIds.length) return [];
    const placeholders = ancestorIds.map(() => '?').join(', ');
    const rows = this._openDb().prepare(
      `SELECT * FROM items WHERE id IN (${placeholders})`
    ).all(...ancestorIds);
    const byId = new Map(rows.map(r => [r.id, this._rowToItem(r)]));
    // Return in root-to-parent order (same as path segment order).
    return ancestorIds.map(aid => byId.get(aid)).filter(Boolean);
  }

  // Fast subtree item count — just a COUNT(*) on the path index.
  subtreeCount(rootId) {
    const row = this._openDb().prepare('SELECT path FROM items WHERE id = ?').get(rootId);
    if (!row?.path) return 0;
    const r = this._openDb().prepare(
      'SELECT COUNT(*) AS cnt FROM items WHERE path = ? OR path LIKE ?'
    ).get(row.path, row.path + '/%');
    return r?.cnt ?? 0;
  }

  _evaluatePredicate(fieldValue, op, expectedValue) {
    switch (op) {
      case '=':        return fieldValue === expectedValue;
      case '!=':       return fieldValue !== expectedValue;
      case 'in':
        if (!Array.isArray(expectedValue)) return false;
        return expectedValue.includes(fieldValue);
      case 'contains':
        if (typeof fieldValue === 'string') {
          if (typeof expectedValue === 'string') return fieldValue.toLowerCase().includes(expectedValue.toLowerCase());
          return false;
        } else if (Array.isArray(fieldValue)) {
          return fieldValue.some(v =>
            typeof v === 'string' && typeof expectedValue === 'string'
              ? v.toLowerCase().includes(expectedValue.toLowerCase())
              : v === expectedValue
          );
        }
        return false;
      case '>':        return fieldValue > expectedValue;
      case '<':        return fieldValue < expectedValue;
      default:         return false;
    }
  }

  query({
    type, where, rootId, sort, limit, strictTypes,
    includeDeleted = false, excludeExpired = false, expiredOnly = false,
  } = {}) {
    let items      = this.loadAll();
    let typeWarning = null;

    if (!includeDeleted) items = items.filter(i => i.deletedAt == null);

    const now = new Date().toISOString();
    if (expiredOnly) {
      items = items.filter(i => i.expiresAt != null && i.expiresAt <= now);
    } else if (excludeExpired) {
      items = items.filter(i => i.expiresAt == null || i.expiresAt > now);
    }

    if (rootId) {
      const byP = new Map();
      for (const item of items) {
        if (item.id === item.parentId) continue;
        if (!byP.has(item.parentId)) byP.set(item.parentId, []);
        byP.get(item.parentId).push(item.id);
      }
      const subtree = new Set();
      const walk    = (id) => {
        if (subtree.has(id)) return;
        subtree.add(id);
        for (const c of (byP.get(id) || [])) walk(c);
      };
      walk(rootId);
      items = items.filter(i => subtree.has(i.id));
    }

    if (type) {
      const resolved = this.resolveTypeId(type);
      if (resolved.unknown) {
        if (strictTypes) throw new UnknownTypeError(type);
        typeWarning = `unknown type "${type}" — not a registered type definition; run \`kanecta doctor\``;
        items = [];
      } else if (resolved.id !== undefined) {
        items = items.filter(i => i.type === 'object' && i.typeId === resolved.id);
      } else {
        items = items.filter(i => i.type === type && !(i.type === 'object' && i.typeId));
      }
    }

    const hasWhere = where && Object.keys(where).length > 0;
    items = items.map(item => {
      if (item.type === 'object') return { ...item, objectData: this.readObjectJson(item.id) };
      return item;
    });

    if (hasWhere) {
      items = items.filter(item => {
        if (item.type !== 'object' || !item.objectData) return false;
        for (const [field, predicate] of Object.entries(where)) {
          const fieldValue   = item.objectData[field];
          let op = '=', expectedValue = predicate;
          if (predicate !== null && typeof predicate === 'object' && 'op' in predicate && 'value' in predicate) {
            op = predicate.op; expectedValue = predicate.value;
          }
          if (!this._evaluatePredicate(fieldValue, op, expectedValue)) return false;
        }
        return true;
      });
    }

    if (sort && sort.field) {
      const { field, dir = 'asc' } = sort;
      const isDesc = dir.toLowerCase() === 'desc';
      items.sort((a, b) => {
        let vA = a[field] ?? a.objectData?.[field];
        let vB = b[field] ?? b.objectData?.[field];
        if (vA === undefined || vA === null) return isDesc ? -1 :  1;
        if (vB === undefined || vB === null) return isDesc ?  1 : -1;
        if (vA < vB) return isDesc ?  1 : -1;
        if (vA > vB) return isDesc ? -1 :  1;
        return 0;
      });
    }

    const finalLimit = (limit !== undefined && Number.isInteger(limit) && limit > 0) ? limit
      : limit === undefined ? 50 : 0;
    if (finalLimit > 0) items = items.slice(0, finalLimit);

    if (typeWarning)
      Object.defineProperty(items, 'warning', { value: typeWarning, enumerable: false, configurable: true });

    return items;
  }

  // ─── Index maintenance ─────────────────────────────────────────────────────

  rebuildIndexes() {
    const db  = this._openDb();
    const all = db.prepare('SELECT * FROM items').all().map(r => this._rowToItem(r));
    db.transaction(() => {
      db.prepare('DELETE FROM item_tags').run();
      db.prepare('DELETE FROM backlinks').run();
      const insTag  = db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)');
      const insLink = db.prepare('INSERT OR IGNORE INTO backlinks (source_id, target_id) VALUES (?, ?)');
      for (const item of all) {
        for (const tag  of (item.tags || []))           insTag.run(item.id, tag);
        for (const link of this._parseLinks(item.value)) insLink.run(item.id, link);
      }
    })();
    return all.length;
  }

  // ─── Integrity checks ──────────────────────────────────────────────────────

  checkIntegrity({ checks } = {}) {
    const wanted   = Array.isArray(checks) && checks.length ? new Set(checks) : null;
    const run      = (name) => !wanted || wanted.has(name);
    const findings = [];
    if (run('orphan-type-id')) {
      const cache    = new Map();
      const typeName = (tid) => {
        if (!cache.has(tid)) cache.set(tid, this._getTypeName(tid));
        return cache.get(tid);
      };
      for (const item of this.loadAll()) {
        if (item.type !== 'object' || !item.typeId) continue;
        if (typeName(item.typeId) === null) {
          findings.push({
            check: 'orphan-type-id', severity: 'error',
            nodeId: item.id, typeId: item.typeId,
            message: `object ${item.id} references typeId ${item.typeId}, which has no type definition`,
            fix: 'register the missing type definition, or remove/retype the node',
          });
        }
      }
    }
    return findings;
  }
}

module.exports = {
  SqliteFsAdapter, UnknownTypeError,
  ROOT_ID, TYPES_NODE, WELL_KNOWN_TYPES,
  VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE, DEFAULT_LICENSE,
};
