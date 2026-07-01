'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { version: specVersion, primitiveTypes, builtInTypeItems } = require('@kanecta/specification');
const { WriteGuard } = require('./write-integrity');

// ─── Icons (resolved on read, never stored on the item) ─────────────────────────
// Every item gets a MUI icon slug on read. It is resolved from the item's type:
//   typed object        → its type definition's payload.meta.icon
//   built-in/custom type → that type item's payload.meta.icon (by name)
//   primitive            → a single placeholder slug (refine per-primitive later)
//   reserved root/types  → fixed defaults
// The item.json never carries meta.icon.
const PRIMITIVE_TYPE_SET = new Set(primitiveTypes);
const PRIMITIVE_ICON = 'Stop';
const RESERVED_ICONS = { root: 'Home', types: 'Category' };
const FALLBACK_ICON  = 'Category';

const ROOT_ID    = '00000000-0000-0000-0000-000000000000';
const TYPES_NODE = '11111111-1111-1111-1111-111111111111';
const WELL_KNOWN_TYPES = new Set(['root', 'types']);
const WELL_KNOWN_ORDER = [];

const VALID_TYPES = [
  'string', 'number', 'text', 'heading', 'file', 'symlink', 'url', 'image', 'function',
  'markdown', 'runner', 'object', 'annotation', 'connector', 'schedule',
  'pipeline', 'pipeline-run', 'agent',
  'root',
];
const VALID_CONFIDENCES = ['experimental', 'exploring', 'decided', 'locked', 'low', 'medium', 'high', 'verified'];
const VALID_REL_TYPES = [
  'relates-to', 'depends-on', 'enables', 'contradicts',
  'blocks', 'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes',
];
const UUID_RE      = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LICENSE = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739';
const LINK_SOURCE  = '\\[\\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\]\\]';

// Fixed built-in type-item UUIDs (per specification.adoc §built-in type item UUIDs).
// Metadata items (item_history, activity, alias, relationship, annotation) reference
// these as parentId/typeId so they slot under well-known type buckets in every tree.
const TYPE_ITEM_UUIDS = {
  item_history:        'b81923c7-ecf5-4fef-8588-2d91c3985aea',
  activity:            '2033f23f-f1d6-43bb-b74e-f62e96251df7',
  alias:               '80f95b21-6c51-43b5-bdfb-35aad8991c7a',
  relationship:        '334ea5f6-6bfa-43e5-b77f-5d811642d897',
  'relationship-type': '15861dd7-e54c-4209-bceb-bdd65de4f472',
  annotation:          '8797b002-091a-4289-abf0-850d4b05a743',
};

// Metadata item types: real items (source of truth on disk) that back the derived
// lookup tables (history/aliases/relationships/annotations). They are NEVER stored
// only in index.db. They are excluded from ordinary content traversal — the spec
// calls them "metadata and tree structure, not graph edges".
const METADATA_TYPES = new Set(['item_history', 'activity', 'alias', 'relationship']);

class UnknownTypeError extends Error {
  constructor(typeName) {
    super(`unknown type "${typeName}" — not a registered type definition`);
    this.name     = 'UnknownTypeError';
    this.code     = 'UNKNOWN_TYPE';
    this.typeName = typeName;
  }
}

// ─── SQLite Schema ────────────────────────────────────────────────────────────
// index.db mirrors the five-section item.json format across five tables.
// The filesystem (items/**/*.json) is the source of truth; this is the index.

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous  = NORMAL;

