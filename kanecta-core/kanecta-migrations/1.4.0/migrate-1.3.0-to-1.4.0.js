#!/usr/bin/env node
'use strict';

/**
 * Kanecta datastore migration: v1.3.0 → v1.4.0
 *
 * Reads a 1.3.0 filesystem datastore (.kanecta/data/, .kanecta/types/,
 * .kanecta/relationships/, .kanecta/config/) and writes a 1.4.0 SQLite
 * datastore (.kanecta/kanecta.db).
 *
 * Usage:
 *   node migrate-1.3.0-to-1.4.0.js <datastore-path> [--dry-run] [--force]
 *
 * --dry-run  Report what would change without writing kanecta.db.
 * --force    Re-run even if kanecta.db already exists (overwrites it).
 *
 * Safe to re-run with --force — the old kanecta.db is replaced atomically.
 * The original .kanecta/ JSON files are NOT deleted — the old adapter cannot
 * open a SQLite-based 1.4.0 datastore, but they serve as a backup until you
 * have verified the migration. Delete them manually once satisfied.
 */

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

// better-sqlite3 is a dependency of kanecta-sqlite-fs; require it from there.
const Database = require(
  path.resolve(__dirname, '../../kanecta-storage-adapters/kanecta-sqlite-fs/node_modules/better-sqlite3'),
);

// ─── CLI ─────────────────────────────────────────────────────────────────────

const [,, datastorePath, ...flags] = process.argv;
const DRY_RUN = flags.includes('--dry-run');
const FORCE   = flags.includes('--force');

if (!datastorePath) {
  console.error('Usage: node migrate-1.3.0-to-1.4.0.js <datastore-path> [--dry-run] [--force]');
  process.exit(1);
}

const kanectaDir = path.join(datastorePath, '.kanecta');
if (!fs.existsSync(kanectaDir)) {
  console.error(`No .kanecta directory found at: ${datastorePath}`);
  process.exit(1);
}

const dbPath    = path.join(kanectaDir, 'kanecta.db');
const dbPathTmp = dbPath + '.migration-tmp';

if (fs.existsSync(dbPath) && !FORCE) {
  console.log('Already migrated — kanecta.db exists. Run with --force to overwrite.');
  process.exit(0);
}

// ─── Schema ──────────────────────────────────────────────────────────────────
// Mirrors the SCHEMA_SQL in kanecta-sqlite-fs/src/adapter.js.
// Keep in sync if that schema changes.

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = OFF;
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
  connector_id       TEXT,
  materialized       INTEGER,
  cached_at          TEXT,
  source_system      TEXT,
  source_external_id TEXT,
  schedule_data      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_source ON items (source_system, source_external_id)
  WHERE source_system IS NOT NULL AND source_external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_parent  ON items(parent_id);
CREATE INDEX IF NOT EXISTS idx_items_path    ON items(path);
CREATE INDEX IF NOT EXISTS idx_items_type    ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_type_id ON items(type_id);
CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_items_expires ON items(expires_at);
CREATE INDEX IF NOT EXISTS idx_items_aspect  ON items(parent_id, aspect);

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_LICENSE = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739';
const LINK_RE         = /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi;

const counts = { items: 0, types: 0, relationships: 0, annotations: 0, aliases: 0, skipped: 0, errors: [] };

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function log(msg)    { console.log(msg); }
function warn(msg)   { console.warn(`  WARN: ${msg}`); counts.errors.push(msg); }

/** Walk all item directories in a sharded layout: ab/cd/<uuid>/ */
function* walkSharded(dir) {
  if (!fs.existsSync(dir)) return;
  for (const s1 of fs.readdirSync(dir).sort()) {
    const d1 = path.join(dir, s1);
    if (!fs.statSync(d1).isDirectory()) continue;
    for (const s2 of fs.readdirSync(d1).sort()) {
      const d2 = path.join(d1, s2);
      if (!fs.statSync(d2).isDirectory()) continue;
      for (const uuid of fs.readdirSync(d2).sort()) {
        const d3 = path.join(d2, uuid);
        if (fs.statSync(d3).isDirectory()) yield d3;
      }
    }
  }
}

function extractBacklinks(value) {
  if (!value) return [];
  const ids = [];
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(value)) !== null) ids.push(m[1]);
  return [...new Set(ids)];
}

