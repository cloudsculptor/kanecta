import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import * as spec from '@kanecta/specification';
import { deriveSqlSchema, deriveIndexDdl, objTableName } from '@kanecta/schema-compiler';
import { validateItem } from '@kanecta/specification/validator';
import { WriteGuard } from './write-integrity.ts';

// Minimal structural type for the better-sqlite3 handle (the package ships no
// type declarations). Query methods return `any`/`any[]` so downstream
// .map/.filter/.sort callbacks infer `any` cleanly under noImplicitAny.
interface SqlStatement {
  get(...params: any[]): any;
  all(...params: any[]): any[];
  run(...params: any[]): any;
  iterate(...params: any[]): IterableIterator<any>;
}
interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  exec(sql: string): any;
  pragma(source: string, options?: any): any;
  close(): any;
}

const specVersion: string = spec.version;
const primitiveTypes = spec.primitiveTypes;
const builtInTypeItems: any[] = (spec as any).builtInTypeItems;
// Mandatory seed instances the platform depends on (the 19 built-in licences).
const builtInSystemItems: any[] = (spec as any).builtInSystemItems ?? [];

// ─── Icons (resolved on read, never stored on the item) ─────────────────────────
// Every item gets a MUI icon slug on read. It is resolved from the item's type:
//   typed object        → its type definition's payload.meta.icon
//   built-in/custom type → that type item's payload.meta.icon (by name)
//   primitive            → a single placeholder slug (refine per-primitive later)
//   reserved root/types  → fixed defaults
// The item.json never carries meta.icon.
const PRIMITIVE_TYPE_SET = new Set(primitiveTypes);
const PRIMITIVE_ICON = 'Stop';
const RESERVED_ICONS: Record<string, string> = { root: 'Home', types: 'Category' };
const FALLBACK_ICON  = 'Category';

const ROOT_ID    = '00000000-0000-0000-0000-000000000000';
const TYPES_NODE = '11111111-1111-1111-1111-111111111111';
const WELL_KNOWN_TYPES = new Set(['root', 'types']);
const WELL_KNOWN_ORDER = [];

// ─── Per-type table projection ──────────────────────────────────────────────
// Every user type with ≥1 live object instance is materialised as a real table
// `obj_<typeId>` whose columns/indexes are DERIVED from the type's jsonSchema by
// @kanecta/schema-compiler (never hand-authored). The table is created on the
// first live instance and dropped on hard-delete of the last, holding one row
// per live (non-soft-deleted) instance. The item.json in items/ stays the source
// of truth, so a full rebuild reconstructs the exact set of obj_ tables.

// camelCase → snake_case, IDENTICAL to the schema-compiler's column mapping so
// the columns we write line up with the DDL it emits.
const snakeCol = (k: string): string => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

// The compiler emits plain DDL (no guards); the adapter owns idempotency under
// the write lock. Add `IF NOT EXISTS` to both table and index creation.
const guardDdl = (stmt: string): string =>
  stmt
    .replace(/^CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^CREATE (UNIQUE )?INDEX /i, (_m, u) => `CREATE ${u || ''}INDEX IF NOT EXISTS `);

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

// Relationship types are first-class `relationship-type` items (spec
// §relationshipPayload), not string slugs. relate() resolves the preserved string
// API to the relationship-type item UUID it stores in relationship.payload.typeId.
// Sourced from the canonical seed items in @kanecta/specification — the same
// const-map approach this adapter uses for the built-in licence (DEFAULT_LICENSE),
// pending the shared sqlite metadata-types → obj_ cutover (relationship-type/
// alias/annotation/licence all still project to rebuildable index.db lookup tables
// here, not obj_<typeId> — a separate, consistent pass, tracked with the licence
// sqlite cutover).
const builtInRelationshipTypeItems: any[] = (spec as any).builtInRelationshipTypeItems ?? [];
const REL_TYPE_ID_BY_NAME: Record<string, string> = Object.fromEntries(
  builtInRelationshipTypeItems.map((i: any) => [i.item.value, i.item.id]),
);
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
  annotation:          '235d6155-db2a-4232-9548-8f5a66150d82',
};

// Metadata item types: real items (source of truth on disk) that back the derived
// lookup tables (history/aliases/relationships/annotations). They are NEVER stored
// only in index.db. They are excluded from ordinary content traversal — the spec
// calls them "metadata and tree structure, not graph edges".
const METADATA_TYPES = new Set(['item_history', 'activity', 'alias', 'relationship']);

// Built-in type name → its fixed type-item UUID (from @kanecta/specification),
// mirroring the Postgres adapter's BUILT_IN_TYPE_ID_BY_NAME. Used to resolve the
// obj_<typeId> projection table for a structured built-in metadata type.
const BUILT_IN_TYPE_ID_BY_NAME: Record<string, string> = Object.fromEntries(
  (builtInTypeItems ?? []).map((t: any) => [t.item.value, t.item.id]),
);

// Built-in type-item UUID → its type definition payload ({ jsonSchema, indexes, … }).
// Used as a fallback when projecting a built-in metadata instance during a rebuild
// that runs before the type items are seeded on disk (e.g. opening a migrated store,
// where _ensureBuiltInTypes runs after the initial _openDb rebuild).
const BUILT_IN_TYPE_DEF_BY_ID: Record<string, any> = Object.fromEntries(
  (builtInTypeItems ?? []).map((t: any) => [t.item.id, t.payload]),
);

// Structured built-in types that project to obj_<typeId>, matching the Postgres
// PROJECTED_BUILT_IN_TYPES allow-list. Grown one type per cutover as its bespoke
// lookup table is retired. (relationship-type is seeded as FK targets but its
// jsonSchema is empty — its projection is special-cased in Postgres and stays a
// follow-up, so it is intentionally absent here.)
const PROJECTED_BUILT_IN_TYPES = new Set(['relationship', 'alias', 'annotation', 'licence']);