CREATE TABLE IF NOT EXISTS items (
  id           TEXT PRIMARY KEY,
  parent_id    TEXT,
  type         TEXT NOT NULL DEFAULT 'text',
  type_id      TEXT,
  value        TEXT,
  sort_order   REAL NOT NULL DEFAULT 0,
  aspect       TEXT,
  spec_version TEXT NOT NULL DEFAULT '1.4.0',
  path         TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_parent  ON items(parent_id);
CREATE INDEX IF NOT EXISTS idx_items_path    ON items(path);
CREATE INDEX IF NOT EXISTS idx_items_type    ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_type_id ON items(type_id);

CREATE TABLE IF NOT EXISTS items_meta (
  item_id            TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  owner              TEXT,
  owner_domain       TEXT,
  namespace          TEXT,
  copyright_holder   TEXT,
  license            TEXT,
  content_hash       TEXT,
  mirrors            TEXT NOT NULL DEFAULT '[]',
  same_as            TEXT NOT NULL DEFAULT '[]',
  visibility         TEXT NOT NULL DEFAULT 'private',
  confidence         TEXT,
  status             TEXT,
  tags               TEXT NOT NULL DEFAULT '[]',
  template           TEXT,
  created_at         TEXT NOT NULL,
  modified_at        TEXT NOT NULL,
  created_by         TEXT,
  modified_by        TEXT,
  completed_at       TEXT,
  due_at             TEXT,
  expires_at         TEXT,
  deleted_at         TEXT,
  cached_at          TEXT,
  connector_id       TEXT,
  materialized       INTEGER,
  files              TEXT NOT NULL DEFAULT '{}',
  layer              TEXT,
  source_system      TEXT,
  source_external_id TEXT,
  source_run_id      TEXT,
  icon               TEXT
);
CREATE INDEX IF NOT EXISTS idx_meta_deleted   ON items_meta(deleted_at);
CREATE INDEX IF NOT EXISTS idx_meta_expires   ON items_meta(expires_at);
CREATE INDEX IF NOT EXISTS idx_meta_connector ON items_meta(connector_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_source ON items_meta(source_system, source_external_id)
  WHERE source_system IS NOT NULL AND source_external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS items_search (
  item_id                TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  corpus_hash            TEXT,
  embedding_model        TEXT,
  embedding_dimensions   INTEGER,
  embedding_generated_at TEXT
);

CREATE TABLE IF NOT EXISTS items_payload (
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  payload TEXT
);

CREATE TABLE IF NOT EXISTS items_time (
  item_id               TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  key                   TEXT NOT NULL,
  start_at              TEXT,
  end_at                TEXT,
  recurrence_rule       TEXT,
  recurrence_exceptions TEXT NOT NULL DEFAULT '[]',
  next_occurrence_at    TEXT,
  completed_at          TEXT,
  PRIMARY KEY (item_id, key)
);
CREATE INDEX IF NOT EXISTS idx_time_next ON items_time(next_occurrence_at)
  WHERE next_occurrence_at IS NOT NULL;

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
  target_id TEXT NOT NULL,
  item_id   TEXT
);

CREATE TABLE IF NOT EXISTS type_defs (
  id            TEXT PRIMARY KEY,
  value         TEXT NOT NULL,
  schema_json   TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
`;

// ─── Branch layout ─────────────────────────────────────────────────────────────
// Every branch is a complete, self-contained datastore folder:
//
//   .kanecta/
//     config/config.json                  datastore-level config (unchanged)
//     branches/<encoded-name>/
//       items/<2>/<2>/<uuid>/item.json     full item tree for THIS branch
//       index.db                           per-branch derived index (gitignored)
//       branch.json                        { name, fill, upstream, createdAt }
//
// There is no top-level .kanecta/items or .kanecta/index.db; `main` is simply
// branches/main and is no longer special. Creating a branch is a full recursive
// copy of the base branch folder — there are no overlays and no branch_changes.
// The read path reads only the active branch's own folder (it could later become
// an ordered layer-stack for sparse branches, but every branch here is fill:full).

class SqliteFsAdapter {
  constructor(root) {
    this.root      = path.resolve(root);
    this.k         = path.join(this.root, '.kanecta');
    this._db       = null;
    this._dbBranch = null;   // which branch the currently-open _db belongs to
    this._config   = null;
    this._mem      = new Map();
    this._roots    = null;
    this._branch   = 'main';
  }

  // ─── Filesystem helpers ────────────────────────────────────────────────────

  _shard(id) {
    // 2+2 sharding on the raw hex chars of the UUID (hyphens stripped)
    const hex = id.replace(/-/g, '');
    return [hex.slice(0, 2), hex.slice(2, 4)];
  }

  // Root folder of the active branch: .kanecta/branches/<encoded-name>
  _branchRoot(name) {
    return path.join(this.k, 'branches', this._encodeBranchName(name ?? this._branch));
  }

  // The `store` selects which sibling tree under the branch root holds the file:
  //   'items'        — content items (the source of truth, default)
  //   'item-history' — item_history events (write-heavy; kept out of items/)
  //   'activity'     — activity events
  // Keeping history/activity in sibling trees keeps items/ pure, so branchDiff and
  // content traversal (which scan items/) never see them.
  _itemDir(id, store = 'items') {
    const [s1, s2] = this._shard(id);
    return path.join(this._branchRoot(), store, s1, s2, id);
  }

  _itemPath(id, store = 'items') {
    return path.join(this._itemDir(id, store), 'item.json');
  }

  // Read an item.json for the active branch. A full branch is a complete folder,
  // so this reads only its own file. A SPARSE branch layers: its own items/ wins
  // (a local tombstone masks the item → null), otherwise the read falls through
  // to the local upstream branch's file.
  _readItemJson(id, store = 'items') {
    const p = this._itemPath(id, store);
    let localExists = false;
    try {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      localExists = true;
      if (this._isTombstone(doc)) return null;   // masks the upstream item
      return doc;
    } catch { /* no local file — maybe fall through below */ }

    if (!localExists && store === 'items') {
      const up = this._localUpstream();
      if (up) {
        try { return JSON.parse(fs.readFileSync(this._branchItemPath(up, id), 'utf8')); }
        catch { /* not upstream either */ }
      }
    }
    return null;
  }

  // Atomic write: temp file + rename so item.json is never partially written.
  _writeItemJson(id, doc, store = 'items') {
    const dir = this._itemDir(id, store);
    fs.mkdirSync(dir, { recursive: true });
    const p   = this._itemPath(id, store);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  }

  _deleteItemDir(id, store = 'items') {
    const dir = this._itemDir(id, store);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  // ─── Branch filesystem helpers ─────────────────────────────────────────────

  // Branch names encode `/` as `__` for the on-disk directory.
  _encodeBranchName(name) { return name.replace(/\//g, '__'); }

  // ─── Sparse-branch helpers ─────────────────────────────────────────────────
  // A sparse branch stores only its local changes in items/; the rest is read
  // through from an upstream branch. Its branch.json records `fill: 'sparse'`
  // and `upstream`. Deleted upstream items are masked by a tombstone item.json
  // (a doc with `tombstone: true`) in the local items/ tree.

  _branchManifest(name) {
    const n = name ?? this._branch;
    try { return JSON.parse(fs.readFileSync(path.join(this._branchRoot(n), 'branch.json'), 'utf8')); }
    catch { return { name: n, fill: 'full', upstream: null }; }
  }

  _isSparse(name) { return this._branchManifest(name).fill === 'sparse'; }

  // The LOCAL full branch a sparse branch reads through to. Remote upstreams are
  // federated at query time (deferred) and return null here. Full branches too.
  _localUpstream(name) {
    const m = this._branchManifest(name ?? this._branch);
    if (m.fill !== 'sparse' || !m.upstream) return null;
    if (m.upstream.remote) return null;
    return m.upstream.branch ?? m.base ?? 'main';
  }

  _isTombstone(doc) { return !!doc && doc.tombstone === true; }

  _makeTombstone(id, parentId, actor, now) {
    return {
      tombstone: true,
      item:      { id, parentId: parentId ?? null },
      deletedAt: (now instanceof Date ? now : new Date()).toISOString(),
      deletedBy: actor ?? null,
    };
  }

  // The on-disk item.json path for `id` in a specific branch's items/ tree.
  _branchItemPath(branch, id, store = 'items') {
    const [s1, s2] = this._shard(id);
    return path.join(this._branchRoot(branch), store, s1, s2, id, 'item.json');
  }

  // Walk every item.json under items/ (or a custom dir).
  * _scanItemFiles(baseDir) {
    if (!fs.existsSync(baseDir)) return;
    for (const s1 of fs.readdirSync(baseDir).sort()) {
      const d1 = path.join(baseDir, s1);
      if (!fs.statSync(d1).isDirectory()) continue;
      for (const s2 of fs.readdirSync(d1).sort()) {
        const d2 = path.join(d1, s2);
        if (!fs.statSync(d2).isDirectory()) continue;
        for (const uuid of fs.readdirSync(d2).sort()) {
          const itemJson = path.join(d2, uuid, 'item.json');
          if (fs.existsSync(itemJson)) yield itemJson;
        }
      }
    }
  }

  // ─── Write integrity (lock + write-ahead journal) ───────────────────────────
  //
  // Every mutation runs inside _withWrite: it takes the branch's cross-process
  // lock, journals the write-ahead intent (with pre-images for rollback), runs
  // the mutation, marks the authoritative data done, then commits and releases.
  // A crash leaves the journal behind; _recover (run on open and on branch
  // switch) rolls forward (rebuild the derived index) if the data landed, or
  // rolls back to the pre-images if it did not. index.db being 100% derived is
  // what makes roll-forward a simple rebuild.

  _guard(branch) { return new WriteGuard(this._branchRoot(branch)); }

  _withWrite(ops, fn) {
    const guard = this._guard();
    guard.acquire();
    try {
      const recs = ops.map(o => ({
        id: o.id, store: o.store || 'items',
        preImage: this._readItemJson(o.id, o.store || 'items'),
      }));
      guard.begin({ branch: this._branch, ops: recs });
      let result;
      try {
        result = fn();
      } catch (e) {
        this._rollback(recs);          // undo any partial L0 writes
        guard.commit();
        throw e;
      }
      guard.markL0Done();              // data fully on disk → recovery rolls forward
      guard.commit();
      return result;
    } finally {
      guard.release();
    }
  }

  // Restore each op's item.json to its pre-image (or delete it if it was created).
  _rollback(opRecs) {
    for (const op of opRecs) {
      if (op.preImage == null) this._deleteItemDir(op.id, op.store);
      else                     this._writeItemJson(op.id, op.preImage, op.store);
    }
  }

  // Resolve a leftover journal/lock for the active branch. Safe to call repeatedly.
  _recover() {
    const guard = this._guard();
    const j = guard.read();
    if (j) {
      // Roll forward if the data fully landed; otherwise roll back to pre-images.
      if (j.phase !== 'l0-done') this._rollback(j.ops || []);
      this._mem.clear();
      this.rebuildIndexes();           // derived index ⇐ filesystem (items/ + item-history/)
      guard.commit();
    }
    guard.clearStaleLock();
  }

  // ─── DB lifecycle ──────────────────────────────────────────────────────────

  // Open (lazily) the index.db for the ACTIVE branch. The DB is cached per
  // branch: when the active branch changes, the previously-open DB is closed and
  // the new branch's index.db is opened. index.db is 100% derived — if it is
  // empty or missing it is rebuilt by scanning the branch's items/ tree.
  _openDb() {
    if (this._db && this._dbBranch === this._branch) return this._db;
    if (this._db) { try { this._db.close(); } catch {} this._db = null; }

    const branchRoot = this._branchRoot();
    fs.mkdirSync(branchRoot, { recursive: true });
    const dbPath = path.join(branchRoot, 'index.db');

    this._db = new Database(dbPath);
    this._db.exec(SCHEMA_SQL);
    this._dbBranch = this._branch;

    // Rebuild if the index is empty (fresh clone, deleted index.db, new copy).
    const cnt = this._db.prepare('SELECT COUNT(*) AS n FROM items').get();
    if (!cnt || cnt.n === 0) {
      if (this._isSparse())                                     this._rebuildFromFsSparse(this._db);
      else if (fs.existsSync(path.join(branchRoot, 'items')))   this._rebuildFromFs(this._db);
    }
    return this._db;
  }

  static isDatastore(root) {
    return fs.existsSync(path.join(root, '.kanecta', 'branches', 'main', 'items'));
  }

  static init(root, owner) {
    const k        = path.join(root, '.kanecta');
    const mainRoot = path.join(k, 'branches', 'main');
    fs.mkdirSync(path.join(mainRoot, 'items'), { recursive: true });
    // Ignore the derived index at any depth (one per branch).
    fs.writeFileSync(path.join(k, '.gitignore'), 'index.db\n', 'utf8');

    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(mainRoot, 'branch.json'),
      JSON.stringify({ name: 'main', fill: 'full', upstream: null, createdAt: now }, null, 2),
      'utf8',
    );

    const adapter     = new SqliteFsAdapter(root);
    const rootPayload = {
      owner, specVersion: '1.4.0', itemHistory: 'EXTERNAL', activity: 'NONE',
    };

    const rootDoc = adapter._buildDoc(
      { id: ROOT_ID, parentId: ROOT_ID, type: 'root', typeId: null, value: 'root', sortOrder: 0, aspect: null },
      { specVersion: '1.4.0', owner, license: DEFAULT_LICENSE, visibility: 'private', confidence: null, status: null, tags: [], createdAt: now, modifiedAt: now, createdBy: owner, modifiedBy: owner, completedAt: null, dueAt: null, expiresAt: null, deletedAt: null, cachedAt: null, connectorId: null, materialized: null, files: {}, layer: 'system', sourceSystem: null, sourceExternalId: null },
      rootPayload, null, null,
    );
    adapter._writeItemJson(ROOT_ID, rootDoc);
    adapter._config = { owner, specVersion: '1.4.0' };

    const db = adapter._openDb();
    adapter._insertIndexTx(db, ROOT_ID, rootDoc, ROOT_ID);

    adapter._initRoots();
    adapter.create({ value: 'Welcome to Kanecta!', type: 'text', owner });
    return adapter;
  }

  static open(root) {
    if (!SqliteFsAdapter.isDatastore(root)) throw new Error(`Not a Kanecta datastore: ${root}`);
    const adapter = new SqliteFsAdapter(root);
    // _openDb rebuilds the active branch's index from its items/ if empty.
    adapter._openDb();
    // Resolve any write-ahead journal/lock left by a crashed writer before
    // serving anything (roll forward if the data landed, else roll back).
    adapter._recover();
    // Backfill the built-in type items on datastores created before they existed
    // (idempotent — a no-op once present), so icon resolution always has them.
    adapter._ensureBuiltInTypes();
    adapter._loadRoots();
    return adapter;
  }

  // ─── Config (lives in root item's payload) ─────────────────────────────────

  get config() {
    if (this._config) return this._config;
    const doc = this._readItemJson(ROOT_ID);
    if (!doc) throw new Error(`Not a Kanecta datastore: ${this.root}`);
    const p = doc.payload || {};
    this._config = {
      owner:        p.owner     || doc.meta?.owner || 'unknown',
      specVersion:  p.specVersion || '1.4.0',
      relTypes:     Array.isArray(p.relTypes) ? p.relTypes : [],
      strictTypeIds: p.strictTypeIds || false,
      itemHistory:  p.itemHistory || 'NONE',
      activity:     p.activity   || 'NONE',
    };
    return this._config;
  }

  _saveConfig() {
    const doc = this._readItemJson(ROOT_ID);
    if (!doc) return;
    doc.payload = { ...(doc.payload || {}), ...this._config };
    doc.meta.modifiedAt = new Date().toISOString();
    this._writeItemJson(ROOT_ID, doc);
    const db = this._openDb();
    const payloadStr = JSON.stringify(doc.payload);
    const row = db.prepare('SELECT item_id FROM items_payload WHERE item_id = ?').get(ROOT_ID);
    if (row) db.prepare('UPDATE items_payload SET payload = ? WHERE item_id = ?').run(payloadStr, ROOT_ID);
    else     db.prepare('INSERT INTO items_payload (item_id, payload) VALUES (?, ?)').run(ROOT_ID, payloadStr);
    this._mem.delete(ROOT_ID);
  }

  // ─── Document ↔ item conversion ────────────────────────────────────────────

  // Build a five-section doc from separate pieces.
  _buildDoc(itemSection, metaSection, payload, time, search) {
    return { item: itemSection, meta: metaSection, search: search ?? null, payload: payload ?? null, time: time ?? null };
  }

  // Five-section doc → flat item object (what the public API returns).
  _docToItem(doc) {
    if (!doc?.item || !doc?.meta) return null;
    const { item, meta } = doc;
    const out = {
      id:               item.id,
      specVersion:      meta.specVersion || specVersion,
      parentId:         item.parentId,
      value:            item.value ?? null,
      type:             item.type,
      typeId:           item.typeId ?? null,
      owner:            meta.owner ?? null,
      license:          meta.license ?? null,
      visibility:       meta.visibility || 'private',
      aspect:           item.aspect ?? null,
      sortOrder:        item.sortOrder ?? 0,
      confidence:       meta.confidence ?? null,
      status:           meta.status ?? null,
      tags:             Array.isArray(meta.tags) ? meta.tags : [],
      createdAt:        meta.createdAt,
      modifiedAt:       meta.modifiedAt,
      createdBy:        meta.createdBy ?? null,
      modifiedBy:       meta.modifiedBy ?? null,
      completedAt:      meta.completedAt ?? null,
      dueAt:            meta.dueAt ?? null,
      expiresAt:        meta.expiresAt ?? null,
      deletedAt:        meta.deletedAt ?? null,
      cachedAt:         meta.cachedAt ?? null,
      connectorId:      meta.connectorId ?? null,
      materialized:     meta.materialized ?? null,
      layer:            meta.layer ?? null,
      sourceSystem:     meta.sourceSystem ?? null,
      sourceExternalId: meta.sourceExternalId ?? null,
      files:            meta.files ?? {},
    };
    out.icon = this._resolveIcon(out);   // read model: derived icon slug (never stored)
    return out;
  }

  // Flat item object → five-section doc, preserving existing payload/time/search.
  _itemToDoc(item, existingDoc = null) {
    return {
      item: {
        id:        item.id,
        parentId:  item.parentId,
        type:      item.type,
        typeId:    item.typeId ?? null,
        value:     item.value ?? null,
        sortOrder: item.sortOrder ?? 0,
        aspect:    item.aspect ?? null,
      },
      meta: {
        specVersion:      item.specVersion || specVersion,
        owner:            item.owner ?? null,
        license:          item.license ?? null,
        visibility:       item.visibility || 'private',
        confidence:       item.confidence ?? null,
        status:           item.status ?? null,
        tags:             Array.isArray(item.tags) ? item.tags : [],
        createdAt:        item.createdAt,
        modifiedAt:       item.modifiedAt,
        createdBy:        item.createdBy ?? null,
        modifiedBy:       item.modifiedBy ?? null,
        completedAt:      item.completedAt ?? null,
        dueAt:            item.dueAt ?? null,
        expiresAt:        item.expiresAt ?? null,
        deletedAt:        item.deletedAt ?? null,
        cachedAt:         item.cachedAt ?? null,
        connectorId:      item.connectorId ?? null,
        materialized:     item.materialized ?? null,
        files:            item.files ?? {},
        layer:            item.layer ?? null,
        sourceSystem:     item.sourceSystem ?? null,
        sourceExternalId: item.sourceExternalId ?? null,
      },
      search:  existingDoc?.search  ?? null,
      payload: existingDoc?.payload ?? null,
      time:    existingDoc?.time    ?? null,
    };
  }

  // DB row (items JOIN items_meta) → flat item object (the read model).
  _rowToItem(row) {
    if (!row) return null;
    const out = {
      id:               row.id,
      specVersion:      row.spec_version || specVersion,
      parentId:         row.parent_id,
      value:            row.value,
      type:             row.type,
      typeId:           row.type_id ?? null,
      owner:            row.owner ?? null,
      license:          row.license ?? null,
      visibility:       row.visibility || 'private',
      aspect:           row.aspect ?? null,
      sortOrder:        row.sort_order ?? 0,
      confidence:       row.confidence ?? null,
      status:           row.status ?? null,
      tags:             row.tags ? JSON.parse(row.tags) : [],
      createdAt:        row.created_at,
      modifiedAt:       row.modified_at,
      createdBy:        row.created_by ?? null,
      modifiedBy:       row.modified_by ?? null,
      completedAt:      row.completed_at ?? null,
      dueAt:            row.due_at ?? null,
      expiresAt:        row.expires_at ?? null,
      deletedAt:        row.deleted_at ?? null,
      cachedAt:         row.cached_at ?? null,
      connectorId:      row.connector_id ?? null,
      materialized:     row.materialized === null ? null : (row.materialized === 0 ? false : true),
      layer:            row.layer ?? null,
      sourceSystem:     row.source_system ?? null,
      sourceExternalId: row.source_external_id ?? null,
      files:            row.files ? JSON.parse(row.files) : {},
    };
    out.icon = this._resolveIcon(out);   // read model: derived icon slug (never stored)
    return out;
  }

  // ─── Index helpers ─────────────────────────────────────────────────────────

  _insertIndexTx(db, id, doc, itemPath) {
    const { item, meta, search, payload, time } = doc;
    const tags = Array.isArray(meta.tags) ? meta.tags : [];

    db.prepare(`
      INSERT OR REPLACE INTO items (id, parent_id, type, type_id, value, sort_order, aspect, spec_version, path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, item.parentId, item.type, item.typeId ?? null, item.value ?? null,
           item.sortOrder ?? 0, item.aspect ?? null, meta.specVersion || specVersion, itemPath ?? null);

    db.prepare(`
      INSERT OR REPLACE INTO items_meta
        (item_id, owner, license, visibility, confidence, status, tags, created_at, modified_at,
         created_by, modified_by, completed_at, due_at, expires_at, deleted_at, cached_at,
         connector_id, materialized, files, layer, source_system, source_external_id, icon)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, meta.owner ?? null, meta.license ?? null, meta.visibility || 'private',
      meta.confidence ?? null, meta.status ?? null, JSON.stringify(tags),
      meta.createdAt, meta.modifiedAt, meta.createdBy ?? null, meta.modifiedBy ?? null,
      meta.completedAt ?? null, meta.dueAt ?? null, meta.expiresAt ?? null, meta.deletedAt ?? null,
      meta.cachedAt ?? null, meta.connectorId ?? null,
      meta.materialized === null || meta.materialized === undefined ? null : (meta.materialized ? 1 : 0),
      JSON.stringify(meta.files ?? {}), meta.layer ?? null,
      meta.sourceSystem ?? null, meta.sourceExternalId ?? null, meta.icon ?? null,
    );

    if (payload != null) {
      db.prepare('INSERT OR REPLACE INTO items_payload (item_id, payload) VALUES (?, ?)').run(id, JSON.stringify(payload));
    }

    if (search != null) {
      db.prepare(`
        INSERT OR REPLACE INTO items_search (item_id, corpus_hash, embedding_model, embedding_dimensions, embedding_generated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, search.corpusHash ?? null, search.embedding?.model ?? null,
             search.embedding?.dimensions ?? null, search.embedding?.generatedAt ?? null);
    }

    if (time != null) {
      db.prepare('DELETE FROM items_time WHERE item_id = ?').run(id);
      const ins = db.prepare(`
        INSERT INTO items_time (item_id, key, start_at, end_at, recurrence_rule, recurrence_exceptions, next_occurrence_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [key, entry] of Object.entries(time)) {
        if (!entry) continue;
        ins.run(id, key, entry.startAt ?? null, entry.endAt ?? null, entry.recurrenceRule ?? null,
                JSON.stringify(entry.recurrenceExceptions ?? []), entry.nextOccurrenceAt ?? null, entry.completedAt ?? null);
      }
    }

    // Tags and backlinks
    for (const tag of tags)
      db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)').run(id, tag);

    for (const link of this._parseLinks(item.value))
      db.prepare('INSERT OR IGNORE INTO backlinks (source_id, target_id) VALUES (?, ?)').run(id, link);

    // Derived lookup projections for metadata item types. The item.json in items/
    // is the source of truth; these rows are pure projections rebuilt by scanning
    // items/ (so _rebuildFromFs repopulates them for free).
    this._indexMetadataDoc(db, doc);
  }

  // Project an alias/relationship/annotation item.json into its derived lookup
  // table. No-op for ordinary content items.
  _indexMetadataDoc(db, doc) {
    const { item, meta, payload } = doc;
    const p = payload || {};
    if (item.type === 'alias') {
      db.prepare('INSERT OR REPLACE INTO aliases (alias, target_id, item_id) VALUES (?, ?, ?)')
        .run(item.value, p.targetId ?? null, item.id);
    } else if (item.type === 'relationship') {
      db.prepare(
        'INSERT OR REPLACE INTO relationships (id, source_id, type, target_id, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(item.id, p.sourceId ?? null, item.value, p.targetId ?? null,
            p.note ?? null, meta?.createdAt ?? null, meta?.createdBy ?? null);
    } else if (item.type === 'annotation') {
      db.prepare(
        'INSERT OR REPLACE INTO annotations (id, target_id, author, content, created_at, parent_annotation_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(item.id, item.parentId, p.author ?? meta?.createdBy ?? null,
            p.content ?? item.value, meta?.createdAt ?? null, p.parentAnnotationId ?? null);
    } else if (item.type === 'item_history') {
      // 'ITEM' mode: history events live in items/ and are picked up here.
      this._indexHistoryDoc(db, doc);
    }
  }

  // Write a metadata item (alias/relationship/annotation) as a real item.json in
  // items/ — the source of truth — and project it into its derived lookup table.
  // No history snapshot is taken for metadata items.
  _metaItem(fields) {
    const now = new Date().toISOString();
    return this._itemToDoc({
      typeId: null, sortOrder: 0, aspect: null,
      owner: this.config.owner, license: null, visibility: 'private',
      confidence: null, status: null, tags: [],
      createdAt: now, modifiedAt: now,
      createdBy: this.config.owner, modifiedBy: this.config.owner,
      layer: 'system',
      ...fields,
    });
  }

  _writeMetadataItem(doc) {
    const db = this._openDb();
    this._withWrite([{ id: doc.item.id, store: 'items' }], () => {
      this._writeItemJson(doc.item.id, doc);
      db.transaction(() => this._insertIndexTx(db, doc.item.id, doc, doc.item.id))();
      this._mem.delete(doc.item.id);
    });
    return doc;
  }

  // Delete a metadata item: its item.json, its index rows, and its derived-lookup
  // row. Must be called inside a db transaction (or standalone).
  _deleteMetadataItem(db, itemId, type) {
    this._deleteItemDir(itemId);
    db.prepare('DELETE FROM items_meta    WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM items_payload WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM items_search  WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM items_time    WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM item_tags     WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM backlinks     WHERE source_id = ?').run(itemId);
    db.prepare('DELETE FROM items         WHERE id = ?').run(itemId);
    if      (type === 'alias')        db.prepare('DELETE FROM aliases       WHERE item_id = ?').run(itemId);
    else if (type === 'relationship') db.prepare('DELETE FROM relationships WHERE id = ?').run(itemId);
    else if (type === 'annotation')   db.prepare('DELETE FROM annotations   WHERE id = ?').run(itemId);
  }

  // When a content item is deleted, cascade-delete the metadata items that hang
  // off it: relationships in either direction, annotations on it, aliases to it.
  // Keeps the derived tables consistent with items/ after a rebuild.
  _cascadeDeleteMetadata(db, id) {
    for (const r of db.prepare('SELECT id FROM relationships WHERE source_id = ? OR target_id = ?').all(id, id))
      this._deleteMetadataItem(db, r.id, 'relationship');
    for (const a of db.prepare('SELECT id FROM annotations WHERE target_id = ?').all(id))
      this._deleteMetadataItem(db, a.id, 'annotation');
    for (const a of db.prepare('SELECT item_id FROM aliases WHERE target_id = ?').all(id))
      if (a.item_id) this._deleteMetadataItem(db, a.item_id, 'alias');
  }

  _updateIndexMeta(db, id, meta, tags) {
    db.prepare(`
      UPDATE items_meta SET
        owner = ?, license = ?, visibility = ?, confidence = ?, status = ?, tags = ?,
        modified_at = ?, modified_by = ?, completed_at = ?, due_at = ?, expires_at = ?,
        deleted_at = ?, cached_at = ?, connector_id = ?, materialized = ?,
        files = ?, layer = ?, source_system = ?, source_external_id = ?, icon = ?
      WHERE item_id = ?
    `).run(
      meta.owner ?? null, meta.license ?? null, meta.visibility || 'private',
      meta.confidence ?? null, meta.status ?? null, JSON.stringify(tags),
      meta.modifiedAt, meta.modifiedBy ?? null, meta.completedAt ?? null,
      meta.dueAt ?? null, meta.expiresAt ?? null, meta.deletedAt ?? null,
      meta.cachedAt ?? null, meta.connectorId ?? null,
      meta.materialized === null || meta.materialized === undefined ? null : (meta.materialized ? 1 : 0),
      JSON.stringify(meta.files ?? {}), meta.layer ?? null,
      meta.sourceSystem ?? null, meta.sourceExternalId ?? null, meta.icon ?? null,
      id,
    );
  }

  // Full JOIN query for a single item (items + items_meta).
  _getRow(db, id) {
    return db.prepare(`
      SELECT i.*, m.owner, m.license, m.visibility, m.confidence, m.status, m.tags,
             m.created_at, m.modified_at, m.created_by, m.modified_by,
             m.completed_at, m.due_at, m.expires_at, m.deleted_at, m.cached_at,
             m.connector_id, m.materialized, m.files, m.layer,
             m.source_system, m.source_external_id, m.icon
      FROM items i LEFT JOIN items_meta m ON m.item_id = i.id
      WHERE i.id = ?
    `).get(id);
  }

  // ─── Index rebuild from filesystem ────────────────────────────────────────

  _rebuildFromFs(db) {
    const itemsDir = path.join(this._branchRoot(), 'items');
    // First pass: read all item.json files and collect items
    const docs = [];
    for (const jsonPath of this._scanItemFiles(itemsDir)) {
      try {
        const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (doc?.item?.id && !this._isTombstone(doc)) docs.push(doc);
      } catch { /* skip corrupt files */ }
    }
    this._indexDocs(db, docs);
  }

  // Rebuild a SPARSE branch's index by projecting its local upstream (a full
  // local branch) and overlaying the branch's own items/: added/edited item.json
  // files replace the upstream doc; tombstones (deleted_at markers) remove it.
  // The index is thus fully derived from items/ + the local upstream, and the
  // branch's own items/ stays sparse (only its local changes). Remote upstreams
  // are federated at query time instead (deferred).
  _rebuildFromFsSparse(db) {
    const docById = new Map();
    const up = this._localUpstream();
    if (up) {
      const upItemsDir = path.join(this._branchRoot(up), 'items');
      for (const jsonPath of this._scanItemFiles(upItemsDir)) {
        try {
          const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          if (doc?.item?.id && !this._isTombstone(doc)) docById.set(doc.item.id, doc);
        } catch { /* skip corrupt files */ }
      }
    }
    const localItemsDir = path.join(this._branchRoot(), 'items');
    for (const jsonPath of this._scanItemFiles(localItemsDir)) {
      try {
        const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const id  = doc?.item?.id;
        if (!id) continue;
        if (this._isTombstone(doc)) docById.delete(id);
        else                        docById.set(id, doc);
      } catch { /* skip corrupt files */ }
    }
    this._indexDocs(db, [...docById.values()]);
  }

  // Index a resolved set of item docs: compute materialized paths in
  // parent→child order, then insert every row (shared by the full and sparse
  // rebuild paths).
  _indexDocs(db, docs) {
    // Compute materialized paths in parent→child order
    const parentMap = new Map();
    for (const doc of docs) {
      const id = doc.item.id;
      const pid = doc.item.parentId;
      if (id !== pid) {
        if (!parentMap.has(pid)) parentMap.set(pid, []);
        parentMap.get(pid).push(id);
      }
    }
    const docById = new Map(docs.map(d => [d.item.id, d]));
    const paths   = new Map();

    const computePath = (id, parentPath) => {
      const p = parentPath ? `${parentPath}/${id}` : id;
      paths.set(id, p);
      for (const childId of (parentMap.get(id) || [])) computePath(childId, p);
    };
    computePath(ROOT_ID, null);
    // Handle any items not reachable from root (orphans get path = their own id)
    for (const doc of docs) {
      if (!paths.has(doc.item.id)) paths.set(doc.item.id, doc.item.id);
    }

    db.transaction(() => {
      for (const doc of docs) {
        const id = doc.item.id;
        this._insertIndexTx(db, id, doc, paths.get(id) ?? id);
      }
      // Derived lookups whose source of truth lives outside items/.
      this._rebuildHistoryFromFs(db);
    })();
  }

  // ─── History ───────────────────────────────────────────────────────────────

  // History placement is controlled by rootPayload.itemHistory:
  //   'NONE'     → no history is recorded.
  //   'ITEM'     → item_history events are ordinary items in items/.
  //   'EXTERNAL' → item_history events live in the sibling item-history/ tree
  //                (default; keeps items/ and branchDiff lean).
  // Either way the item.json is the source of truth; the SQLite `history` table
  // is a derived projection rebuilt by scanning whichever tree holds them.
  // Returns the store name to write into, or null when history is disabled.
  _historyStore() {
    const mode = this.config?.itemHistory ?? 'EXTERNAL';
    if (mode === 'NONE') return null;
    if (mode === 'ITEM') return 'items';
    return 'item-history';
  }

  // created | updated | deleted — the spec's coarse eventType. The adapter's finer
  // changeType (soft-delete/restore/…) is preserved inside the snapshot.
  _eventType(changeType) {
    if (changeType === 'create')  return 'created';
    if (changeType === 'delete')  return 'deleted';
    return 'updated';
  }

  _nextHistorySeq(db, targetId) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM history WHERE item_id = ?').get(targetId);
    return (row?.n ?? 0) + 1;
  }

  _snapshot(db, item, changeType, changedBy, now) {
    const store = this._historyStore();
    if (!store) return;

    const snapshot = { ...item, snapshotAt: now.toISOString(), changedBy, changeType };
    const histId   = crypto.randomUUID();
    const seq      = this._nextHistorySeq(db, item.id);

    // 1) Source of truth: an item_history item.json in items/ ('ITEM') or the
    //    sibling item-history/ tree ('EXTERNAL').
    const histDoc = this._itemToDoc({
      id: histId, parentId: TYPE_ITEM_UUIDS.item_history, type: 'item_history', typeId: null,
      value: `${changeType} ${item.id}`, sortOrder: seq, aspect: null,
      owner: changedBy ?? null, license: null, visibility: 'private',
      confidence: null, status: null, tags: [],
      createdAt: now.toISOString(), modifiedAt: now.toISOString(),
      createdBy: changedBy ?? null, modifiedBy: changedBy ?? null,
      layer: 'system',
    });
    histDoc.payload = {
      targetId: item.id, eventType: this._eventType(changeType), sequence: seq,
      by: changedBy ?? null, delta: {}, snapshot, changeType,
    };
    this._writeItemJson(histId, histDoc, store);

    // 2) Index so history() works without a rebuild. In 'ITEM' mode the event is
    //    a real item in items/, so index it fully (items table + derived history,
    //    matching how a rebuild scans it); in 'EXTERNAL' mode only the derived
    //    history projection is touched.
    if (store === 'items') this._insertIndexTx(db, histId, histDoc, histId);
    else                   this._indexHistoryDoc(db, histDoc);
  }

  // Upsert the derived `history` row from an item_history item.json. Used both by
  // _snapshot (live) and _rebuildHistoryFromFs (rebuild) so the table is always a
  // pure projection of item-history/.
  _indexHistoryDoc(db, histDoc) {
    const p = histDoc.payload || {};
    const snap = p.snapshot || {};
    db.prepare(
      'INSERT INTO history (item_id, change_type, snapshot, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)'
    ).run(
      p.targetId, p.changeType ?? p.eventType ?? 'updated',
      JSON.stringify(snap),
      snap.snapshotAt ?? histDoc.meta?.createdAt ?? null, p.by ?? null,
    );
  }

  // Rebuild the derived history table by scanning the branch's item-history/ tree.
  _rebuildHistoryFromFs(db) {
    const dir = path.join(this._branchRoot(), 'item-history');
    const docs = [];
    for (const jsonPath of this._scanItemFiles(dir)) {
      try {
        const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (doc?.payload?.targetId) docs.push(doc);
      } catch { /* skip corrupt */ }
    }
    // Insert in chronological order so the AUTOINCREMENT seq preserves order.
    docs.sort((a, b) => String(a.payload.snapshot?.snapshotAt ?? a.meta?.createdAt ?? '')
      .localeCompare(String(b.payload.snapshot?.snapshotAt ?? b.meta?.createdAt ?? '')));
    for (const doc of docs) this._indexHistoryDoc(db, doc);
  }

  // ─── Materialized path helpers ─────────────────────────────────────────────

  _getPath(id) {
    const row = this._openDb().prepare('SELECT path FROM items WHERE id = ?').get(id);
    return row?.path ?? null;
  }

  _pathDepth(p) {
    if (!p) return 0;
    return (p.match(/\//g) || []).length;
  }

  _cascadePathUpdate(db, id, newPath) {
    const oldPath = this._getPath(id);
    db.prepare('UPDATE items SET path = ? WHERE id = ?').run(newPath, id);
    if (oldPath) {
      const oldPrefix = oldPath + '/';
      db.prepare(
        `UPDATE items SET path = ? || '/' || SUBSTR(path, ?) WHERE path LIKE ?`
      ).run(newPath, oldPrefix.length + 1, oldPrefix + '%');
    }
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
      materialized: null, completedAt: null, dueAt: null, files: {}, icon: null,
      _synthetic: true, _fieldPath: fieldPath, _realId: realId,
      childCount: isNull ? 0 : isObj ? Object.keys(val).length : 1,
    };
  }

  _buildValueLeaf(realId, parentFieldPath, val) {
    const isArr    = Array.isArray(val);
    const parentId = parentFieldPath ? `${realId}__${parentFieldPath}` : realId;
    return {
      id: `${realId}__${parentFieldPath}.__`, parentId,
      value: isArr ? val.join(', ') : String(val ?? ''),
      type: 'object', typeId: null, owner: null, license: null, sortOrder: 0,
      confidence: null, status: null, tags: [],
      createdAt: null, modifiedAt: null, createdBy: null, modifiedBy: null,
      cachedAt: null, expiresAt: null, deletedAt: null, connectorId: null,
      materialized: null, completedAt: null, dueAt: null, files: {}, icon: null,
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

  // ─── Well-known root nodes ─────────────────────────────────────────────────

  _createWellKnownNode(id, parentId, type, sortOrder) {
    const now   = new Date();
    const owner = this.config.owner;
    const item  = {
      id, specVersion, parentId,
      value: type,
      type, typeId: null, owner, license: DEFAULT_LICENSE, visibility: 'private',
      aspect: null, sortOrder, confidence: null, status: null, tags: [],
      createdAt: now.toISOString(), modifiedAt: now.toISOString(),
      createdBy: owner, modifiedBy: owner,
      cachedAt: null, expiresAt: null, deletedAt: null, connectorId: null,
      materialized: null, completedAt: null, dueAt: null, files: {}, layer: 'system',
      sourceSystem: null, sourceExternalId: null,
    };

    const parentPath = id === parentId ? null : this._getPath(parentId);
    const itemPath   = parentPath != null ? `${parentPath}/${id}` : id;

    const doc = this._itemToDoc(item);
    this._writeItemJson(id, doc);

    const db = this._openDb();
    db.transaction(() => {
      this._insertIndexTx(db, id, doc, itemPath);
      this._snapshot(db, item, 'create', owner, now);
    })();

    this._mem.set(id, item);
    return item;
  }

  _initRoots() {
    if (!this.get(ROOT_ID))       this._createWellKnownNode(ROOT_ID,    ROOT_ID,    'root',  0);
    if (!this.get(TYPES_NODE))    this._createWellKnownNode(TYPES_NODE, ROOT_ID,    'types', 1);
    this._ensureBuiltInTypes();
    this._loadRoots();
  }

  // Seed the core manifest of built-in type items (relationship, file, alias, …)
  // under the types node, with their fixed UUIDs, from @kanecta/specification.
  // Idempotent: only writes the ones not already present, so it safely backfills
  // existing datastores on open as well as seeding fresh ones at init.
  _ensureBuiltInTypes() {
    const db = this._openDb();
    const typesPath = this._getPath(TYPES_NODE) ?? TYPES_NODE;
    let wrote = false;
    db.transaction(() => {
      for (const src of builtInTypeItems) {
        const id = src.item.id;
        if (this._getRow(db, id)) continue;            // already seeded
        // The spec file is already a 5-section item.json; write it verbatim as the
        // source of truth, then index it under the types node.
        const doc = { item: src.item, meta: src.meta, search: src.search ?? null, payload: src.payload ?? null, time: src.time ?? null };
        this._writeItemJson(id, doc);
        this._insertIndexTx(db, id, doc, `${typesPath}/${id}`);
        wrote = true;
      }
    })();
    if (wrote) { this._iconCache = null; this._mem.clear(); }
  }

  // ─── Icon resolution (derived on read; never stored on the item) ─────────────

  // type-name → icon and typeId → icon, built once from the seeded type items.
  _iconMaps() {
    if (this._iconCache) return this._iconCache;
    const byName = {}, byId = {};
    try {
      const rows = this._openDb().prepare(
        "SELECT i.id, i.value, p.payload FROM items i JOIN items_payload p ON p.item_id = i.id WHERE i.type = 'type'"
      ).all();
      for (const r of rows) {
        let icon; try { icon = JSON.parse(r.payload)?.meta?.icon; } catch {}
        if (typeof icon === 'string' && icon) { byName[r.value] = icon; byId[r.id] = icon; }
      }
    } catch { /* db not ready */ }
    this._iconCache = { byName, byId };
    return this._iconCache;
  }

  // Resolve the MUI icon slug for an item (read model only).
  _resolveIcon(item) {
    if (!item) return FALLBACK_ICON;
    const { byName, byId } = this._iconMaps();
    if (item.typeId && byId[item.typeId]) return byId[item.typeId];       // typed object → its type's icon
    if (byName[item.type]) return byName[item.type];                       // built-in/custom type → its type icon
    if (PRIMITIVE_TYPE_SET.has(item.type)) return PRIMITIVE_ICON;          // primitive → placeholder
    if (RESERVED_ICONS[item.type]) return RESERVED_ICONS[item.type];       // root / types
    return FALLBACK_ICON;
  }

  _loadRoots() {
    const rootItem = this.get(ROOT_ID);
    const children = this.children(ROOT_ID);
    this._roots    = { root: rootItem };
    for (const c of children) {
      if (WELL_KNOWN_TYPES.has(c.type)) this._roots[c.type] = c;
    }
  }

  _getRoots() {
    if (!this._roots) this._loadRoots();
    return this._roots;
  }

  getRoot()     { return this._getRoots().root; }

  // ─── Guard helpers ─────────────────────────────────────────────────────────

  _assertEditable(item, id) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID)
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be modified`);
  }

  _assertDeletable(item, id) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID)
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be deleted`);
  }

  // ─── Item CRUD ─────────────────────────────────────────────────────────────

  // Next sortOrder among REAL content siblings. Excludes synthetic payload-field
  // nodes (they are not rows in `items`), the structural root/types nodes, and
  // metadata/type items — so content items order among themselves from 0 and are
  // never pushed down by, e.g., the root node's rendered payload fields.
  _nextSortOrder(parentId, aspect) {
    const db = this._openDb();
    const noAspect = aspect === null || aspect === undefined;
    const sql = `SELECT MAX(sort_order) AS m FROM items
      WHERE parent_id = ? AND id != parent_id AND aspect ${noAspect ? 'IS NULL' : '= ?'}
        AND type NOT IN ('root','types','alias','relationship','annotation','item_history','type')`;
    const row = noAspect ? db.prepare(sql).get(parentId) : db.prepare(sql).get(parentId, aspect);
    return row?.m == null ? 0 : row.m + 1;
  }

  create({
    parentId, value = null, type = 'string', typeId = null,
    owner, license = null, sortOrder, confidence = null, status = null, tags = [],
    createdBy, objectData = null, dueAt = null, visibility = 'private', aspect = null,
    strict,
  } = {}) {
    if (WELL_KNOWN_TYPES.has(type))
      throw new Error(`Type '${type}' is a well-known root type and cannot be created via create()`);

    if (parentId == null) {
      parentId = ROOT_ID;
    }

    const id       = crypto.randomUUID();
    const now      = new Date();
    const ownerVal = owner || this.config.owner;
    const actor    = createdBy || ownerVal;

    if (sortOrder == null) {
      sortOrder = this._nextSortOrder(parentId, aspect);
    }

    let typeWarning = null;
    if (type === 'object' && typeId && this._getTypeName(typeId) === null)
      typeWarning = this._guardTypeIdRef(typeId, strict);

    const resolvedPayload = (type === 'object' && typeId) ? (objectData ?? {}) : null;

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
      layer: null, sourceSystem: null, sourceExternalId: null, files: {},
    };

    const parentPath = this._getPath(parentId);
    const itemPath   = parentPath != null ? `${parentPath}/${id}` : id;

    const doc = this._itemToDoc(item);
    doc.payload = resolvedPayload;

    // Write file FIRST, then update the active branch's index — under the write
    // lock and journal so a crash can't leave a half-applied create.
    this._withWrite([{ id, store: 'items' }], () => {
      this._writeItemJson(id, doc);
      const db = this._openDb();
      db.transaction(() => {
        this._insertIndexTx(db, id, doc, itemPath);
        this._snapshot(db, item, 'create', actor, now);
      })();
    });

    item.icon = this._resolveIcon(item);   // read model carries the derived icon
    this._mem.set(id, item);

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

    // 1. Memory cache
    if (this._mem.has(id)) return this._mem.get(id);

    // 2. Index
    const row = this._getRow(this._openDb(), id);
    if (row) {
      const item = this._rowToItem(row);
      this._mem.set(id, item);
      return item;
    }

    // 3. Filesystem fallback
    const doc = this._readItemJson(id);
    if (!doc) return null;
    const item = this._docToItem(doc);
    if (item) this._mem.set(id, item);
    return item;
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
    const now     = new Date();
    const updated = { ...current };

    const oldLinks = this._parseLinks(current.value);
    const newLinks = 'value' in changes ? this._parseLinks(changes.value) : oldLinks;

    const SCALAR_FIELDS = [
      'value', 'parentId', 'sortOrder', 'confidence', 'status', 'license',
      'visibility', 'aspect', 'cachedAt', 'expiresAt', 'connectorId',
      'materialized', 'completedAt', 'dueAt', 'deletedAt', 'tags',
      'sourceSystem', 'sourceExternalId', 'layer',
    ];
    for (const f of SCALAR_FIELDS) {
      if (f in changes) updated[f] = changes[f];
    }

    if ('type' in changes && changes.type !== current.type) {
      updated.type   = changes.type;
      updated.typeId = changes.type === 'object' ? (changes.typeId || null) : null;
    } else if ('typeId' in changes && updated.type === 'object') {
      updated.typeId = changes.typeId;
    }

    updated.modifiedAt = now.toISOString();
    updated.modifiedBy = actor;

    // Read existing doc to preserve payload/time/search sections.
    const existingDoc = this._readItemJson(id);
    const newDoc      = this._itemToDoc(updated, existingDoc);

    // Write file FIRST — under the write lock + journal.
    const db = this._openDb();
    this._withWrite([{ id, store: 'items' }], () => {
      this._writeItemJson(id, newDoc);
      this._mem.delete(id);
      db.transaction(() => {
      this._snapshot(db, current, 'update', actor, now);

      // Update items table
      db.prepare(`
        UPDATE items SET parent_id = ?, type = ?, type_id = ?, value = ?, sort_order = ?, aspect = ?
        WHERE id = ?
      `).run(updated.parentId, updated.type, updated.typeId ?? null, updated.value ?? null,
             updated.sortOrder ?? 0, updated.aspect ?? null, id);

      // Update meta table
      this._updateIndexMeta(db, id, newDoc.meta, updated.tags || []);

      // Backlinks
      for (const l of oldLinks) if (!newLinks.includes(l)) db.prepare('DELETE FROM backlinks WHERE source_id = ? AND target_id = ?').run(id, l);
      for (const l of newLinks) if (!oldLinks.includes(l)) db.prepare('INSERT OR IGNORE INTO backlinks (source_id, target_id) VALUES (?, ?)').run(id, l);

      // Tags
      if ('tags' in changes) {
        const oldTags = current.tags || [];
        const newTags = changes.tags;
        for (const t of oldTags) if (!newTags.includes(t)) db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag = ?').run(id, t);
        for (const t of newTags) if (!oldTags.includes(t)) db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)').run(id, t);
      }

      // Materialized path cascade
      if ('parentId' in changes && changes.parentId !== current.parentId) {
        const parentPath = this._getPath(changes.parentId);
        const newPath    = parentPath != null ? `${parentPath}/${id}` : id;
        this._cascadePathUpdate(db, id, newPath);
      }
      })();
    });

    updated.icon = this._resolveIcon(updated);   // read model carries the derived icon
    this._mem.set(id, updated);
    if (this._roots && WELL_KNOWN_TYPES.has(updated.type)) this._roots[updated.type] = updated;

    if (typeWarning)
      Object.defineProperty(updated, 'warning', { value: typeWarning, enumerable: false, configurable: true });

    return updated;
  }

  deleteWarnings(id) {
    const bl   = this.backlinks(id);
    const rels = this.relationships(id);
    const w    = [];
    if (bl.length)                   w.push(`${bl.length} item(s) link to this via [[uuid]] syntax`);
    if ((rels.inbound || []).length) w.push(`${rels.inbound.length} inbound relationship(s) point to this item`);
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

    // The cascade also removes metadata item.json files; include them in the
    // journal's ops so a crash mid-delete can roll every one of them back.
    const cascadeOps = this._cascadeMetadataOps(db, id);

    const sparse = this._isSparse();
    this._withWrite([{ id, store: 'items' }, ...cascadeOps], () => {
      // On a sparse branch the item may live upstream; a tombstone masks it on
      // read and applies the delete on merge. On a full branch, remove the file.
      if (sparse) this._writeItemJson(id, this._makeTombstone(id, item.parentId, actor, now));
      else        this._deleteItemDir(id);
      this._mem.delete(id);
      db.transaction(() => {
        this._snapshot(db, item, 'delete', actor, now);
        // Cascade-delete the metadata items hanging off this item (relationships,
        // annotations, aliases) — their item.json files and derived rows together.
        this._cascadeDeleteMetadata(db, id);
        db.prepare('DELETE FROM item_tags    WHERE item_id = ?').run(id);
        db.prepare('DELETE FROM backlinks    WHERE source_id = ? OR target_id = ?').run(id, id);
        db.prepare('DELETE FROM items_meta   WHERE item_id = ?').run(id);
        db.prepare('DELETE FROM items_payload WHERE item_id = ?').run(id);
        db.prepare('DELETE FROM items_search WHERE item_id = ?').run(id);
        db.prepare('DELETE FROM items_time   WHERE item_id = ?').run(id);
        db.prepare('DELETE FROM items        WHERE id = ?').run(id);
      })();
    });

    return { warnings };
  }

  // The item ids the delete cascade will remove (relationships either direction,
  // annotations on the item, aliases to it) — so _withWrite can journal them.
  _cascadeMetadataOps(db, id) {
    const ids = new Set();
    for (const r of db.prepare('SELECT id FROM relationships WHERE source_id = ? OR target_id = ?').all(id, id)) ids.add(r.id);
    for (const a of db.prepare('SELECT id FROM annotations WHERE target_id = ?').all(id)) ids.add(a.id);
    for (const a of db.prepare('SELECT item_id FROM aliases WHERE target_id = ?').all(id)) if (a.item_id) ids.add(a.item_id);
    return [...ids].map(x => ({ id: x, store: 'items' }));
  }

  softDelete(id, actor) {
    const item = this.get(id);
    this._assertEditable(item, id);
    actor = actor || this.config.owner;
    const now     = new Date();
    const updated = { ...item, deletedAt: now.toISOString(), modifiedAt: now.toISOString(), modifiedBy: actor };

    const existingDoc = this._readItemJson(id);
    const newDoc      = this._itemToDoc(updated, existingDoc);

    const db = this._openDb();
    this._withWrite([{ id, store: 'items' }], () => {
      this._writeItemJson(id, newDoc);
      this._mem.delete(id);
      db.transaction(() => {
        this._snapshot(db, item, 'soft-delete', actor, now);
        db.prepare('UPDATE items_meta SET deleted_at = ?, modified_at = ?, modified_by = ? WHERE item_id = ?')
          .run(now.toISOString(), now.toISOString(), actor, id);
      })();
    });

    return updated;
  }

  restore(id, actor) {
    const item = this.get(id);
    if (!item) throw new Error(`Item not found: ${id}`);
    actor = actor || this.config.owner;
    const now     = new Date();
    const updated = { ...item, deletedAt: null, modifiedAt: now.toISOString(), modifiedBy: actor };

    const existingDoc = this._readItemJson(id);
    const newDoc      = this._itemToDoc(updated, existingDoc);

    const db = this._openDb();
    this._withWrite([{ id, store: 'items' }], () => {
      this._writeItemJson(id, newDoc);
      this._mem.delete(id);
      db.transaction(() => {
        this._snapshot(db, item, 'restore', actor, now);
        db.prepare('UPDATE items_meta SET deleted_at = NULL, modified_at = ?, modified_by = ? WHERE item_id = ?')
          .run(now.toISOString(), actor, id);
      })();
    });

    return updated;
  }

  // ─── Payload sidecars (read/write item.json payload section) ──────────────

  readObjectJson(id) {
    if (this._isSyntheticId(id)) return null;
    const doc = this._readItemJson(id);
    if (!doc) return null;
    return doc.payload ?? null;
  }

  writeObjectJson(id, data) {
    const doc = this._readItemJson(id);
    if (!doc) throw new Error(`Item not found: ${id}`);
    doc.payload = data;
    const db = this._openDb();
    this._withWrite([{ id, store: 'items' }], () => {
      this._writeItemJson(id, doc);
      const row = db.prepare('SELECT item_id FROM items_payload WHERE item_id = ?').get(id);
      if (row) db.prepare('UPDATE items_payload SET payload = ? WHERE item_id = ?').run(JSON.stringify(data), id);
      else     db.prepare('INSERT INTO items_payload (item_id, payload) VALUES (?, ?)').run(id, JSON.stringify(data));
      this._mem.delete(id);
    });
  }

  readFunctionJson(id) {
    if (this._isSyntheticId(id)) return null;
    const doc = this._readItemJson(id);
    return doc?.payload ?? null;
  }

  writeFunctionJson(id, data) {
    this.writeObjectJson(id, data);
  }

  readScheduleJson(id) {
    if (this._isSyntheticId(id)) return null;
    const doc = this._readItemJson(id);
    return doc?.payload ?? null;
  }

  writeScheduleJson(id, data) {
    this.writeObjectJson(id, data);
  }

  // ─── Document type helpers ─────────────────────────────────────────────────

  // Stable UUID of the synthetic 'document' type item — seeded from
  // built-in-types/types/document.json and identical across all installations.
  static get DOCUMENT_TYPE_UUID() { return 'b4e2f1c3-a0d5-4e6f-8b9c-d7f2e1a3b5c0'; }

  createDocument(targetId, name, {
    expandState = null,
    roleMap = null,
    isOrgDefault = false,
    baseDocumentId = null,
    owner, visibility = 'private',
  } = {}) {
    if (!targetId) throw new Error('createDocument: targetId is required');
    if (!name)     throw new Error('createDocument: name is required');
    const item = this.create({
      type: 'document',
      parentId: SqliteFsAdapter.DOCUMENT_TYPE_UUID,
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
    this.writeObjectJson(item.id, payload);
    return item;
  }

  readDocumentPayload(id) {
    return this.readObjectJson(id);
  }

  writeDocumentPayload(id, payload) {
    const doc = this._readItemJson(id);
    if (!doc) throw new Error(`Item not found: ${id}`);
    if (doc.item?.type !== 'document') throw new Error(`Item ${id} is not a document`);
    this.writeObjectJson(id, payload);
  }

  listDocuments(targetId) {
    const rows = this._openDb().prepare(`
      SELECT i.*, m.owner, m.license, m.visibility, m.confidence, m.status, m.tags,
             m.created_at, m.modified_at, m.created_by, m.modified_by,
             m.completed_at, m.due_at, m.expires_at, m.deleted_at, m.cached_at,
             m.connector_id, m.materialized, m.files, m.layer,
             m.source_system, m.source_external_id, m.icon
      FROM items i
      LEFT JOIN items_meta m ON m.item_id = i.id
      JOIN items_payload ip ON ip.item_id = i.id
      WHERE i.type = 'document'
        AND json_extract(ip.payload, '$.targetId') = ?
        AND (m.deleted_at IS NULL)
      ORDER BY i.id
    `).all(targetId);
    return rows.map(r => this._rowToItem(r));
  }

  listDueSchedules(beforeAt) {
    const rows = this._openDb().prepare(`
      SELECT i.*, m.owner, m.license, m.visibility, m.confidence, m.status, m.tags,
             m.created_at, m.modified_at, m.created_by, m.modified_by,
             m.completed_at, m.due_at, m.expires_at, m.deleted_at, m.cached_at,
             m.connector_id, m.materialized, m.files, m.layer,
             m.source_system, m.source_external_id, m.icon
      FROM items i LEFT JOIN items_meta m ON m.item_id = i.id
      WHERE i.type = 'schedule' AND m.status = 'active' AND m.due_at <= ? AND m.deleted_at IS NULL
    `).all(beforeAt);
    return rows.map(r => this._rowToItem(r));
  }

  getDocument(id) {
    if (this._isSyntheticId(id)) return null;
    return this._readItemJson(id) ?? null;
  }

  readTimeJson(id) {
    if (this._isSyntheticId(id)) return null;
    const doc = this._readItemJson(id);
    return doc?.time ?? null;
  }

  writeTimeJson(id, data) {
    const doc = this._readItemJson(id);
    if (!doc) throw new Error(`Item not found: ${id}`);
    doc.time = data;
    this._writeItemJson(id, doc);
    const db = this._openDb();
    db.prepare('DELETE FROM items_time WHERE item_id = ?').run(id);
    if (data) {
      const ins = db.prepare(`
        INSERT INTO items_time (item_id, key, start_at, end_at, recurrence_rule, recurrence_exceptions, next_occurrence_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [key, entry] of Object.entries(data)) {
        if (!entry) continue;
        ins.run(id, key, entry.startAt ?? null, entry.endAt ?? null, entry.recurrenceRule ?? null,
                JSON.stringify(entry.recurrenceExceptions ?? []), entry.nextOccurrenceAt ?? null, entry.completedAt ?? null);
      }
    }
    this._mem.delete(id);
  }

  deleteTimeJson(id) {
    const doc = this._readItemJson(id);
    if (!doc) return;
    doc.time = null;
    this._writeItemJson(id, doc);
    this._openDb().prepare('DELETE FROM items_time WHERE item_id = ?').run(id);
    this._mem.delete(id);
  }

  // ─── Connector queries ─────────────────────────────────────────────────────

  listStubs(connectorId) {
    const rows = this._openDb().prepare(`
      SELECT i.*, m.owner, m.license, m.visibility, m.confidence, m.status, m.tags,
             m.created_at, m.modified_at, m.created_by, m.modified_by,
             m.completed_at, m.due_at, m.expires_at, m.deleted_at, m.cached_at,
             m.connector_id, m.materialized, m.files, m.layer,
             m.source_system, m.source_external_id, m.icon
      FROM items i LEFT JOIN items_meta m ON m.item_id = i.id
      WHERE m.connector_id = ? AND m.materialized = 0 AND m.deleted_at IS NULL
    `).all(connectorId);
    return rows.map(r => this._rowToItem(r));
  }

  listDueForRefresh(beforeAt) {
    const rows = this._openDb().prepare(`
      SELECT i.*, m.owner, m.license, m.visibility, m.confidence, m.status, m.tags,
             m.created_at, m.modified_at, m.created_by, m.modified_by,
             m.completed_at, m.due_at, m.expires_at, m.deleted_at, m.cached_at,
             m.connector_id, m.materialized, m.files, m.layer,
             m.source_system, m.source_external_id, m.icon
      FROM items i LEFT JOIN items_meta m ON m.item_id = i.id
      WHERE m.connector_id IS NOT NULL AND m.cached_at < ? AND m.deleted_at IS NULL
    `).all(beforeAt);
    return rows.map(r => this._rowToItem(r));
  }

  // ─── File store stubs ──────────────────────────────────────────────────────

  putFile()    { throw new Error('putFile is not supported in sqlite-fs mode'); }
  getFile()    { return null; }
  deleteFile() {}
  listFiles()  { return []; }

  // ─── Type definitions ─────────────────────────────────────────────────────

  createType(value, { schema, createdBy, id: explicitId, icon } = {}) {
    if (!value || typeof value !== 'string' || !value.trim()) throw new Error('value is required');
    const resolvedIcon = schema?.meta?.icon ?? icon;
    if (!resolvedIcon || typeof resolvedIcon !== 'string' || !resolvedIcon.trim()) {
      throw new Error('icon is required — provide a non-empty MUI icon name (e.g. "Person")');
    }
    const id    = explicitId || crypto.randomUUID();
    const now   = new Date();
    const owner = this.config.owner;
    const actor = createdBy || owner;
    const resolvedSchema = schema || {
      meta: {
        icon: resolvedIcon.trim(), description: '', details: '', keywords: '', tags: '',
        'ai-instructions': { claude: '' },
      },
      jsonSchema: {
        '$schema': 'http://json-schema.org/draft-07/schema#', '$id': '',
        title: value.trim(), type: 'object', properties: {}, required: [],
        additionalProperties: false,
      },
    };

    const item = {
      id, specVersion, parentId: TYPES_NODE,
      value: value.trim(), type: 'type', typeId: null,
      owner, license: DEFAULT_LICENSE, visibility: 'private',
      aspect: null, confidence: null, status: null, tags: [],
      createdAt: now.toISOString(), modifiedAt: now.toISOString(),
      createdBy: actor, modifiedBy: actor,
      cachedAt: null, expiresAt: null, deletedAt: null, connectorId: null,
      materialized: null, completedAt: null, dueAt: null, files: {}, layer: 'user',
      sourceSystem: null, sourceExternalId: null, icon: resolvedIcon.trim(),
    };

    const db = this._openDb();
    const siblings   = db.prepare('SELECT sort_order FROM items WHERE parent_id = ?').all(TYPES_NODE);
    item.sortOrder   = siblings.length === 0 ? 0 : Math.max(...siblings.map(s => s.sort_order)) + 1;
    const parentPath = this._getPath(TYPES_NODE);
    const itemPath   = parentPath != null ? `${parentPath}/${id}` : id;

    const doc = { ...this._itemToDoc(item), payload: resolvedSchema };
    this._writeItemJson(id, doc);

    db.transaction(() => {
      this._insertIndexTx(db, id, doc, itemPath);
      this._snapshot(db, item, 'create', actor, now);
    })();

    this._mem.set(id, item);
    this._iconCache = null;   // a new type changes icon resolution
    return { metadata: this.get(id), schema: resolvedSchema };
  }

  readTypeJson(id) {
    const doc = this._readItemJson(id);
    return doc?.payload ?? null;
  }

  writeTypeJson(id, data) {
    const icon = data?.meta?.icon;
    if (!icon || typeof icon !== 'string' || !icon.trim()) {
      throw new Error('meta.icon is required and must be a non-empty MUI icon name');
    }
    const doc = this._readItemJson(id);
    if (!doc) throw new Error(`type item ${id} not found`);
    const updated = { ...doc, payload: data };
    this._writeItemJson(id, updated);
    this._openDb().prepare('INSERT OR REPLACE INTO items_payload (item_id, payload) VALUES (?,?)').run(id, JSON.stringify(data));
    this._iconCache = null;   // a type's icon may have changed
    this._mem.clear();
  }

  _getTypeName(typeId) {
    if (!typeId) return null;
    const row = this._openDb().prepare(`SELECT value FROM items WHERE id = ? AND type = 'type'`).get(typeId);
    return row ? row.value : null;
  }

  _guardTypeIdRef(typeId, strict) {
    const effectiveStrict = strict !== undefined ? !!strict : !!this.config.strictTypeIds;
    if (effectiveStrict) {
      const err = new Error(`unknown typeId "${typeId}" — no registered type definition`);
      err.name   = 'UnknownTypeError';
      err.code   = 'UNKNOWN_TYPE';
      err.typeId = typeId;
      throw err;
    }
    return `typeId ${typeId} has no type definition — node written anyway; run \`kanecta doctor\``;
  }

  _listTypeDefs() {
    return this._openDb()
      .prepare(`SELECT id, value FROM items WHERE type = 'type' ORDER BY value`)
      .all();
  }

  resolveTypeId(name) {
    if (!name) return { unknown: true };
    if (VALID_TYPES.includes(name)) return { primitive: true };
    const row = this._openDb()
      .prepare(`SELECT id FROM items WHERE type = 'type' AND value = ? LIMIT 1`)
      .get(name);
    return row ? { id: row.id } : { unknown: true };
  }

  // ─── Aliases ───────────────────────────────────────────────────────────────

  setAlias(alias, id) {
    const db = this._openDb();
    // Overwrite: drop any existing alias item carrying this string first.
    const existing = db.prepare('SELECT item_id FROM aliases WHERE alias = ?').get(alias);
    if (existing?.item_id) db.transaction(() => this._deleteMetadataItem(db, existing.item_id, 'alias'))();

    const now = new Date().toISOString();
    const doc = this._metaItem({
      id: crypto.randomUUID(), parentId: TYPE_ITEM_UUIDS.alias, type: 'alias', value: alias,
    });
    doc.payload = { targetId: id, scope: 'personal', provisional: false, confirmedAt: now, computedFrom: null };
    this._writeMetadataItem(doc);
  }

  removeAlias(alias) {
    const db = this._openDb();
    const existing = db.prepare('SELECT item_id FROM aliases WHERE alias = ?').get(alias);
    if (existing?.item_id) db.transaction(() => this._deleteMetadataItem(db, existing.item_id, 'alias'))();
    else db.prepare('DELETE FROM aliases WHERE alias = ?').run(alias);
  }

  listAliases() {
    return this._openDb().prepare('SELECT alias, target_id FROM aliases ORDER BY alias').all()
      .map(r => ({ alias: r.alias, targetId: r.target_id }));
  }

  // ─── Annotations ───────────────────────────────────────────────────────────

  annotate(targetId, { author, content, parentAnnotationId = null } = {}) {
    const id     = crypto.randomUUID();
    const now    = new Date();
    const actor  = author || this.config.owner;
    const ann    = { id, targetId, author: actor, content, createdAt: now.toISOString(), parentAnnotationId };

    // Annotation is a real `annotation` item.json parented under its target, in
    // the "comments" aspect so it stays out of default content traversal. The
    // item.json is the source of truth; the annotations table is derived.
    const doc = this._metaItem({
      id, parentId: targetId, type: 'annotation',
      value: typeof content === 'string' ? content.slice(0, 255) : null,
      aspect: 'comments', layer: 'user',
      owner: actor, createdBy: actor, modifiedBy: actor, createdAt: now.toISOString(), modifiedAt: now.toISOString(),
    });
    doc.payload = { content, author: actor, parentAnnotationId };
    this._writeMetadataItem(doc);
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
    const cfg      = this.config;
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

    // A relationship is a real `relationship` item.json (the source of truth); the
    // relationships table is a derived projection. The relationship-type slug lives
    // in item.value; source/target live in the payload.
    const doc = this._metaItem({
      id: relId, parentId: TYPE_ITEM_UUIDS.relationship, type: 'relationship', value: type,
      layer: 'user', owner: actor, createdBy: actor, modifiedBy: actor,
      createdAt: now.toISOString(), modifiedAt: now.toISOString(),
    });
    doc.payload = { typeId: null, sourceId, targetId, data: null, confidence: null, note };
    this._writeMetadataItem(doc);
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

  loadAll() {
    return this._openDb().prepare(`
      SELECT i.*, m.owner, m.license, m.visibility, m.confidence, m.status, m.tags,
             m.created_at, m.modified_at, m.created_by, m.modified_by,
             m.completed_at, m.due_at, m.expires_at, m.deleted_at, m.cached_at,
             m.connector_id, m.materialized, m.files, m.layer,
             m.source_system, m.source_external_id, m.icon
      FROM items i LEFT JOIN items_meta m ON m.item_id = i.id
      WHERE i.type NOT IN ('alias', 'relationship', 'annotation', 'item_history', 'type')
    `).all().map(r => this._rowToItem(r));
  }

  // ─── Tree ──────────────────────────────────────────────────────────────────

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

    const db  = this._openDb();
    const sql = `
      SELECT i.*, m.owner, m.license, m.visibility, m.confidence, m.status, m.tags,
             m.created_at, m.modified_at, m.created_by, m.modified_by,
             m.completed_at, m.due_at, m.expires_at, m.deleted_at, m.cached_at,
             m.connector_id, m.materialized, m.files, m.layer,
             m.source_system, m.source_external_id, m.icon
      FROM items i LEFT JOIN items_meta m ON m.item_id = i.id
      WHERE i.parent_id = ? AND i.id != i.parent_id AND i.aspect ${aspect === null || aspect === undefined ? 'IS NULL' : '= ?'}
        AND i.type NOT IN ('root', 'types', 'alias', 'relationship', 'annotation', 'item_history')
      ORDER BY i.sort_order
    `;
    const rows = (aspect === null || aspect === undefined)
      ? db.prepare(sql).all(parentId)
      : db.prepare(sql).all(parentId, aspect);
    const realChildren = rows.map(r => this._rowToItem(r));

    const obj = this.readObjectJson(parentId);
    if (!obj) return realChildren;
    return [...this._buildSyntheticChildren(parentId, obj, parentId), ...realChildren];
  }

  tree(rootId, maxDepth = Infinity) {
    let implicitRoot = false;
    const db = this._openDb();

    if (!rootId) {
      rootId = ROOT_ID;
      implicitRoot = true;
    }

    const rootRow = db.prepare('SELECT path FROM items WHERE id = ?').get(rootId);
    if (!rootRow?.path) return this._treeSlow(rootId, maxDepth, implicitRoot);

    const rootPath  = rootRow?.path ?? rootId;
    const rootDepth = (rootPath.match(/\//g) || []).length;

    const joinSql = `
      SELECT i.*, m.owner, m.license, m.visibility, m.confidence, m.status, m.tags,
             m.created_at, m.modified_at, m.created_by, m.modified_by,
             m.completed_at, m.due_at, m.expires_at, m.deleted_at, m.cached_at,
             m.connector_id, m.materialized, m.files, m.layer,
             m.source_system, m.source_external_id, m.icon
      FROM items i LEFT JOIN items_meta m ON m.item_id = i.id
    `;

    // Metadata items (annotations live under their target via the "comments"
    // aspect) are not part of the content tree.
    const exclude = " AND i.type NOT IN ('root', 'types', 'alias', 'relationship', 'annotation', 'item_history', 'type')";
    // With an implicit root we skip the root node and start its CHILDREN at
    // traversal-depth 0, so the absolute path is already one level deeper than
    // the traversal depth — widen the SQL bound by one to match.
    const depthBound = rootDepth + maxDepth + (implicitRoot ? 1 : 0);
    let rows;
    if (maxDepth === Infinity) {
      rows = db.prepare(joinSql + ' WHERE (i.path = ? OR i.path LIKE ?)' + exclude).all(rootPath, rootPath + '/%');
    } else {
      rows = db.prepare(joinSql + ` WHERE (i.path = ? OR i.path LIKE ?)
        AND (length(i.path) - length(replace(i.path, '/', ''))) <= ?` + exclude
      ).all(rootPath, rootPath + '/%', depthBound);
    }

    const subtreeItems = rows.map(r => this._rowToItem(r));
    const byParent     = new Map();
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

  ancestors(id) {
    const row = this._openDb().prepare('SELECT path FROM items WHERE id = ?').get(id);
    if (!row?.path) return [];
    const ancestorIds = row.path.split('/').slice(0, -1);
    if (!ancestorIds.length) return [];
    const placeholders = ancestorIds.map(() => '?').join(', ');
    const rows = this._openDb().prepare(`
      SELECT i.*, m.owner, m.license, m.visibility, m.confidence, m.status, m.tags,
             m.created_at, m.modified_at, m.created_by, m.modified_by,
             m.completed_at, m.due_at, m.expires_at, m.deleted_at, m.cached_at,
             m.connector_id, m.materialized, m.files, m.layer,
             m.source_system, m.source_external_id, m.icon
      FROM items i LEFT JOIN items_meta m ON m.item_id = i.id
      WHERE i.id IN (${placeholders})
    `).all(...ancestorIds);
    const byId = new Map(rows.map(r => [r.id, this._rowToItem(r)]));
    return ancestorIds.map(aid => byId.get(aid)).filter(Boolean);
  }

  subtreeCount(rootId) {
    const row = this._openDb().prepare('SELECT path FROM items WHERE id = ?').get(rootId);
    if (!row?.path) return 0;
    const r = this._openDb().prepare(
      `SELECT COUNT(*) AS cnt FROM items WHERE (path = ? OR path LIKE ?)
       AND type NOT IN ('alias', 'relationship', 'annotation', 'item_history', 'type')`
    ).get(row.path, row.path + '/%');
    return r?.cnt ?? 0;
  }

  // ─── Query ─────────────────────────────────────────────────────────────────

  _evaluatePredicate(fieldValue, op, expectedValue) {
    switch (op) {
      case '=':        return fieldValue === expectedValue;
      case '!=':       return fieldValue !== expectedValue;
      case 'in':       return Array.isArray(expectedValue) && expectedValue.includes(fieldValue);
      case 'contains':
        if (typeof fieldValue === 'string')
          return typeof expectedValue === 'string' && fieldValue.toLowerCase().includes(expectedValue.toLowerCase());
        if (Array.isArray(fieldValue))
          return fieldValue.some(v =>
            typeof v === 'string' && typeof expectedValue === 'string'
              ? v.toLowerCase().includes(expectedValue.toLowerCase())
              : v === expectedValue,
          );
        return false;
      case '>':  return fieldValue > expectedValue;
      case '<':  return fieldValue < expectedValue;
      default:   return false;
    }
  }

  query({
    type, where, rootId, sort, limit, strictTypes,
    includeDeleted = false, excludeExpired = false, expiredOnly = false,
  } = {}) {
    let items       = this.loadAll();
    let typeWarning = null;

    if (!includeDeleted) items = items.filter(i => i.deletedAt == null);

    const now = new Date().toISOString();
    if (expiredOnly)       items = items.filter(i => i.expiresAt != null && i.expiresAt <= now);
    else if (excludeExpired) items = items.filter(i => i.expiresAt == null || i.expiresAt > now);

    if (rootId) {
      const byP = new Map();
      for (const item of items) {
        if (item.id === item.parentId) continue;
        if (!byP.has(item.parentId)) byP.set(item.parentId, []);
        byP.get(item.parentId).push(item.id);
      }
      const subtree = new Set();
      const walk    = (id) => { if (subtree.has(id)) return; subtree.add(id); for (const c of (byP.get(id) || [])) walk(c); };
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

    items = items.map(item => {
      if (item.type === 'object') return { ...item, objectData: this.readObjectJson(item.id) };
      return item;
    });

    if (where && Object.keys(where).length > 0) {
      items = items.filter(item => {
        if (item.type !== 'object' || !item.objectData) return false;
        for (const [field, predicate] of Object.entries(where)) {
          const fieldValue = item.objectData[field];
          let op = '=', expectedValue = predicate;
          if (predicate !== null && typeof predicate === 'object' && 'op' in predicate && 'value' in predicate) {
            op = predicate.op; expectedValue = predicate.value;
          }
          if (!this._evaluatePredicate(fieldValue, op, expectedValue)) return false;
        }
        return true;
      });
    }

    if (sort?.field) {
      const { field, dir = 'asc' } = sort;
      const isDesc = dir.toLowerCase() === 'desc';
      items.sort((a, b) => {
        const vA = a[field] ?? a.objectData?.[field];
        const vB = b[field] ?? b.objectData?.[field];
        if (vA == null) return isDesc ? -1 :  1;
        if (vB == null) return isDesc ?  1 : -1;
        if (vA < vB)   return isDesc ?  1 : -1;
        if (vA > vB)   return isDesc ? -1 :  1;
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

  // ─── Index maintenance ────────────────────────────────────────────────────

  // Rebuild the SQLite index entirely from the filesystem.
  rebuildIndexes() {
    const db = this._openDb();
    db.transaction(() => {
      db.prepare('DELETE FROM items_time').run();
      db.prepare('DELETE FROM items_search').run();
      db.prepare('DELETE FROM items_payload').run();
      db.prepare('DELETE FROM items_meta').run();
      db.prepare('DELETE FROM item_tags').run();
      db.prepare('DELETE FROM backlinks').run();
      db.prepare('DELETE FROM history').run();
      db.prepare('DELETE FROM aliases').run();
      db.prepare('DELETE FROM relationships').run();
      db.prepare('DELETE FROM annotations').run();
      db.prepare('DELETE FROM items').run();
      if (this._isSparse()) this._rebuildFromFsSparse(db);
      else                  this._rebuildFromFs(db);
    })();
    this._mem.clear();
    this._iconCache = null;
    const cnt = db.prepare('SELECT COUNT(*) AS n FROM items').get();
    return cnt?.n ?? 0;
  }

  // ─── Branching ────────────────────────────────────────────────────────────
  //
  // Every branch is a complete, self-contained folder under branches/<name>/
  // (items/ + index.db + branch.json). The branch registry IS the branches/
  // directory — there is no branches table and no shared current_branch. A
  // branch is created by recursively copying the base branch's folder; switching
  // a branch just reopens that folder's index.db.

  currentBranch() { return this._branch; }

  _branchExists(name) {
    return fs.existsSync(path.join(this._branchRoot(name), 'items'));
  }

  // createBranch(name, { fill, upstream })
  //   fill: 'full' (default) → recursive copy of the base branch folder.
  //   fill: 'sparse'         → empty items/ that reads through to an upstream
  //                            branch; only local changes (and tombstones for
  //                            deletes) live in this branch's items/.
  //   upstream: { branch } for a LOCAL full branch (default { branch: base }),
  //             or { remote, branch } for a remote (federated at query time).
  createBranch(name, opts = {}) {
    if (!name || typeof name !== 'string' || !name.trim()) throw new Error('branch name is required');
    name = name.trim();
    if (name === 'main') throw new Error('Cannot create a branch named "main"');
    if (this._branchExists(name)) throw new Error(`Branch "${name}" already exists`);

    const base = this._branch;
    const now  = new Date().toISOString();

    if (opts.fill === 'sparse') {
      const upstream = opts.upstream ?? { branch: base };
      const destDir  = this._branchRoot(name);
      fs.mkdirSync(path.join(destDir, 'items'), { recursive: true });
      const manifest = {
        name, fill: 'sparse', upstream, base,
        branchPoint: { branch: upstream.branch ?? base, at: now },
        createdAt: now,
      };
      fs.writeFileSync(path.join(destDir, 'branch.json'), JSON.stringify(manifest, null, 2), 'utf8');
      // index.db is projected lazily on first useBranch() (_rebuildFromFsSparse).
      return { name, base, baseBranch: base, fill: 'sparse', upstream, createdAt: now };
    }

    // Flush the base branch's index so the copy includes an up-to-date index.db.
    if (this._db && this._dbBranch === base) { try { this._db.pragma('wal_checkpoint(TRUNCATE)'); } catch {} }

    const srcDir  = this._branchRoot(base);
    const destDir = this._branchRoot(name);

    // Full recursive copy of the base branch folder (items + index.db). This is a
    // complete copy, NOT a delta.
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    fs.cpSync(srcDir, destDir, { recursive: true });

    // Overwrite branch.json with this branch's own identity + base/createdAt.
    const manifest = { name, fill: 'full', upstream: null, base, createdAt: now };
    fs.writeFileSync(
      path.join(destDir, 'branch.json'),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );
    // Drop any copied WAL sidecars so the new branch's index opens cleanly.
    for (const sfx of ['-wal', '-shm']) {
      const f = path.join(destDir, 'index.db' + sfx);
      if (fs.existsSync(f)) { try { fs.rmSync(f); } catch {} }
    }

    return { name, base, baseBranch: base, fill: 'full', upstream: null, createdAt: now };
  }

  // Set the active branch and persist it as the process default. With per-branch
  // folders there is no shared default to write — this simply reopens the branch.
  switchBranch(name) {
    name = (name || 'main').trim();
    if (name !== 'main' && !this._branchExists(name)) throw new Error(`Branch "${name}" not found`);
    this._setActiveBranch(name);
  }

  // Select the active branch for THIS instance only. Identical to switchBranch in
  // the per-branch-folder model (there is no shared default to persist), but kept
  // separate so a consumer can express intent. Switching closes the current
  // index.db so the next _openDb() opens the new branch's folder, and clears the
  // memory cache (stale after a branch change).
  useBranch(name) {
    name = (name || 'main').trim();
    if (name !== 'main' && !this._branchExists(name)) throw new Error(`Branch "${name}" not found`);
    this._setActiveBranch(name);
  }

  _setActiveBranch(name) {
    if (name === this._branch) return;
    if (this._db) { try { this._db.close(); } catch {} this._db = null; this._dbBranch = null; }
    this._branch = name;
    this._mem.clear();
    this._roots  = null;
    this._iconCache = null;   // type items are per-branch
    // A crashed writer may have left a journal on the branch we're switching to.
    this._recover();
  }

  // The branch registry is the branches/ directory: one branch.json per branch.
  listBranches() {
    const branchesDir = path.join(this.k, 'branches');
    if (!fs.existsSync(branchesDir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(branchesDir).sort()) {
      if (entry === 'main') continue; // listBranches reports non-main branches
      const full = path.join(branchesDir, entry);
      if (!fs.statSync(full).isDirectory()) continue;
      let manifest = null;
      try { manifest = JSON.parse(fs.readFileSync(path.join(full, 'branch.json'), 'utf8')); } catch {}
      const decodedName = manifest?.name ?? entry.replace(/__/g, '/');
      out.push({
        name: decodedName,
        base: manifest?.base ?? 'main',
        baseBranch: manifest?.base ?? 'main',
        fill: manifest?.fill ?? 'full',
        upstream: manifest?.upstream ?? null,
        createdAt: manifest?.createdAt ?? null,
      });
    }
    out.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    return out;
  }

  deleteBranch(name) {
    if (!name || name === 'main') throw new Error('Cannot delete the main branch');
    if (this._branch === name) throw new Error(`Cannot delete the currently active branch "${name}" — switch to main first`);
    if (!this._branchExists(name)) throw new Error(`Branch "${name}" not found`);
    const dir = this._branchRoot(name);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  // Returns the full ADD/EDIT/DELETE diff of a branch vs main, computed by
  // scanning both branches' items/ trees (each branch is a full folder).
  branchDiff(name) {
    name = (name ?? this._branch).trim();
    if (name === 'main') return { adds: [], edits: [], deletes: [] };
    if (!this._branchExists(name)) return { adds: [], edits: [], deletes: [] };

    const readTree = (branchName) => {
      const dir = path.join(this._branchRoot(branchName), 'items');
      const map = new Map();
      for (const jsonPath of this._scanItemFiles(dir)) {
        try {
          const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          if (doc?.item?.id) map.set(doc.item.id, doc);
        } catch {}
      }
      return map;
    };

    const manifest = this._branchManifest(name);
    const upName   = manifest.fill === 'sparse'
      ? (manifest.upstream?.branch ?? manifest.base ?? 'main')
      : 'main';
    const upDocs = readTree(upName);

    const adds = [], edits = [], deletes = [];

    if (manifest.fill === 'sparse') {
      // Sparse: the branch's own items/ IS the diff. Each local file is an
      // add/edit; a tombstone is a delete of the upstream item. Inherited items
      // (present upstream, absent locally) are UNCHANGED, never deletes.
      const localDir = path.join(this._branchRoot(name), 'items');
      for (const jsonPath of this._scanItemFiles(localDir)) {
        let doc; try { doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { continue; }
        const id = doc?.item?.id;
        if (!id) continue;
        if (this._isTombstone(doc)) {
          const upDoc = upDocs.get(id);
          if (upDoc) deletes.push({ id, before: this._docToItem(upDoc) });
          continue;
        }
        const upDoc = upDocs.get(id);
        if (!upDoc) adds.push({ id, after: this._docToItem(doc), doc });
        else if (JSON.stringify(upDoc) !== JSON.stringify(doc))
          edits.push({ id, before: this._docToItem(upDoc), after: this._docToItem(doc), doc });
      }
      return { adds, edits, deletes };
    }

    // Full branch: compare the two complete trees.
    const branchDocs = readTree(name);
    for (const [id, doc] of branchDocs) {
      const upDoc = upDocs.get(id);
      if (!upDoc) {
        adds.push({ id, after: this._docToItem(doc), doc });
      } else if (JSON.stringify(upDoc) !== JSON.stringify(doc)) {
        edits.push({ id, before: this._docToItem(upDoc), after: this._docToItem(doc), doc });
      }
    }
    for (const [id, upDoc] of upDocs) {
      if (!branchDocs.has(id)) deletes.push({ id, before: this._docToItem(upDoc) });
    }
    return { adds, edits, deletes };
  }

  // Merge a local branch into main by applying its full-folder diff to main's
  // items/ and rebuilding main's index. Must be run from a different branch
  // (switch to main first). The branch folder is removed after a successful merge.
  mergeBranchLocally(name) {
    if (!name || name === 'main') throw new Error('Cannot merge the main branch into itself');
    if (this._branch === name) throw new Error(`Switch to main before merging branch "${name}"`);
    if (!this._branchExists(name)) throw new Error(`Branch "${name}" not found`);

    const diff = this.branchDiff(name);
    const mainItemsDir = path.join(this._branchRoot('main'), 'items');

    // Apply onto main's items/ tree (note: _itemPath/_itemDir target the ACTIVE
    // branch, which must be main here — enforced by the guard above + the usual
    // "switch to main first" workflow).
    const writeMainDoc = (id, doc) => {
      const [s1, s2] = this._shard(id);
      const dir = path.join(mainItemsDir, s1, s2, id);
      fs.mkdirSync(dir, { recursive: true });
      const p   = path.join(dir, 'item.json');
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
      fs.renameSync(tmp, p);
    };
    const deleteMainDoc = (id) => {
      const [s1, s2] = this._shard(id);
      const dir = path.join(mainItemsDir, s1, s2, id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    };

    for (const a of diff.adds)    writeMainDoc(a.id, a.doc);
    for (const e of diff.edits)   writeMainDoc(e.id, e.doc);
    for (const d of diff.deletes) deleteMainDoc(d.id);

    // index.db is fully derived — rebuild main's index from its files.
    this.rebuildIndexes();

    // Remove the merged branch folder.
    const dir = this._branchRoot(name);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

    return { merged: diff.adds.length + diff.edits.length + diff.deletes.length };
  }

  // ─── Integrity checks ─────────────────────────────────────────────────────

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
    if (run('missing-item-file')) {
      for (const item of this.loadAll()) {
        if (!fs.existsSync(this._itemPath(item.id))) {
          findings.push({
            check: 'missing-item-file', severity: 'error',
            nodeId: item.id,
            message: `item ${item.id} is in index but has no item.json on disk`,
            fix: 'run rebuildIndexes() to re-sync index from filesystem',
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