// ─── Step 1: Read config ─────────────────────────────────────────────────────

function readConfig() {
  const configPath = path.join(kanectaDir, 'config', 'config.json');
  const config = readJson(configPath);
  if (!config) {
    console.error('No .kanecta/config/config.json found — is this a Kanecta 1.3.0 datastore?');
    process.exit(1);
  }
  if (config.specVersion && config.specVersion !== '1.3.0') {
    console.warn(`config.json specVersion is "${config.specVersion}" (expected "1.3.0") — proceeding anyway.`);
  }
  return config;
}

// ─── Step 2: Build the SQLite database ───────────────────────────────────────

function openDb() {
  if (DRY_RUN) return null;
  if (fs.existsSync(dbPathTmp)) fs.unlinkSync(dbPathTmp);
  const db = new Database(dbPathTmp);
  db.exec(SCHEMA_SQL);
  return db;
}

function saveDb(db) {
  if (DRY_RUN) return;
  db.close();
  // Atomic rename so we never leave a partially-written kanecta.db.
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  fs.renameSync(dbPathTmp, dbPath);
}

function insertItem(db, row) {
  if (DRY_RUN) return;
  db.prepare(`
    INSERT OR REPLACE INTO items (
      id, spec_version, parent_id, path, value, type, type_id, owner, license,
      visibility, aspect, sort_order, confidence, status, tags,
      object_data, function_data, time_data,
      created_at, modified_at, created_by, modified_by,
      completed_at, due_at, expires_at, deleted_at,
      connector_id, materialized, cached_at,
      source_system, source_external_id, schedule_data
    ) VALUES (
      @id, @spec_version, @parent_id, @path, @value, @type, @type_id, @owner, @license,
      @visibility, @aspect, @sort_order, @confidence, @status, @tags,
      @object_data, @function_data, @time_data,
      @created_at, @modified_at, @created_by, @modified_by,
      @completed_at, @due_at, @expires_at, @deleted_at,
      @connector_id, @materialized, @cached_at,
      @source_system, @source_external_id, @schedule_data
    )
  `).run(row);
}

function insertTags(db, itemId, tags) {
  if (DRY_RUN || !tags?.length) return;
  const stmt = db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)');
  for (const tag of tags) stmt.run(itemId, tag);
}

function insertBacklinks(db, sourceId, targetIds) {
  if (DRY_RUN || !targetIds?.length) return;
  const stmt = db.prepare('INSERT OR IGNORE INTO backlinks (source_id, target_id) VALUES (?, ?)');
  for (const tid of targetIds) stmt.run(sourceId, tid);
}

// ─── Step 3: Import data/ items ──────────────────────────────────────────────
// 1.3.0 items live in .kanecta/data/<s1>/<s2>/<uuid>/metadata.json
// with optional object.json (for type:object) and function.json (for type:function).
// Removed in 1.4.0: subscribedAt, subscriptionSource, template.
// Added in 1.4.0: expiresAt, deletedAt, layer (→ null default = 'user').
// Grant items: parentId held the governed item UUID; in 1.4.0 parentId should
// point to the grant type item. We record the old parentId as payload.governedItemId
// and set parentId to the grant-types-node UUID (which we store as null here —
// a reconcile step can fix it once the type hierarchy is known).