class UnknownTypeError extends Error {
  code: string;
  typeName: string;
  constructor(typeName: any) {
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
  root: string;
  k: string;
  _db: any;
  _dbBranch: any;
  _config: any;
  _mem: Map<string, any>;
  _roots: any;
  _branch: string;
  _iconCache: any = null;

  constructor(root: any) {
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

  _shard(id: any) {
    // 2+2 sharding on the raw hex chars of the UUID (hyphens stripped)
    const hex = id.replace(/-/g, '');
    return [hex.slice(0, 2), hex.slice(2, 4)];
  }

  // Root folder of the active branch: .kanecta/branches/<encoded-name>
  _branchRoot(name?: any) {
    return path.join(this.k, 'branches', this._encodeBranchName(name ?? this._branch));
  }

  // The `store` selects which sibling tree under the branch root holds the file:
  //   'items'        — content items (the source of truth, default)
  //   'item-history' — item_history events (write-heavy; kept out of items/)
  //   'activity'     — activity events
  // Keeping history/activity in sibling trees keeps items/ pure, so branchDiff and
  // content traversal (which scan items/) never see them.
  _itemDir(id: any, store: any = 'items') {
    const [s1, s2] = this._shard(id);
    return path.join(this._branchRoot(), store, s1, s2, id);
  }

  _itemPath(id: any, store: any = 'items') {
    return path.join(this._itemDir(id, store), 'item.json');
  }

  // Read an item.json for the active branch. A full branch is a complete folder,
  // so this reads only its own file. A SPARSE branch layers: its own items/ wins
  // (a local tombstone masks the item → null), otherwise the read falls through
  // to the local upstream branch's file.
  _readItemJson(id: any, store: any = 'items') {
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
  _writeItemJson(id: any, doc: any, store: any = 'items') {
    const dir = this._itemDir(id, store);
    fs.mkdirSync(dir, { recursive: true });
    const p   = this._itemPath(id, store);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  }

  _deleteItemDir(id: any, store: any = 'items') {
    const dir = this._itemDir(id, store);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  // ─── Branch filesystem helpers ─────────────────────────────────────────────

  // Branch names encode `/` as `__` for the on-disk directory.
  _encodeBranchName(name: any) { return name.replace(/\//g, '__'); }

  // ─── Sparse-branch helpers ─────────────────────────────────────────────────
  // A sparse branch stores only its local changes in items/; the rest is read
  // through from an upstream branch. Its branch.json records `fill: 'sparse'`
  // and `upstream`. Deleted upstream items are masked by a tombstone item.json
  // (a doc with `tombstone: true`) in the local items/ tree.

  _branchManifest(name?: any) {
    const n = name ?? this._branch;
    try { return JSON.parse(fs.readFileSync(path.join(this._branchRoot(n), 'branch.json'), 'utf8')); }
    catch { return { name: n, fill: 'full', upstream: null }; }
  }

  _isSparse(name?: any) { return this._branchManifest(name).fill === 'sparse'; }

  // The LOCAL full branch a sparse branch reads through to. Remote upstreams are
  // federated at query time (deferred) and return null here. Full branches too.
  _localUpstream(name?: any) {
    const m = this._branchManifest(name ?? this._branch);
    if (m.fill !== 'sparse' || !m.upstream) return null;
    if (m.upstream.remote) return null;
    return m.upstream.branch ?? m.base ?? 'main';
  }

  _isTombstone(doc: any) { return !!doc && doc.tombstone === true; }

  _makeTombstone(id: any, parentId: any, actor: any, now: any) {
    return {
      tombstone: true,
      item:      { id, parentId: parentId ?? null },
      deletedAt: (now instanceof Date ? now : new Date()).toISOString(),
      deletedBy: actor ?? null,
    };
  }

  // The on-disk item.json path for `id` in a specific branch's items/ tree.
  _branchItemPath(branch: any, id: any, store: any = 'items') {
    const [s1, s2] = this._shard(id);
    return path.join(this._branchRoot(branch), store, s1, s2, id, 'item.json');
  }

  // Walk every item.json under items/ (or a custom dir).
  * _scanItemFiles(baseDir: any) {
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

  _guard(branch?: any) { return new WriteGuard(this._branchRoot(branch)); }

  _withWrite(ops: any, fn: any) {
    const guard = this._guard();
    guard.acquire();
    try {
      const recs = ops.map((o: any) => ({
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
  _rollback(opRecs: any) {
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
  _openDb(): SqlDatabase {
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

  static isDatastore(root: any) {
    return fs.existsSync(path.join(root, '.kanecta', 'branches', 'main', 'items'));
  }

  static init(root: any, owner: any) {
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

  static open(root: any) {
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
    adapter._ensureRelationshipTypeItems();
    adapter._ensureSystemItems();
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
  _buildDoc(itemSection: any, metaSection: any, payload: any, time: any, search: any) {
    return { item: itemSection, meta: metaSection, search: search ?? null, payload: payload ?? null, time: time ?? null };
  }

  // Five-section doc → flat item object (what the public API returns).
  _docToItem(doc: any) {
    if (!doc?.item || !doc?.meta) return null;
    const { item, meta } = doc;
    const out: any = {
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
  _itemToDoc(item: any, existingDoc: any = null) {
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
  _rowToItem(row: any) {
    if (!row) return null;
    const out: any = {
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

  _insertIndexTx(db: SqlDatabase, id: any, doc: any, itemPath: any) {
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
      for (const [key, entry] of Object.entries<any>(time)) {
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

    // Per-type table projection: a live object (or projected built-in metadata)
    // instance materialises its type's table and holds one row there. Runs on
    // create AND full/sparse rebuild (both route through here); soft-deleted
    // instances are skipped so a rebuild reconstructs exactly the live-row set.
    const projTypeId = this._projectionTypeId(item.type, item.typeId);
    if (projTypeId && !meta.deletedAt)
      this._projectObjectRow(db, id, projTypeId, payload ?? {});
  }

  // Project item_history events into their derived lookup. No-op for ordinary
  // content items. (alias/relationship/annotation now use obj_<typeId>.)
  _indexMetadataDoc(db: SqlDatabase, doc: any) {
    const { item } = doc;
    if (item.type === 'item_history') {
      // 'ITEM' mode: history events live in items/ and are picked up here.
      this._indexHistoryDoc(db, doc);
    }
  }

  // ─── Per-type table projection ────────────────────────────────────────────

  // Resolve the obj_<typeId> projection table for an item, mirroring the Postgres
  // adapter's projectionTypeId(). User objects project under their own typeId;
  // structured built-in metadata types (relationship, …) project under their fixed
  // type-item UUID. Returns null for anything that must not project (primitives,
  // logs, not-yet-cut-over built-ins).
  _projectionTypeId(type: any, typeId: any) {
    if (type === 'object') return typeId ?? null;
    if (PROJECTED_BUILT_IN_TYPES.has(type)) return BUILT_IN_TYPE_ID_BY_NAME[type] ?? null;
    return null;
  }

  // Create the `obj_<typeId>` table (and its declared indexes) if absent.
  // Idempotent (IF NOT EXISTS) and cheap to call on every object write. DDL is
  // derived from the type's jsonSchema; a malformed index declaration is skipped
  // with a warning rather than blocking the instance write.
  _ensureProjection(db: SqlDatabase, typeId: any, jsonSchema: any, indexes: any) {
    for (const stmt of deriveSqlSchema(jsonSchema, { typeId, dialect: 'sqlite' }))
      db.exec(guardDdl(stmt));
    try {
      for (const stmt of deriveIndexDdl(jsonSchema, indexes, { typeId, dialect: 'sqlite' }))
        db.exec(guardDdl(stmt));
    } catch (e: any) {
      console.warn(`[sqlite-fs] skipping indexes for type ${typeId}: ${e?.message ?? e}`);
    }
  }

  // Ensure the type's table exists and upsert this live instance's row into it.
  // No-op when the referenced type has no stored jsonSchema (unknown typeId).
  _projectObjectRow(db: SqlDatabase, id: any, typeId: any, payload: any) {
    // Prefer the on-disk type item; fall back to the static built-in definition so
    // a built-in metadata instance still projects during a rebuild that precedes
    // type-item seeding (e.g. opening a migrated store).
    const typeDef    = this.readTypeJson(typeId) ?? BUILT_IN_TYPE_DEF_BY_ID[typeId] ?? null;
    const jsonSchema = typeDef?.jsonSchema;
    if (!jsonSchema) return;   // unknown / schemaless type — nothing to project

    this._ensureProjection(db, typeId, jsonSchema, typeDef.indexes);

    const props = jsonSchema.properties || {};
    const cols  = ['item_id'];
    const vals: any[] = [id];
    for (const [name, prop] of Object.entries<any>(props)) {
      cols.push(snakeCol(name));
      let v = payload ? payload[name] : undefined;
      if (v === undefined) v = null;
      if (v !== null) {
        if (prop && prop.type === 'array')        v = JSON.stringify(v);
        else if (prop && prop.type === 'boolean') v = v ? 1 : 0;
        else if (typeof v === 'object')           v = JSON.stringify(v);
      }
      vals.push(v);
    }
    const table = objTableName(typeId);
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    db.prepare(`INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${placeholders})`).run(...vals);
  }

  // Remove an instance's row from its type table (guarded — the table may not
  // exist). Keeps the table itself; dropping is a separate, hard-delete concern.
  _unprojectObjectRow(db: SqlDatabase, typeId: any, id: any) {
    try { db.prepare(`DELETE FROM "${objTableName(typeId)}" WHERE item_id = ?`).run(id); }
    catch { /* table absent — nothing to remove */ }
  }

  // Drop the type table when it has no remaining live (non-soft-deleted)
  // instances. Called only on hard-delete / typeId reassignment — soft-delete
  // keeps the table so a restore can repopulate it.
  _dropProjectionIfEmpty(db: SqlDatabase, typeId: any) {
    const row = db.prepare(
      `SELECT COUNT(*) AS n FROM items i
         LEFT JOIN items_meta m ON m.item_id = i.id
        WHERE i.type_id = ? AND m.deleted_at IS NULL`,
    ).get(typeId);
    if (!row || row.n === 0) db.exec(`DROP TABLE IF EXISTS "${objTableName(typeId)}"`);
  }

  // Every materialised per-type table. Used by integrity checks and mirrors the
  // Postgres adapter's handle surface.
  listProjectedRelations() {
    return this._openDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'obj\\_%' ESCAPE '\\'`)
      .all()
      .map((r: any) => r.name);
  }

  // Write a metadata item (alias/relationship/annotation) as a real item.json in
  // items/ — the source of truth — and project it into its derived lookup table.
  // No history snapshot is taken for metadata items.
  _metaItem(fields: any) {
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

  _writeMetadataItem(doc: any) {
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
  _deleteMetadataItem(db: SqlDatabase, itemId: any, type: any) {
    this._deleteItemDir(itemId);
    db.prepare('DELETE FROM items_meta    WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM items_payload WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM items_search  WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM items_time    WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM item_tags     WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM backlinks     WHERE source_id = ?').run(itemId);
    db.prepare('DELETE FROM items         WHERE id = ?').run(itemId);
    // The obj_<relationship>/obj_<alias>/obj_<annotation> rows cascaded away with
    // the items row (FK ON DELETE CASCADE) — nothing bespoke left to clean up.
  }

  // When a content item is deleted, cascade-delete the metadata items that hang
  // off it: relationships in either direction, annotations on it, aliases to it.
  // Keeps the derived tables consistent with items/ after a rebuild.
  _cascadeDeleteMetadata(db: SqlDatabase, id: any) {
    for (const r of this._relItemsTouching(db, id))
      this._deleteMetadataItem(db, r.id, 'relationship');
    for (const a of this._annotationItemsTargeting(db, id))
      this._deleteMetadataItem(db, a.id, 'annotation');
    for (const a of this._aliasItemsTargeting(db, id))
      if (a.id) this._deleteMetadataItem(db, a.id, 'alias');
  }

  _updateIndexMeta(db: SqlDatabase, id: any, meta: any, tags: any) {
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
  _getRow(db: SqlDatabase, id: any) {
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

  _rebuildFromFs(db: SqlDatabase) {
    const itemsDir = path.join(this._branchRoot(), 'items');
    // First pass: read all item.json files and collect items
    const docs: any[] = [];
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
  _rebuildFromFsSparse(db: SqlDatabase) {
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
  _indexDocs(db: SqlDatabase, docs: any) {
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
    const docById = new Map(docs.map((d: any) => [d.item.id, d]));
    const paths   = new Map();

    const computePath = (id: any, parentPath: any): void => {
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
      // Defer FK enforcement to commit: obj_<typeId> projections carry FKs to
      // items(id) (e.g. relationship.source_id/target_id/type_id), but the fs is
      // scanned in tree order, so an edge may be projected before its endpoint
      // row is inserted. All rows exist by commit, when the deferred check runs.
      db.exec('PRAGMA defer_foreign_keys = ON');
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
  _eventType(changeType: any) {
    if (changeType === 'create')  return 'created';
    if (changeType === 'delete')  return 'deleted';
    return 'updated';
  }

  _nextHistorySeq(db: SqlDatabase, targetId: any) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM history WHERE item_id = ?').get(targetId);
    return (row?.n ?? 0) + 1;
  }

  _snapshot(db: SqlDatabase, item: any, changeType: any, changedBy: any, now: any) {
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
  _indexHistoryDoc(db: SqlDatabase, histDoc: any) {
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
  _rebuildHistoryFromFs(db: SqlDatabase) {
    const dir = path.join(this._branchRoot(), 'item-history');
    const docs: any[] = [];
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

  _getPath(id: any) {
    const row = this._openDb().prepare('SELECT path FROM items WHERE id = ?').get(id);
    return row?.path ?? null;
  }

  _pathDepth(p: any) {
    if (!p) return 0;
    return (p.match(/\//g) || []).length;
  }

  _cascadePathUpdate(db: SqlDatabase, id: any, newPath: any) {
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

  _isSyntheticId(id: any) { return typeof id === 'string' && id.includes('__'); }

  _parseSyntheticId(id: any) {
    const sep = id.indexOf('__');
    return { realId: id.slice(0, sep), fieldPath: id.slice(sep + 2) };
  }

  _toTitleCase(key: any) {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c: any) => c.toUpperCase());
  }

  _buildSyntheticNode(realId: any, parentId: any, key: any, val: any, fieldPath: any, sortOrder: any) {
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

  _buildValueLeaf(realId: any, parentFieldPath: any, val: any) {
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

  _buildSyntheticChildren(realId: any, obj: any, parentId: any, prefix: any = '') {
    return Object.entries(obj).map(([key, val], i) => {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      return this._buildSyntheticNode(realId, parentId, key, val, fieldPath, i);
    });
  }

  // ─── Link extraction ───────────────────────────────────────────────────────

  _parseLinks(value: any) {
    if (!value || typeof value !== 'string') return [];
    const links = new Set();
    const re    = new RegExp(LINK_SOURCE, 'g');
    let m;
    while ((m = re.exec(value)) !== null) links.add(m[1]);
    return [...links];
  }

  // ─── Well-known root nodes ─────────────────────────────────────────────────

  _createWellKnownNode(id: any, parentId: any, type: any, sortOrder: any) {
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
    this._ensureRelationshipTypeItems();
    this._ensureSystemItems();
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

  // Seed the 9 canonical relationship-type items (relates-to, depends-on, …) as
  // real items under the relationship-type type node, with their fixed UUIDs, from
  // @kanecta/specification. They are the FK targets of relationship.payload.typeId
  // once relationships project to obj_<relationship> (relationship.type_id →
  // items(id)). Idempotent: only writes the ones not already present, so it
  // backfills existing datastores on open as well as seeding fresh ones at init.
  _ensureRelationshipTypeItems() {
    const db = this._openDb();
    const parentId   = TYPE_ITEM_UUIDS['relationship-type'];
    const typesPath  = this._getPath(TYPES_NODE) ?? TYPES_NODE;
    const parentPath = this._getPath(parentId) ?? `${typesPath}/${parentId}`;
    let wrote = false;
    db.transaction(() => {
      for (const src of builtInRelationshipTypeItems) {
        const id = src.item.id;
        if (this._getRow(db, id)) continue;            // already seeded
        const doc = { item: src.item, meta: src.meta, search: src.search ?? null, payload: src.payload ?? null, time: src.time ?? null };
        this._writeItemJson(id, doc);
        this._insertIndexTx(db, id, doc, `${parentPath}/${id}`);
        wrote = true;
      }
    })();
    if (wrote) this._mem.clear();
  }

  // Seed the mandatory built-in system items (the 19 licences, incl. the default
  // DEFAULT_LICENSE) as real `licence` items under the licence type container, from
  // @kanecta/specification, projecting {spdxId,name,url,text} → obj_<licence> —
  // mirroring the Postgres adapter's _ensureSystemItems. This gives DEFAULT_LICENSE
  // (referenced by every item's meta.license) a real backing item. Idempotent:
  // backfills on open. (sqlite has no items.license FK, so no reparent dance.)
  _ensureSystemItems() {
    if (!builtInSystemItems.length) return;
    const db = this._openDb();
    const licenceTypeId = BUILT_IN_TYPE_ID_BY_NAME['licence'];
    if (!licenceTypeId) return;
    const typesPath  = this._getPath(TYPES_NODE) ?? TYPES_NODE;
    const parentPath = this._getPath(licenceTypeId) ?? `${typesPath}/${licenceTypeId}`;
    let wrote = false;
    db.transaction(() => {
      for (const src of builtInSystemItems) {
        const id = src.item.id;
        if (this._getRow(db, id)) continue;            // already seeded
        // Build a full 5-section doc from the seed's minimal meta.
        const doc = this._metaItem({
          id, parentId: src.item.parentId ?? licenceTypeId, typeId: licenceTypeId,
          type: src.item.type ?? 'licence', value: src.item.value,
          owner: src.meta?.owner ?? this.config.owner,
          license: src.meta?.license ?? DEFAULT_LICENSE,
          visibility: src.meta?.visibility ?? 'public',
          layer: src.meta?.layer ?? 'core',
        });
        doc.payload = src.payload ?? {};
        this._writeItemJson(id, doc);
        this._insertIndexTx(db, id, doc, `${parentPath}/${id}`);
        wrote = true;
      }
    })();
    if (wrote) this._mem.clear();
  }

  // ─── Icon resolution (derived on read; never stored on the item) ─────────────

  // type-name → icon and typeId → icon, built once from the seeded type items.
  _iconMaps() {
    if (this._iconCache) return this._iconCache;
    const byName: any = {}, byId: any = {};
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
  _resolveIcon(item: any) {
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

  // ─── Item CRUD ─────────────────────────────────────────────────────────────

  // Next sortOrder among REAL content siblings. Excludes synthetic payload-field
  // nodes (they are not rows in `items`), the structural root/types nodes, and
  // metadata/type items — so content items order among themselves from 0 and are
  // never pushed down by, e.g., the root node's rendered payload fields.
  _nextSortOrder(parentId: any, aspect: any) {
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
    sourceSystem = null, sourceExternalId = null,
    strict,
  }: any = {}) {
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

    // Enforce the type's jsonSchema on a supplied payload before persisting.
    // A shell create (objectData omitted) is not validated here — it will be
    // validated when the payload is written via writeObjectJson.
    if (type === 'object' && typeId && objectData != null)
      this._validateObjectPayload(typeId, objectData);

    const resolvedPayload = (type === 'object' && typeId) ? (objectData ?? {}) : null;

    const item: any = {
      id, specVersion, parentId, value, type,
      typeId: type === 'object' ? (typeId || null) : null,
      owner: ownerVal, license: license ?? DEFAULT_LICENSE,
      visibility, aspect, sortOrder, confidence, status,
      tags: [...tags],
      createdAt: now.toISOString(), modifiedAt: now.toISOString(),
      createdBy: actor, modifiedBy: actor,
      cachedAt: null, expiresAt: null, deletedAt: null,
      connectorId: null, materialized: null, completedAt: null, dueAt,
      layer: null, sourceSystem, sourceExternalId, files: {},
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

  get(id: any) {
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

  resolveAlias(alias: any) {
    const row = this._aliasItemByValueSafe(this._openDb(), alias);
    return row ? row.target_id : null;
  }

  resolve(idOrAlias: any) {
    if (UUID_RE.test(idOrAlias)) return this.get(idOrAlias);
    const id = this.resolveAlias(idOrAlias);
    return id ? this.get(id) : null;
  }

  update(id: any, changes: any, actor: any, { strict }: any = {}) {
    const current = this.get(id);
    if (!current) throw new Error(`Item not found: ${id}`);
    // The root node is renamable — its `value` (and other descriptive fields)
    // may be edited so a datastore can be given a meaningful name — but its
    // structural fields stay locked so it remains the self-parented type:'root'
    // anchor. It still can't be deleted (softDelete keeps _assertEditable). Every
    // other reserved node (the types container) stays fully immutable.
    if (current.id === ROOT_ID) {
      const LOCKED_ROOT_FIELDS = ['type', 'typeId', 'parentId', 'sortOrder', 'aspect'];
      for (const f of LOCKED_ROOT_FIELDS)
        if (f in changes && changes[f] !== current[f])
          throw new Error(`The root node's '${f}' cannot be changed`);
    } else {
      this._assertEditable(current, id);
    }

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

      // Per-type table projection: reconcile membership when the item's type,
      // typeId, or live/soft-deleted state changes. `updated` is already written
      // to items above, so N(T) counts see the new type_id.
      const prevObj  = current.type === 'object' && current.typeId;
      const nextObj  = updated.type === 'object' && updated.typeId;
      const nextLive = nextObj && !updated.deletedAt;
      if (prevObj && (!nextObj || current.typeId !== updated.typeId)) {
        // Left the previous type entirely (type changed or reassigned typeId).
        this._unprojectObjectRow(db, current.typeId, id);
        this._dropProjectionIfEmpty(db, current.typeId);
      }
      if (nextLive) {
        this._projectObjectRow(db, id, updated.typeId, existingDoc?.payload ?? {});
      } else if (nextObj && prevObj && current.typeId === updated.typeId) {
        // Soft-deleted in place (same type): drop the row, keep the table.
        this._unprojectObjectRow(db, updated.typeId, id);
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

  deleteWarnings(id: any) {
    const bl   = this.backlinks(id);
    const rels = this.relationships(id);
    const w: any[] = [];
    if (bl.length)                   w.push(`${bl.length} item(s) link to this via [[uuid]] syntax`);
    if ((rels.inbound || []).length) w.push(`${rels.inbound.length} inbound relationship(s) point to this item`);
    return w;
  }

  delete(id: any, actor: any) {
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
        // Defer FK enforcement to commit: the cascade deletes threaded annotation
        // items whose obj_<annotation>.parent_annotation_id references each other,
        // and the target item this metadata points at — order-independent once all
        // deletes are staged and the check runs at commit.
        db.exec('PRAGMA defer_foreign_keys = ON');
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
        // The obj_ row cascaded away with the items row (FK ON DELETE CASCADE).
        // On a full-branch hard delete, drop the type table if this was the last
        // live instance. Sparse tombstones mask an upstream item ("not gone") so
        // they keep the table.
        const projTypeId = this._projectionTypeId(item.type, item.typeId);
        if (!sparse && projTypeId)
          this._dropProjectionIfEmpty(db, projTypeId);
      })();
    });

    return { warnings };
  }

  // The item ids the delete cascade will remove (relationships either direction,
  // annotations on the item, aliases to it) — so _withWrite can journal them.
  _cascadeMetadataOps(db: SqlDatabase, id: any) {
    const ids = new Set();
    for (const r of this._relItemsTouching(db, id)) ids.add(r.id);
    for (const a of this._annotationItemsTargeting(db, id)) ids.add(a.id);
    for (const a of this._aliasItemsTargeting(db, id)) if (a.id) ids.add(a.id);
    return [...ids].map(x => ({ id: x, store: 'items' }));
  }

  softDelete(id: any, actor: any) {
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
        // No longer live: drop its type-table row but keep the table (a restore
        // can repopulate it).
        if (item.type === 'object' && item.typeId)
          this._unprojectObjectRow(db, item.typeId, id);
      })();
    });

    return updated;
  }

  restore(id: any, actor: any) {
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
        // Live again: recreate the table if it was dropped and re-add the row.
        if (item.type === 'object' && item.typeId)
          this._projectObjectRow(db, id, item.typeId, existingDoc?.payload ?? {});
      })();
    });

    return updated;
  }

  // ─── Payload sidecars (read/write item.json payload section) ──────────────

  readObjectJson(id: any) {
    if (this._isSyntheticId(id)) return null;
    const doc = this._readItemJson(id);
    if (!doc) return null;
    return doc.payload ?? null;
  }

  // Validate a typed object's payload against its type's jsonSchema before it is
  // persisted. Skips silently when there is no payload or no resolvable jsonSchema
  // (nothing to validate against). Throws a PayloadValidationError on a schema
  // violation so invalid typed objects never reach items_payload.
  _validateObjectPayload(typeId: any, data: any) {
    if (!typeId || data == null) return;
    const typeJson = this.readTypeJson(typeId);
    if (!typeJson || typeof typeJson.jsonSchema !== 'object') return;
    const result = validateItem(data, typeJson);
    if (!result.valid) {
      const err: any = new Error(
        `Object payload failed validation for type ${typeId}: ` +
        result.errors.map((e: any) => `${e.path || '(root)'}: ${e.message}`).join('; '),
      );
      err.name = 'PayloadValidationError';
      err.code = 'INVALID_PAYLOAD';
      err.validationErrors = result.errors;
      throw err;
    }
  }

  writeObjectJson(id: any, data: any) {
    const doc = this._readItemJson(id);
    if (!doc) throw new Error(`Item not found: ${id}`);
    this._validateObjectPayload(doc.item?.typeId, data);
    doc.payload = data;
    const db = this._openDb();
    this._withWrite([{ id, store: 'items' }], () => {
      this._writeItemJson(id, doc);
      const row = db.prepare('SELECT item_id FROM items_payload WHERE item_id = ?').get(id);
      if (row) db.prepare('UPDATE items_payload SET payload = ? WHERE item_id = ?').run(JSON.stringify(data), id);
      else     db.prepare('INSERT INTO items_payload (item_id, payload) VALUES (?, ?)').run(id, JSON.stringify(data));
      // Refresh the per-type table row so its columns track the new payload.
      const projTypeId = this._projectionTypeId(doc.item?.type, doc.item?.typeId);
      if (projTypeId && !doc.meta?.deletedAt)
        this._projectObjectRow(db, id, projTypeId, data ?? {});
      this._mem.delete(id);
    });
  }

  readFunctionJson(id: any) {
    if (this._isSyntheticId(id)) return null;
    const doc = this._readItemJson(id);
    return doc?.payload ?? null;
  }

  writeFunctionJson(id: any, data: any) {
    this.writeObjectJson(id, data);
  }

  readScheduleJson(id: any) {
    if (this._isSyntheticId(id)) return null;
    const doc = this._readItemJson(id);
    return doc?.payload ?? null;
  }

  writeScheduleJson(id: any, data: any) {
    this.writeObjectJson(id, data);
  }

  // ─── Document type helpers ─────────────────────────────────────────────────

  // Stable UUID of the synthetic 'document' type item — seeded from
  // built-in-types/types/document.json and identical across all installations.
  static get DOCUMENT_TYPE_UUID() { return 'b4e2f1c3-a0d5-4e6f-8b9c-d7f2e1a3b5c0'; }

  createDocument(targetId: any, name: any, {
    mode = 'document',
    expandState = null,
    roleMap = null,
    isOrgDefault = false,
    baseDocumentId = null,
    owner, visibility = 'private',
  }: any = {}) {
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
      mode,
      expandState: expandState ?? { defaultDepth: 2, exceptions: {} },
      roleMap: roleMap ?? { byDepth: { '1': 'heading', '2': 'subheading', '3': 'body' }, byType: {} },
      isOrgDefault,
      baseDocumentId: baseDocumentId ?? null,
    };
    this.writeObjectJson(item.id, payload);
    return item;
  }

  readDocumentPayload(id: any) {
    return this.readObjectJson(id);
  }

  writeDocumentPayload(id: any, payload: any) {
    const doc = this._readItemJson(id);
    if (!doc) throw new Error(`Item not found: ${id}`);
    if (doc.item?.type !== 'document') throw new Error(`Item ${id} is not a document`);
    this.writeObjectJson(id, payload);
  }

  listDocuments(targetId: any) {
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

  listDueSchedules(beforeAt: any) {
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

  getDocument(id: any) {
    if (this._isSyntheticId(id)) return null;
    return this._readItemJson(id) ?? null;
  }

  readTimeJson(id: any) {
    if (this._isSyntheticId(id)) return null;
    const doc = this._readItemJson(id);
    return doc?.time ?? null;
  }

  writeTimeJson(id: any, data: any) {
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
      for (const [key, entry] of Object.entries<any>(data)) {
        if (!entry) continue;
        ins.run(id, key, entry.startAt ?? null, entry.endAt ?? null, entry.recurrenceRule ?? null,
                JSON.stringify(entry.recurrenceExceptions ?? []), entry.nextOccurrenceAt ?? null, entry.completedAt ?? null);
      }
    }
    this._mem.delete(id);
  }

  deleteTimeJson(id: any) {
    const doc = this._readItemJson(id);
    if (!doc) return;
    doc.time = null;
    this._writeItemJson(id, doc);
    this._openDb().prepare('DELETE FROM items_time WHERE item_id = ?').run(id);
    this._mem.delete(id);
  }

  // ─── Connector queries ─────────────────────────────────────────────────────

  listStubs(connectorId: any) {
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

  listDueForRefresh(beforeAt: any) {
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

  createType(value: any, { schema, createdBy, id: explicitId, icon }: any = {}) {
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

    const item: any = {
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

  readTypeJson(id: any) {
    const doc = this._readItemJson(id);
    return doc?.payload ?? null;
  }

  writeTypeJson(id: any, data: any) {
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

  _getTypeName(typeId: any) {
    if (!typeId) return null;
    const row = this._openDb().prepare(`SELECT value FROM items WHERE id = ? AND type = 'type'`).get(typeId);
    return row ? row.value : null;
  }

  _guardTypeIdRef(typeId: any, strict: any) {
    const effectiveStrict = strict !== undefined ? !!strict : !!this.config.strictTypeIds;
    if (effectiveStrict) {
      const err: any = new Error(`unknown typeId "${typeId}" — no registered type definition`);
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

  resolveTypeId(name: any) {
    if (!name) return { unknown: true };
    if (VALID_TYPES.includes(name)) return { primitive: true };
    const row = this._openDb()
      .prepare(`SELECT id FROM items WHERE type = 'type' AND value = ? LIMIT 1`)
      .get(name);
    return row ? { id: row.id } : { unknown: true };
  }

  // ─── Aliases ───────────────────────────────────────────────────────────────

  setAlias(alias: any, id: any) {
    const db = this._openDb();
    // Overwrite: drop any existing alias item carrying this string first.
    const existing = this._aliasItemByValueSafe(db, alias);
    if (existing?.item_id) db.transaction(() => this._deleteMetadataItem(db, existing.item_id, 'alias'))();

    const now = new Date().toISOString();
    // An `alias` item projected to obj_<alias>: the string is item.value; the
    // payload holds targetId/assignedBy/provisional/confirmedAt/computedFromFormulaId.
    const doc = this._metaItem({
      id: crypto.randomUUID(), parentId: TYPE_ITEM_UUIDS.alias, typeId: TYPE_ITEM_UUIDS.alias,
      type: 'alias', value: alias,
    });
    doc.payload = { targetId: id, assignedBy: null, provisional: false, confirmedAt: now, computedFromFormulaId: null };
    this._writeMetadataItem(doc);
  }

  removeAlias(alias: any) {
    const db = this._openDb();
    const existing = this._aliasItemByValueSafe(db, alias);
    if (existing?.item_id) db.transaction(() => this._deleteMetadataItem(db, existing.item_id, 'alias'))();
  }

  listAliases() {
    const db = this._openDb();
    try {
      return db.prepare(
        `SELECT i.value AS alias, o.target_id AS target_id
           FROM items i JOIN "${objTableName(TYPE_ITEM_UUIDS.alias)}" o ON o.item_id = i.id
           LEFT JOIN items_meta m ON m.item_id = i.id
          WHERE i.type = 'alias' AND m.deleted_at IS NULL
          ORDER BY i.value`,
      ).all().map((r: any) => ({ alias: r.alias, targetId: r.target_id }));
    } catch { return []; }
  }

  // ─── Annotations ───────────────────────────────────────────────────────────

  annotate(targetId: any, { author, content, parentAnnotationId = null }: any = {}) {
    const id     = crypto.randomUUID();
    const now    = new Date();
    const actor  = author || this.config.owner;
    const ann    = { id, targetId, author: actor, content, createdAt: now.toISOString(), parentAnnotationId };

    // Annotation is a real `annotation` item.json under the annotation type-UUID
    // container (universal placement rule), in the "comments" aspect so it stays
    // out of default content traversal; it associates via payload.targetId and
    // projects to obj_<annotation> {targetId, body, parentAnnotationId}. Author =
    // createdBy, timestamp = createdAt. The item.json is the source of truth.
    const doc = this._metaItem({
      id, parentId: TYPE_ITEM_UUIDS.annotation, typeId: TYPE_ITEM_UUIDS.annotation, type: 'annotation',
      value: typeof content === 'string' ? content.slice(0, 255) : null,
      aspect: 'comments', layer: 'user',
      owner: actor, createdBy: actor, modifiedBy: actor, createdAt: now.toISOString(), modifiedAt: now.toISOString(),
    });
    doc.payload = { targetId, body: content, parentAnnotationId };
    this._writeMetadataItem(doc);
    return ann;
  }

  annotations(targetId: any) {
    const db    = this._openDb();
    const table = objTableName(TYPE_ITEM_UUIDS.annotation);
    try {
      return db.prepare(
        `SELECT i.id AS id, o.target_id AS target_id, o.body AS body,
                o.parent_annotation_id AS parent_annotation_id,
                m.created_at AS created_at, m.created_by AS created_by
           FROM items i JOIN "${table}" o ON o.item_id = i.id
           LEFT JOIN items_meta m ON m.item_id = i.id
          WHERE i.type = 'annotation' AND o.target_id = ? AND m.deleted_at IS NULL
          ORDER BY m.created_at, i.id`,
      ).all(targetId).map((r: any) => ({
        id: r.id, targetId: r.target_id, author: r.created_by,
        content: r.body, createdAt: r.created_at,
        parentAnnotationId: r.parent_annotation_id,
      }));
    } catch { return []; }
  }

  // ─── Relationships ─────────────────────────────────────────────────────────

  get relTypes() {
    const extra = Array.isArray(this.config.relTypes) ? this.config.relTypes : [];
    return [...new Set([...VALID_REL_TYPES, ...extra])];
  }

  addRelTypes(names: any) {
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

  relate(sourceId: any, type: any, targetId: any, { createdBy, note = null }: any = {}) {
    if (!this.relTypes.includes(type))
      throw new Error(`Invalid relationship type: ${type}. Valid: ${this.relTypes.join(', ')}`);
    const now   = new Date();
    const actor = createdBy || this.config.owner;
    const relId = crypto.randomUUID();

    // A relationship is a real `relationship` item.json (the source of truth); the
    // relationships table is a derived projection. The relationship-type slug lives
    // in item.value; source/target and the resolved relationship-type UUID live in
    // the payload (payload.typeId → the relationship-type item, spec
    // §relationshipPayload). User-defined types not in the canonical set resolve to
    // null (slug-only) until they too are seeded as relationship-type items.
    const doc = this._metaItem({
      id: relId, parentId: TYPE_ITEM_UUIDS.relationship, typeId: TYPE_ITEM_UUIDS.relationship,
      type: 'relationship', value: type,
      layer: 'user', owner: actor, createdBy: actor, modifiedBy: actor,
      createdAt: now.toISOString(), modifiedAt: now.toISOString(),
    });
    doc.payload = {
      typeId: REL_TYPE_ID_BY_NAME[type] ?? null,
      sourceId, targetId, data: null, confidence: null, note,
    };
    this._writeMetadataItem(doc);
    return { id: relId, sourceId, targetId, type, createdAt: now.toISOString(), createdBy: actor, note };
  }

  relationships(id: any) {
    const db    = this._openDb();
    const table = objTableName(TYPE_ITEM_UUIDS.relationship);
    // The relationship-type slug lives on the relationship item's value; source/
    // target/note on obj_<relationship>; created_at/created_by on the item envelope
    // (items_meta). The obj_ table is lazily created, so an empty store has no
    // table yet → treat "no such table" as no relationships.
    try {
      const out = db.prepare(
        `SELECT i.id AS id, i.value AS type, o.target_id AS target_id,
                m.created_at AS created_at, m.created_by AS created_by, o.note AS note
           FROM "${table}" o JOIN items i ON i.id = o.item_id
           LEFT JOIN items_meta m ON m.item_id = i.id
          WHERE o.source_id = ? AND m.deleted_at IS NULL`,
      ).all(id).map((r: any) => ({ id: r.id, targetId: r.target_id, type: r.type, createdAt: r.created_at, createdBy: r.created_by, note: r.note }));
      const inn = db.prepare(
        `SELECT i.id AS id, i.value AS type, o.source_id AS source_id,
                m.created_at AS created_at, m.created_by AS created_by, o.note AS note
           FROM "${table}" o JOIN items i ON i.id = o.item_id
           LEFT JOIN items_meta m ON m.item_id = i.id
          WHERE o.target_id = ? AND m.deleted_at IS NULL`,
      ).all(id).map((r: any) => ({ id: r.id, sourceId: r.source_id, type: r.type, createdAt: r.created_at, createdBy: r.created_by, note: r.note }));
      return { outbound: out, inbound: inn };
    } catch { return { outbound: [], inbound: [] }; }
  }

  // Relationship item ids touching an item in either direction (cascade helper).
  // Guarded — obj_<relationship> may not be materialised yet.
  _relItemsTouching(db: SqlDatabase, id: any): any[] {
    const table = objTableName(TYPE_ITEM_UUIDS.relationship);
    try { return db.prepare(`SELECT item_id AS id FROM "${table}" WHERE source_id = ? OR target_id = ?`).all(id, id); }
    catch { return []; }
  }

  // The live alias item carrying this string (its value), or undefined. The alias
  // string is item.value; obj_<alias> holds target_id/… Guarded for the lazily
  // materialised table. Case-sensitive exact match, preserving prior behaviour.
  _aliasItemByValue(db: SqlDatabase, alias: any): any {
    return db.prepare(
      `SELECT i.id AS item_id, o.target_id AS target_id
         FROM items i JOIN "${objTableName(TYPE_ITEM_UUIDS.alias)}" o ON o.item_id = i.id
         LEFT JOIN items_meta m ON m.item_id = i.id
        WHERE i.type = 'alias' AND i.value = ? AND m.deleted_at IS NULL LIMIT 1`,
    ).get(alias);
  }
  _aliasItemByValueSafe(db: SqlDatabase, alias: any): any {
    try { return this._aliasItemByValue(db, alias); } catch { return undefined; }
  }

  // Alias item ids pointing at a target item (cascade helper). Guarded.
  _aliasItemsTargeting(db: SqlDatabase, id: any): any[] {
    const table = objTableName(TYPE_ITEM_UUIDS.alias);
    try { return db.prepare(`SELECT item_id AS id FROM "${table}" WHERE target_id = ?`).all(id); }
    catch { return []; }
  }

  // Annotation item ids on a target item (cascade helper). Guarded.
  _annotationItemsTargeting(db: SqlDatabase, id: any): any[] {
    const table = objTableName(TYPE_ITEM_UUIDS.annotation);
    try { return db.prepare(`SELECT item_id AS id FROM "${table}" WHERE target_id = ?`).all(id); }
    catch { return []; }
  }

  backlinks(id: any) {
    return this._openDb().prepare('SELECT source_id FROM backlinks WHERE target_id = ?').all(id)
      .map(r => r.source_id);
  }

  listRelationships() {
    const db    = this._openDb();
    const table = objTableName(TYPE_ITEM_UUIDS.relationship);
    try {
      return db.prepare(
        `SELECT i.id AS id, i.value AS type, o.source_id AS source_id, o.target_id AS target_id,
                o.note AS note, m.created_at AS created_at, m.created_by AS created_by
           FROM "${table}" o JOIN items i ON i.id = o.item_id
           LEFT JOIN items_meta m ON m.item_id = i.id
          WHERE m.deleted_at IS NULL
          ORDER BY m.created_at`,
      ).all().map((r: any) => ({ id: r.id, sourceId: r.source_id, targetId: r.target_id, type: r.type, note: r.note, createdAt: r.created_at, createdBy: r.created_by }));
    } catch { return []; }
  }

  // ─── History ───────────────────────────────────────────────────────────────

  history(id: any) {
    return this._openDb()
      .prepare('SELECT * FROM history WHERE item_id = ? ORDER BY changed_at, change_type')
      .all(id)
      .map(r => JSON.parse(r.snapshot));
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  byTag(tag: any) {
    return this._openDb().prepare('SELECT item_id FROM item_tags WHERE tag = ?').all(tag)
      .map(r => r.item_id);
  }

  byType(typeId: any) {
    return this._openDb().prepare('SELECT id FROM items WHERE type_id = ?').all(typeId)
      .map(r => r.id);
  }

  // Look up a single item by its external-source key. (source_system,
  // source_external_id) is UNIQUE, so this is the idempotency primitive for
  // ingestion: upsert = bySource() ? update() : create(). Returns the read-model
  // item or null.
  bySource(sourceSystem: any, sourceExternalId: any) {
    if (!sourceSystem || !sourceExternalId) return null;
    const row = this._openDb().prepare(
      'SELECT item_id FROM items_meta WHERE source_system = ? AND source_external_id = ?'
    ).get(sourceSystem, sourceExternalId);
    return row ? this.get(row.item_id) : null;
  }

  loadAll() {
    return this._openDb().prepare(`
      SELECT i.*, m.owner, m.license, m.visibility, m.confidence, m.status, m.tags,
             m.created_at, m.modified_at, m.created_by, m.modified_by,
             m.completed_at, m.due_at, m.expires_at, m.deleted_at, m.cached_at,
             m.connector_id, m.materialized, m.files, m.layer,
             m.source_system, m.source_external_id, m.icon
      FROM items i LEFT JOIN items_meta m ON m.item_id = i.id
      WHERE i.type NOT IN ('alias', 'relationship', 'relationship-type', 'annotation', 'licence', 'item_history', 'type')
    `).all().map(r => this._rowToItem(r));
  }

  // ─── Tree ──────────────────────────────────────────────────────────────────

  children(parentId: any, aspect: any = null) {
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

  tree(rootId: any, maxDepth: any = Infinity) {
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

    // Metadata items (alias/relationship/annotation live under their type-UUID
    // container, associating via a payload ref) are not part of the content tree.
    const exclude = " AND i.type NOT IN ('root', 'types', 'alias', 'relationship', 'relationship-type', 'annotation', 'licence', 'item_history', 'type')";
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
    for (const arr of byParent.values()) arr.sort((a: any, b: any) => a.sortOrder - b.sortOrder);

    const itemById = new Map(subtreeItems.map(i => [i.id, i]));
    const result: any[] = [];

    const traverse = (id: any, depth: any): void => {
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

  _treeSlow(rootId: any, maxDepth: any, implicitRoot: any) {
    const all      = this.loadAll();
    const byParent = new Map();
    for (const item of all) {
      if (item.id === item.parentId) continue;
      if (!byParent.has(item.parentId)) byParent.set(item.parentId, []);
      byParent.get(item.parentId).push(item);
    }
    for (const arr of byParent.values()) arr.sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    const result: any[] = [];
    const traverse = (id: any, depth: any): void => {
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

  ancestors(id: any) {
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
    return ancestorIds.map((aid: any) => byId.get(aid)).filter(Boolean);
  }

  subtreeCount(rootId: any) {
    const row = this._openDb().prepare('SELECT path FROM items WHERE id = ?').get(rootId);
    if (!row?.path) return 0;
    const r = this._openDb().prepare(
      `SELECT COUNT(*) AS cnt FROM items WHERE (path = ? OR path LIKE ?)
       AND type NOT IN ('alias', 'relationship', 'relationship-type', 'annotation', 'licence', 'item_history', 'type')`
    ).get(row.path, row.path + '/%');
    return r?.cnt ?? 0;
  }

  // ─── Query ─────────────────────────────────────────────────────────────────

  _evaluatePredicate(fieldValue: any, op: any, expectedValue: any) {
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
  }: any = {}) {
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
      const walk    = (id: any): void => { if (subtree.has(id)) return; subtree.add(id); for (const c of (byP.get(id) || [])) walk(c); };
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
        for (const [field, predicate] of Object.entries<any>(where)) {
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
      // Per-type tables are derived; drop them all and let the rebuild recreate
      // exactly those with ≥1 live instance (via _insertIndexTx → _projectObjectRow).
      for (const r of db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'obj\\_%' ESCAPE '\\'`,
      ).all())
        db.exec(`DROP TABLE IF EXISTS "${r.name}"`);
      db.prepare('DELETE FROM items_time').run();
      db.prepare('DELETE FROM items_search').run();
      db.prepare('DELETE FROM items_payload').run();
      db.prepare('DELETE FROM items_meta').run();
      db.prepare('DELETE FROM item_tags').run();
      db.prepare('DELETE FROM backlinks').run();
      db.prepare('DELETE FROM history').run();
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

  _branchExists(name: any) {
    return fs.existsSync(path.join(this._branchRoot(name), 'items'));
  }

  // createBranch(name, { fill, upstream })
  //   fill: 'full' (default) → recursive copy of the base branch folder.
  //   fill: 'sparse'         → empty items/ that reads through to an upstream
  //                            branch; only local changes (and tombstones for
  //                            deletes) live in this branch's items/.
  //   upstream: { branch } for a LOCAL full branch (default { branch: base }),
  //             or { remote, branch } for a remote (federated at query time).
  createBranch(name: any, opts: any = {}) {
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
  switchBranch(name: any) {
    name = (name || 'main').trim();
    if (name !== 'main' && !this._branchExists(name)) throw new Error(`Branch "${name}" not found`);
    this._setActiveBranch(name);
  }

  // Select the active branch for THIS instance only. Identical to switchBranch in
  // the per-branch-folder model (there is no shared default to persist), but kept
  // separate so a consumer can express intent. Switching closes the current
  // index.db so the next _openDb() opens the new branch's folder, and clears the
  // memory cache (stale after a branch change).
  useBranch(name: any) {
    name = (name || 'main').trim();
    if (name !== 'main' && !this._branchExists(name)) throw new Error(`Branch "${name}" not found`);
    this._setActiveBranch(name);
  }

  _setActiveBranch(name: any) {
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
    const out: any[] = [];
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

  deleteBranch(name: any) {
    if (!name || name === 'main') throw new Error('Cannot delete the main branch');
    if (this._branch === name) throw new Error(`Cannot delete the currently active branch "${name}" — switch to main first`);
    if (!this._branchExists(name)) throw new Error(`Branch "${name}" not found`);
    const dir = this._branchRoot(name);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  // Returns the full ADD/EDIT/DELETE diff of a branch vs main, computed by
  // scanning both branches' items/ trees (each branch is a full folder).
  branchDiff(name: any) {
    name = (name ?? this._branch).trim();
    if (name === 'main') return { adds: [], edits: [], deletes: [] };
    if (!this._branchExists(name)) return { adds: [], edits: [], deletes: [] };

    const readTree = (branchName: any) => {
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

    const adds: any[] = [], edits: any[] = [], deletes: any[] = [];

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

  // Classify a branch's changes against its CURRENT upstream using the per-item
  // watermark. `branchPoint.at` (else the branch's `createdAt`) is the instant the
  // branch forked; any upstream item whose `modifiedAt` is NEWER than that was
  // changed after the fork. An edit or delete of such an item is a CONFLICT (both
  // sides touched it); everything else is a clean change. Adds are never conflicts
  // — branchDiff only reports an add when the id is absent upstream. This is the
  // per-item EDIT-vs-CONFLICT detection the spec's `branchPoint` exists for
  // (see specification.adoc "Branching"): merge no longer blindly clobbers
  // upstream work. Pure read — applies nothing.
  // Reverse-reference lookup ("who points at this id") in the ACTIVE branch's
  // index. Covers the three ways one item can depend on another: structural
  // children (parentId), [[uuid]] backlinks, and inbound relationship items.
  _referrersTo(id: any) {
    const db = this._openDb();
    const children = db.prepare('SELECT id FROM items WHERE parent_id = ? AND id != parent_id').all(id).map(r => r.id);
    const links    = this.backlinks(id);
    const relationships = (this.relationships(id).inbound || []).map(r => r.sourceId).filter(Boolean);
    const aliases  = this._aliasItemsTargeting(db, id).map((r: any) => r.id).filter(Boolean);
    return { children, links, relationships, aliases };
  }

  // The blast radius of deleting each id in `deleteIds`: which OTHER items in the
  // active branch reference them. Referrers that are themselves part of the same
  // delete set are excluded (they are going away too, so no dangling reference is
  // created). Returns [{ id, referencedBy: [{ id, via }] }] for ids that have live
  // referrers — an empty array means the deletes leave referential integrity intact.
  _computeBlastRadius(deleteIds: any) {
    const delSet = new Set(deleteIds);
    const out: any[] = [];
    for (const id of deleteIds) {
      const r = this._referrersTo(id);
      const referencedBy = [
        ...r.children.map(x => ({ id: x, via: 'parent' })),
        ...r.links.map(x => ({ id: x, via: 'link' })),
        ...r.relationships.map(x => ({ id: x, via: 'relationship' })),
        ...r.aliases.map(x => ({ id: x, via: 'alias' })),
      ].filter(ref => ref.id && !delSet.has(ref.id));
      if (referencedBy.length) out.push({ id, referencedBy });
    }
    return out;
  }

  previewMerge(name: any) {
    name = (name ?? this._branch).trim();
    const diff     = this.branchDiff(name);
    const manifest = this._branchManifest(name) || {};
    const watermark = manifest.branchPoint?.at ?? manifest.createdAt ?? null;

    // ISO-8601 UTC timestamps sort correctly as plain strings.
    const movedSinceFork = (upstreamModifiedAt: any) =>
      !!watermark && !!upstreamModifiedAt && String(upstreamModifiedAt) > String(watermark);

    const conflicts: any[] = [];
    for (const e of diff.edits) {
      if (movedSinceFork(e.before?.modifiedAt))
        conflicts.push({ id: e.id, kind: 'edit-edit', before: e.before, after: e.after });
    }
    for (const d of diff.deletes) {
      if (movedSinceFork(d.before?.modifiedAt))
        conflicts.push({ id: d.id, kind: 'delete-edit', before: d.before });
    }
    // Edit-vs-upstream-delete: an "add" (present locally, absent upstream) whose
    // item was CREATED before the fork can only be an item that existed at the
    // fork and has since been deleted upstream — the branch kept/edited it while
    // upstream removed it. Left unflagged, a blind merge would silently resurrect
    // it. (A genuine branch add is created after the fork, so createdAt >= watermark.)
    for (const add of diff.adds) {
      const created = add.after?.createdAt ?? add.doc?.meta?.createdAt ?? null;
      if (watermark && created && String(created) < String(watermark))
        conflicts.push({ id: add.id, kind: 'add-delete', after: add.after });
    }

    // Blast radius of the branch's deletions. Computed against the ACTIVE branch's
    // index — preview from the merge target (main) for the accurate picture; the
    // merge itself always recomputes on main before applying.
    const blastRadius = this._computeBlastRadius(diff.deletes.map(d => d.id));

    return { ...diff, watermark, conflicts, blastRadius };
  }

  // Merge a local branch into main by applying its full-folder diff to main's
  // items/ and rebuilding main's index. Must be run from a different branch
  // (switch to main first). The branch folder is removed after a successful merge.
  //
  // Conflict handling (via previewMerge's per-item watermark):
  //   * default (no strategy) — if ANY item conflicts (upstream moved after the
  //     fork), the merge ABORTS: nothing is applied and the branch is preserved so
  //     the caller can resolve. Throws an Error with `.code = 'MERGE_CONFLICT'`
  //     and `.conflicts`.
  //   * { strategy: 'theirs' } — the branch wins: force-apply every change,
  //     including conflicting ones (the pre-conflict-detection behaviour).
  //   * { strategy: 'ours' } — upstream wins for conflicting items: apply only the
  //     clean changes, skip the conflicting ones (they are discarded with the
  //     branch folder).
  // A clean merge (no conflicts) applies all changes exactly as before.
  mergeBranchLocally(name: any, opts: any = {}) {
    if (!name || name === 'main') throw new Error('Cannot merge the main branch into itself');
    if (this._branch === name) throw new Error(`Switch to main before merging branch "${name}"`);
    if (!this._branchExists(name)) throw new Error(`Branch "${name}" not found`);

    const strategy = opts.strategy ?? null; // null | 'theirs' | 'ours'
    if (strategy && strategy !== 'theirs' && strategy !== 'ours')
      throw new Error(`Unknown merge strategy "${strategy}" (expected 'theirs' or 'ours')`);

    const preview   = this.previewMerge(name);
    const conflicts = preview.conflicts;

    if (conflicts.length && !strategy) {
      const err: any = new Error(
        `Merge of "${name}" has ${conflicts.length} conflict(s): upstream item(s) changed after the ` +
        `branch point. Re-run with { strategy: 'theirs' } (branch wins) or { strategy: 'ours' } ` +
        `(keep upstream) to resolve.`);
      err.code = 'MERGE_CONFLICT';
      err.conflicts = conflicts;
      throw err;
    }

    const conflictIds = new Set(conflicts.map(c => c.id));
    const skip = (id: any) => strategy === 'ours' && conflictIds.has(id);

    // Blast radius of the deletions that will actually be applied, computed here on
    // main (the target). Surfaced in the result so a caller never silently orphans
    // a child or dangles a [[uuid]]/relationship reference. `blockOnBlastRadius`
    // turns it into a hard gate: abort before applying anything, branch preserved.
    const appliedDeleteIds = preview.deletes.filter(d => !skip(d.id)).map(d => d.id);
    const blastRadius = this._computeBlastRadius(appliedDeleteIds);
    if (opts.blockOnBlastRadius && blastRadius.length) {
      const err: any = new Error(
        `Merge of "${name}" would break ${blastRadius.length} reference target(s): deleted item(s) are ` +
        `still referenced on main. Re-run without { blockOnBlastRadius } to merge anyway, or resolve the ` +
        `references first.`);
      err.code = 'MERGE_BLAST_RADIUS';
      err.blastRadius = blastRadius;
      throw err;
    }

    const mainItemsDir = path.join(this._branchRoot('main'), 'items');

    // Apply onto main's items/ tree (note: _itemPath/_itemDir target the ACTIVE
    // branch, which must be main here — enforced by the guard above + the usual
    // "switch to main first" workflow).
    const writeMainDoc = (id: any, doc: any) => {
      const [s1, s2] = this._shard(id);
      const dir = path.join(mainItemsDir, s1, s2, id);
      fs.mkdirSync(dir, { recursive: true });
      const p   = path.join(dir, 'item.json');
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
      fs.renameSync(tmp, p);
    };
    const deleteMainDoc = (id: any) => {
      const [s1, s2] = this._shard(id);
      const dir = path.join(mainItemsDir, s1, s2, id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    };

    // Metadata items (alias/relationship/annotation) referencing a deleted item
    // would be left dangling on main's tree; obj_<alias>/obj_<relationship> carry
    // FKs to items(id), so a dangling edge breaks the post-merge rebuild. Cascade
    // their item.json removal here — mirroring the normal delete cascade and the
    // Postgres adapter (deleting an item removes its aliases). The blast radius was
    // already surfaced above for the caller; this only reconciles the tree.
    const mainDb = this._openDb();
    let merged = 0, skipped = 0;
    for (const a of preview.adds)    { if (skip(a.id)) { skipped++; continue; } writeMainDoc(a.id, a.doc); merged++; }
    for (const e of preview.edits)   { if (skip(e.id)) { skipped++; continue; } writeMainDoc(e.id, e.doc); merged++; }
    for (const d of preview.deletes) {
      if (skip(d.id)) { skipped++; continue; }
      for (const op of this._cascadeMetadataOps(mainDb, d.id)) deleteMainDoc(op.id);
      deleteMainDoc(d.id);
      merged++;
    }

    // index.db is fully derived — rebuild main's index from its files.
    this.rebuildIndexes();

    // Remove the merged branch folder.
    const dir = this._branchRoot(name);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

    return { merged, skipped, conflicts, blastRadius };
  }

  // ─── Integrity checks ─────────────────────────────────────────────────────

  checkIntegrity({ checks }: any = {}) {
    const wanted   = Array.isArray(checks) && checks.length ? new Set(checks) : null;
    const run      = (name: any) => !wanted || wanted.has(name);
    const findings: any[] = [];
    if (run('orphan-type-id')) {
      const cache    = new Map();
      const typeName = (tid: any) => {
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

export {
  SqliteFsAdapter, UnknownTypeError,
  ROOT_ID, TYPES_NODE, WELL_KNOWN_TYPES,
  VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE, DEFAULT_LICENSE,
};