function importDataItems(db) {
  log('\n── Step 1: Import data/ items ───────────────────────────');
  const dataDir = path.join(kanectaDir, 'data');

  for (const itemDir of walkSharded(dataDir)) {
    const meta = readJson(path.join(itemDir, 'metadata.json'));
    if (!meta) {
      warn(`No metadata.json in ${itemDir}`);
      continue;
    }

    if (!meta.id || !meta.type) {
      warn(`Invalid metadata.json in ${itemDir} (missing id or type)`);
      continue;
    }

    // Object payload (object.json)
    let objectData = null;
    if (meta.type === 'object') {
      objectData = readJson(path.join(itemDir, 'object.json'));
    }

    // Function payload (function.json)
    let functionData = null;
    if (meta.type === 'function') {
      const fnJson = readJson(path.join(itemDir, 'function.json'));
      if (fnJson) {
        // In 1.4.0 the function body lives inline in function_data.
        // 1.3.0 stored it in function.json under 'body'.
        functionData = fnJson;
      }
    }

    // Grant parentId audit: in 1.3.0 grants used parentId for the governed item.
    // In 1.4.0 grants carry payload.governedItemId and parentId → type bucket.
    // We preserve the old parentId as governedItemId if not already set.
    let resolvedParentId = meta.parentId ?? null;
    let resolvedObjectData = objectData;
    if (meta.type === 'grant' && meta.parentId) {
      const existingGoverned = objectData?.governedItemId;
      if (!existingGoverned) {
        resolvedObjectData = { ...(objectData ?? {}), governedItemId: meta.parentId };
        // parentId stays as-is for now — no well-known grant type UUID known here.
        // A manual reconcile step can update it once the type bucket UUID is known.
      }
    }

    // layer: not in 1.3.0. Default null (treated as 'user' by the adapter).
    // Items from data/ are user items.

    // visibility: default 'private' if not set
    const visibility = meta.visibility ?? 'private';

    // tags: array or null → always array
    const tags = Array.isArray(meta.tags) ? meta.tags : [];

    const now = new Date().toISOString();

    const row = {
      id:           meta.id,
      spec_version: '1.4.0',
      parent_id:    resolvedParentId,
      path:         null,       // computed by adapter on first open
      value:        meta.value ?? null,
      type:         meta.type,
      type_id:      meta.typeId ?? null,
      owner:        meta.owner ?? null,
      license:      meta.license ?? DEFAULT_LICENSE,
      visibility,
      aspect:       meta.aspect ?? null,
      sort_order:   meta.sortOrder ?? 0,
      confidence:   meta.confidence ?? null,
      status:       meta.status ?? null,
      tags:         JSON.stringify(tags),
      object_data:  resolvedObjectData ? JSON.stringify(resolvedObjectData) : null,
      function_data: functionData ? JSON.stringify(functionData) : null,
      time_data:    null,
      created_at:   meta.createdAt ?? now,
      modified_at:  meta.modifiedAt ?? now,
      created_by:   meta.createdBy ?? meta.owner ?? null,
      modified_by:  meta.modifiedBy ?? meta.owner ?? null,
      completed_at: meta.completedAt ?? null,
      due_at:       meta.dueAt ?? null,
      expires_at:   null,   // not in 1.3.0
      deleted_at:   null,   // not in 1.3.0
      connector_id:       null,
      materialized:       null,
      cached_at:          meta.cachedAt ?? null,
      source_system:      null,
      source_external_id: null,
      schedule_data:      null,
    };

    insertItem(db, row);
    insertTags(db, meta.id, tags);
    insertBacklinks(db, meta.id, extractBacklinks(meta.value));
    counts.items++;
  }

  log(`  Done: ${counts.items} items imported`);
}

// ─── Step 4: Import type definitions from types/ ─────────────────────────────
// 1.3.0 type defs live in .kanecta/types/<s1>/<s2>/<uuid>/metadata.json + type.json.
// In 1.4.0 they become items of type 'object' (or a type-def type) stored in
// items + type_defs. We write them to both: items (for tree/query) + type_defs
// (for the adapter's type lookup).
// layer → 'core' for system type definitions.

function importTypeItems(db) {
  log('\n── Step 2: Import type definitions ─────────────────────');
  const typesDir = path.join(kanectaDir, 'types');

  for (const typeDir of walkSharded(typesDir)) {
    const meta    = readJson(path.join(typeDir, 'metadata.json'));
    const typeDef = readJson(path.join(typeDir, 'type.json'));

    if (!meta) {
      warn(`No metadata.json in ${typeDir}`);
      continue;
    }

    const tags       = Array.isArray(meta.tags) ? meta.tags : [];
    const visibility = meta.visibility ?? 'private';
    const now        = new Date().toISOString();
    const schemaJson = typeDef ? JSON.stringify(typeDef) : '{}';

    const row = {
      id:           meta.id,
      spec_version: '1.4.0',
      parent_id:    meta.parentId ?? null,
      path:         null,
      value:        meta.value ?? null,
      type:         meta.type ?? 'object',
      type_id:      meta.typeId ?? null,
      owner:        meta.owner ?? null,
      license:      meta.license ?? DEFAULT_LICENSE,
      visibility,
      aspect:       meta.aspect ?? null,
      sort_order:   meta.sortOrder ?? 0,
      confidence:   meta.confidence ?? null,
      status:       meta.status ?? null,
      tags:         JSON.stringify(tags),
      object_data:  typeDef ? schemaJson : null,
      function_data: null,
      time_data:    null,
      created_at:   meta.createdAt ?? now,
      modified_at:  meta.modifiedAt ?? now,
      created_by:   meta.createdBy ?? meta.owner ?? null,
      modified_by:  meta.modifiedBy ?? meta.owner ?? null,
      completed_at: null,
      due_at:       null,
      expires_at:   null,
      deleted_at:   null,
      connector_id:       null,
      materialized:       null,
      cached_at:          null,
      source_system:      null,
      source_external_id: null,
      schedule_data:      null,
    };

    insertItem(db, row);
    insertTags(db, meta.id, tags);

    // Also write to type_defs for the adapter's type lookup
    if (!DRY_RUN && meta.id && meta.value) {
      db.prepare(`
        INSERT OR REPLACE INTO type_defs (id, value, schema_json, metadata_json)
        VALUES (?, ?, ?, ?)
      `).run(meta.id, meta.value, schemaJson, JSON.stringify(meta));
    }

    counts.types++;
  }

  log(`  Done: ${counts.types} type definitions imported`);
}

// ─── Step 5: Convert relationships → relationship items ───────────────────────
// 1.3.0 relationships.json outbound entries become items of type 'relationship'.
// The relationship type is preserved as a string slug in payload.
// Relationship types → UUID is aspirational (requires a separate relationship-type
// item registry). For now: store the slug in object_data and validate against
// VALID_REL_TYPES. Custom types (outside the built-in set) are recorded in
// the reshape queue for manual review.
//
// The 1.3.0 relationships/ directory also contains inbound indexes — we skip
// those (they are derived data, not source of truth).

const BUILT_IN_REL_TYPES = new Set([
  'relates-to', 'depends-on', 'enables', 'contradicts',
  'blocks', 'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes',
]);

const customRelTypes = new Set();
const reshapeQueue   = [];

function importRelationships(db) {
  log('\n── Step 3: Convert relationships → items ─────────────────');
  const relsDir = path.join(kanectaDir, 'relationships');
  if (!fs.existsSync(relsDir)) {
    log('  No relationships/ directory — skipping');
    return;
  }

  for (const relDir of walkSharded(relsDir)) {
    const relsPath = path.join(relDir, 'relationships.json');
    if (!fs.existsSync(relsPath)) continue;

    const relsData = readJson(relsPath);
    if (!relsData?.outbound?.length) continue;

    const sourceId = path.basename(relDir);

    for (const entry of relsData.outbound) {
      if (!entry.targetId || !entry.type) continue;

      if (!BUILT_IN_REL_TYPES.has(entry.type)) {
        customRelTypes.add(entry.type);
        reshapeQueue.push({
          reason: 'custom-relationship-type',
          sourceId,
          targetId: entry.targetId,
          relType: entry.type,
          note: 'Not a built-in relationship type — verify correct slug or register as a custom type',
        });
      }

      const id  = crypto.randomUUID();
      const now = new Date().toISOString();

      const row = {
        id,
        spec_version: '1.4.0',
        parent_id:    sourceId,
        path:         null,
        value:        entry.note ?? null,
        type:         'relationship',
        type_id:      null,
        owner:        entry.createdBy ?? null,
        license:      DEFAULT_LICENSE,
        visibility:   'private',
        aspect:       'relationships',
        sort_order:   0,
        confidence:   null,
        status:       null,
        tags:         '[]',
        // payload stored as object_data (relationship items have structured payload)
        object_data:  JSON.stringify({
          sourceId,
          targetId:        entry.targetId,
          relationshipType: entry.type,
          direction:       'directed',
          note:            entry.note ?? null,
        }),
        function_data: null,
        time_data:    null,
        created_at:   entry.createdAt ?? now,
        modified_at:  entry.createdAt ?? now,
        created_by:   entry.createdBy ?? null,
        modified_by:  entry.createdBy ?? null,
        completed_at: null,
        due_at:       null,
        expires_at:   null,
        deleted_at:   null,
        connector_id:       null,
        materialized:       null,
        cached_at:          null,
        source_system:      null,
        source_external_id: null,
        schedule_data:      null,
      };

      insertItem(db, row);
      counts.relationships++;
    }
  }

  log(`  Done: ${counts.relationships} relationship items created`);
  if (customRelTypes.size > 0) {
    log(`  Custom relationship types (added to reshape queue): ${[...customRelTypes].join(', ')}`);
  }
}

// ─── Step 6: Compute materialized paths ──────────────────────────────────────
// The 1.4.0 SQLite adapter uses a materialized path column (path) for O(1)
// subtree reads. We compute these after all items are inserted.
// Walk from root outward using a recursive pass over the in-memory items.

function computePaths(db) {
  if (DRY_RUN) return;
  log('\n── Step 4: Compute materialized paths ───────────────────');

  const ROOT_ID = '00000000-0000-0000-0000-000000000000';

  // Build parent→children map
  const rows    = db.prepare('SELECT id, parent_id FROM items').all();
  const children = new Map();
  for (const r of rows) {
    const pid = r.parent_id;
    if (!children.has(pid)) children.set(pid, []);
    children.get(pid).push(r.id);
  }

  const updateStmt = db.prepare('UPDATE items SET path = ? WHERE id = ?');
  let count = 0;

  function walk(id, parentPath) {
    const p = parentPath ? `${parentPath}/${id}` : id;
    updateStmt.run(p, id);
    count++;
    for (const childId of (children.get(id) ?? [])) {
      if (childId !== id) walk(childId, p);  // skip self-referential root
    }
  }

  db.transaction(() => walk(ROOT_ID, null))();
  log(`  Done: paths computed for ${count} items`);
}

// ─── Step 7: Write settings and update config.json ───────────────────────────

function writeSettings(db, config) {
  if (DRY_RUN) return;
  const appConfig = {
    owner:       config.owner ?? 'unknown',
    specVersion: '1.4.0',
  };
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(appConfig));
}

function updateConfigJson(config) {
  const configPath = path.join(kanectaDir, 'config', 'config.json');
  const updated    = { ...config, specVersion: '1.4.0' };
  if (!DRY_RUN) {
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  }
  log(`\n── Step 5: Config updated ───────────────────────────────`);
  log(`  specVersion → 1.4.0`);
}

// ─── Step 8: Write reshape queue ─────────────────────────────────────────────

function writeReshapeQueue() {
  if (reshapeQueue.length === 0) return;
  const queuePath = path.join(datastorePath, 'reshape-queue.json');
  if (!DRY_RUN) {
    fs.writeFileSync(queuePath, JSON.stringify(reshapeQueue, null, 2) + '\n', 'utf8');
  }
  log(`\n  reshape-queue.json: ${reshapeQueue.length} item(s) need attention`);
  log(`  See README.md for how to handle these.`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

log(`Kanecta migration: 1.3.0 → 1.4.0`);
log(`Datastore: ${datastorePath}`);
if (DRY_RUN) log('DRY RUN — no files will be written\n');

const config = readConfig();
log(`Owner: ${config.owner ?? '(not set)'}`);
log(`Current specVersion: ${config.specVersion ?? '(not set)'}`);

const db = openDb();

if (db) {
  db.transaction(() => {
    importDataItems(db);
    importTypeItems(db);
    importRelationships(db);
  })();
  computePaths(db);
  writeSettings(db, config);
} else {
  // Dry run — still walk the filesystem to produce accurate counts
  importDataItems(null);
  importTypeItems(null);
  importRelationships(null);
}

updateConfigJson(config);
writeReshapeQueue();

if (db) saveDb(db);

log('\n── Summary ──────────────────────────────────────────────');
log(`  Data items imported:      ${counts.items}`);
log(`  Type definitions:         ${counts.types}`);
log(`  Relationship items:       ${counts.relationships}`);

if (counts.errors.length > 0) {
  log(`\n  Warnings (${counts.errors.length}):`);
  for (const e of counts.errors) log(`    • ${e}`);
}

if (DRY_RUN) {
  log('\nDry run complete — no files were written.');
} else {
  log(`\nMigration complete. kanecta.db written to ${dbPath}`);
  log('The original JSON files remain as backup. Delete .kanecta/data/, .kanecta/types/,');
  log('and .kanecta/relationships/ once you have verified the migrated datastore.');
}
