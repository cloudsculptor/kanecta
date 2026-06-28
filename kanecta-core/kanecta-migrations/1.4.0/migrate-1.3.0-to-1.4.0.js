#!/usr/bin/env node
'use strict';

/**
 * Kanecta datastore migration: v1.3.0 → v1.4.0
 *
 * Reads a 1.3.0 filesystem datastore (.kanecta/data/, .kanecta/types/,
 * .kanecta/relationships/, .kanecta/config/) and writes a 1.4.0 filesystem
 * datastore (.kanecta/items/<s1>/<s2>/<uuid>/item.json).
 *
 * The filesystem is the source of truth. After migration, open the datastore
 * with the 1.4.0 adapter — it will build index.db automatically from the
 * item.json files on first open.
 *
 * Usage:
 *   node migrate-1.3.0-to-1.4.0.js <datastore-path> [--dry-run] [--force]
 *
 * --dry-run  Report what would change without writing any files.
 * --force    Re-run even if items/ already exists (overwrites existing item.json files).
 *
 * Safe to re-run with --force — each item.json is written atomically.
 * The original .kanecta/ JSON files are NOT deleted — they remain as backup
 * until you have verified the migration. Delete data/, types/, relationships/,
 * and config/ manually once satisfied.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

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

const itemsDir = path.join(kanectaDir, 'items');

if (fs.existsSync(itemsDir) && !FORCE) {
  console.log('Already migrated — items/ directory exists. Run with --force to overwrite.');
  process.exit(0);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SPEC_VERSION  = '1.4.0';
const DEFAULT_LICENSE = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739';
const ROOT_ID         = '00000000-0000-0000-0000-000000000000';
const LINK_RE         = /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi;

const BUILT_IN_REL_TYPES = new Set([
  'relates-to', 'depends-on', 'enables', 'contradicts',
  'blocks', 'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes',
]);

const counts = { items: 0, types: 0, relationships: 0, skipped: 0, errors: [] };
const reshapeQueue = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function log(msg)  { console.log(msg); }
function warn(msg) { console.warn(`  WARN: ${msg}`); counts.errors.push(msg); }

/** Compute the 2+2 shard pair for a UUID. */
function shard(id) {
  const hex = id.replace(/-/g, '');
  return [hex.slice(0, 2), hex.slice(2, 4)];
}

/** Return the directory for a given item id under the items/ tree. */
function itemDir(id) {
  const [s1, s2] = shard(id);
  return path.join(itemsDir, s1, s2, id);
}

/**
 * Write a five-section item.json atomically (temp + rename).
 * doc must be { item, meta, search, payload, time }.
 */
function writeItemJson(id, doc) {
  if (DRY_RUN) return;
  const dir = itemDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const p   = path.join(dir, 'item.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

/** Walk all item directories in a sharded layout: <s1>/<s2>/<uuid>/ */
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

// ─── Five-section item.json builder ──────────────────────────────────────────

/**
 * Build a five-section item.json document from migration fields.
 *
 * item    — the canonical tree fields (id, parentId, type, value, sortOrder, aspect)
 * meta    — provenance, lifecycle, and indexing fields
 * search  — placeholder (no embeddings at migration time)
 * payload — arbitrary structured data (object.json, function.json, or relationship payload)
 * time    — null (temporal contexts not used in 1.3.0)
 */
function buildDoc(fields) {
  const {
    id, parentId, type, typeId, value, sortOrder, aspect,
    owner, license, visibility, tags,
    createdAt, modifiedAt, deletedAt, expiresAt,
    connectorId, materialized,
    sourceSystem, sourceExternalId,
    payload,
  } = fields;

  return {
    item: {
      id,
      parentId:  parentId  ?? null,
      type:      type       ?? 'text',
      typeId:    typeId     ?? null,
      value:     value      ?? null,
      sortOrder: sortOrder  ?? 0,
      aspect:    aspect     ?? null,
    },
    meta: {
      specVersion:      SPEC_VERSION,
      owner:            owner            ?? null,
      license:          license          ?? DEFAULT_LICENSE,
      visibility:       visibility       ?? 'private',
      tags:             tags             ?? [],
      createdAt:        createdAt        ?? new Date().toISOString(),
      modifiedAt:       modifiedAt       ?? new Date().toISOString(),
      deletedAt:        deletedAt        ?? null,
      expiresAt:        expiresAt        ?? null,
      connectorId:      connectorId      ?? null,
      materialized:     materialized     ?? null,
      files:            [],
      layer:            null,
      sourceSystem:     sourceSystem     ?? null,
      sourceExternalId: sourceExternalId ?? null,
    },
    search:  { corpusHash: null, embedding: null },
    payload: payload ?? null,
    time:    null,
  };
}

// ─── Step 1: Read config ──────────────────────────────────────────────────────

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

// ─── Step 2: Write root item (ROOT_ID) with config as payload ────────────────

function writeRootItem(config) {
  log('\n── Step 1: Write root item ───────────────────────────────');
  const now = new Date().toISOString();

  const rootPayload = {
    owner:            config.owner ?? 'unknown',
    specVersion:      SPEC_VERSION,
    itemHistory:      config.itemHistory      ?? 'NONE',
    activity:         config.activity         ?? 'NONE',
    defaultVisibility: config.defaultVisibility ?? 'private',
    defaultLicense:   config.defaultLicense   ?? DEFAULT_LICENSE,
    connectors:       config.connectors       ?? [],
  };

  const doc = buildDoc({
    id:        ROOT_ID,
    parentId:  null,
    type:      'root',
    value:     config.name ?? 'kanecta',
    owner:     config.owner ?? null,
    createdAt: config.createdAt ?? now,
    modifiedAt: now,
    payload:   rootPayload,
  });

  writeItemJson(ROOT_ID, doc);
  log(`  Root item written (${ROOT_ID})`);
}

// ─── Step 3: Import data/ items ───────────────────────────────────────────────
// 1.3.0 items live in .kanecta/data/<s1>/<s2>/<uuid>/metadata.json
// with optional object.json (type:object) and function.json (type:function).
//
// Fields removed in 1.4.0: subscribedAt, subscriptionSource, template.
// Fields added in 1.4.0: expiresAt, deletedAt, layer, files.
//
// Grant items: in 1.3.0 the parentId was the governed item UUID; in 1.4.0
// grants live as aspect children of the source item, with a payload containing
// governedItemId and grantType. We preserve the old parentId in
// payload.governedItemId and leave parentId unchanged — a manual reconcile
// step can move grants into the correct tree position.

function importDataItems() {
  log('\n── Step 2: Import data/ items ────────────────────────────');
  const dataDir = path.join(kanectaDir, 'data');

  for (const dir of walkSharded(dataDir)) {
    const meta = readJson(path.join(dir, 'metadata.json'));
    if (!meta) { warn(`No metadata.json in ${dir}`); continue; }
    if (!meta.id || !meta.type) { warn(`Missing id or type in ${dir}`); continue; }

    let payload = null;

    if (meta.type === 'object') {
      payload = readJson(path.join(dir, 'object.json'));
    } else if (meta.type === 'function') {
      payload = readJson(path.join(dir, 'function.json'));
    }

    // Grant: preserve governed item reference in payload
    if (meta.type === 'grant' && meta.parentId && !payload?.governedItemId) {
      payload = { ...(payload ?? {}), governedItemId: meta.parentId };
    }

    const doc = buildDoc({
      id:         meta.id,
      parentId:   meta.parentId   ?? null,
      type:       meta.type,
      typeId:     meta.typeId     ?? null,
      value:      meta.value      ?? null,
      sortOrder:  meta.sortOrder  ?? 0,
      aspect:     meta.aspect     ?? null,
      owner:      meta.owner      ?? null,
      license:    meta.license    ?? DEFAULT_LICENSE,
      visibility: meta.visibility ?? 'private',
      tags:       Array.isArray(meta.tags) ? meta.tags : [],
      createdAt:  meta.createdAt  ?? null,
      modifiedAt: meta.modifiedAt ?? null,
      payload,
    });

    writeItemJson(meta.id, doc);
    counts.items++;
  }

  log(`  Done: ${counts.items} data items`);
}

// ─── Step 4: Import type definitions from types/ ──────────────────────────────
// 1.3.0 type defs live in .kanecta/types/<s1>/<s2>/<uuid>/metadata.json + type.json.
// In 1.4.0 they become items of type 'object' with the type schema in payload.
// layer → 'core' for system-registered type definitions.

function importTypeItems() {
  log('\n── Step 3: Import type definitions ──────────────────────');
  const typesDir = path.join(kanectaDir, 'types');

  for (const dir of walkSharded(typesDir)) {
    const meta    = readJson(path.join(dir, 'metadata.json'));
    const typeDef = readJson(path.join(dir, 'type.json'));
    if (!meta) { warn(`No metadata.json in ${dir}`); continue; }

    const doc = buildDoc({
      id:         meta.id,
      parentId:   meta.parentId   ?? null,
      type:       meta.type       ?? 'object',
      typeId:     meta.typeId     ?? null,
      value:      meta.value      ?? null,
      sortOrder:  meta.sortOrder  ?? 0,
      aspect:     meta.aspect     ?? null,
      owner:      meta.owner      ?? null,
      license:    meta.license    ?? DEFAULT_LICENSE,
      visibility: meta.visibility ?? 'private',
      tags:       Array.isArray(meta.tags) ? meta.tags : [],
      createdAt:  meta.createdAt  ?? null,
      modifiedAt: meta.modifiedAt ?? null,
      payload:    typeDef ?? null,
    });

    writeItemJson(meta.id, doc);
    counts.types++;
  }

  log(`  Done: ${counts.types} type definitions`);
}

// ─── Step 5: Convert relationships → relationship items ────────────────────────
// 1.3.0 outbound relationship entries become items of type 'relationship'.
// Each relationship item is a child (aspect) of its source item.
// The relationship type slug is preserved in payload.relationshipType.
// Custom types (not in BUILT_IN_REL_TYPES) are flagged in the reshape queue.

function importRelationships() {
  log('\n── Step 4: Convert relationships → items ─────────────────');
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
        reshapeQueue.push({
          reason: 'custom-relationship-type',
          sourceId,
          targetId: entry.targetId,
          relType: entry.type,
          note: 'Not a built-in relationship type — verify or register as custom type',
        });
      }

      const id  = crypto.randomUUID();
      const now = new Date().toISOString();

      const doc = buildDoc({
        id,
        parentId:   sourceId,
        type:       'relationship',
        value:      entry.note ?? null,
        sortOrder:  0,
        aspect:     'relationships',
        owner:      entry.createdBy ?? null,
        license:    DEFAULT_LICENSE,
        visibility: 'private',
        tags:       [],
        createdAt:  entry.createdAt ?? now,
        modifiedAt: entry.createdAt ?? now,
        payload: {
          sourceId,
          targetId:         entry.targetId,
          relationshipType: entry.type,
          direction:        'directed',
          note:             entry.note ?? null,
        },
      });

      writeItemJson(id, doc);
      counts.relationships++;
    }
  }

  log(`  Done: ${counts.relationships} relationship items`);
}

// ─── Step 6: Write .gitignore (ignore index.db — it is derived, not source) ──

function writeGitignore() {
  if (DRY_RUN) return;
  const giPath = path.join(kanectaDir, '.gitignore');
  const line   = 'index.db\n';
  // Append only if not already present
  const existing = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
  if (!existing.includes('index.db')) {
    fs.appendFileSync(giPath, line, 'utf8');
  }
  log('\n── Step 5: .gitignore updated (index.db ignored) ────────');
}

// ─── Step 7: Write reshape queue ─────────────────────────────────────────────

function writeReshapeQueue() {
  if (reshapeQueue.length === 0) return;
  const queuePath = path.join(datastorePath, 'reshape-queue.json');
  if (!DRY_RUN) {
    fs.writeFileSync(queuePath, JSON.stringify(reshapeQueue, null, 2) + '\n', 'utf8');
  }
  log(`\n  reshape-queue.json: ${reshapeQueue.length} item(s) need attention`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

log(`Kanecta migration: 1.3.0 → 1.4.0`);
log(`Datastore: ${datastorePath}`);
if (DRY_RUN) log('DRY RUN — no files will be written\n');

const config = readConfig();
log(`Owner: ${config.owner ?? '(not set)'}`);
log(`Current specVersion: ${config.specVersion ?? '(not set)'}`);

if (!DRY_RUN) {
  fs.mkdirSync(itemsDir, { recursive: true });
}

writeRootItem(config);
importDataItems();
importTypeItems();
importRelationships();
writeGitignore();
writeReshapeQueue();

log('\n── Summary ──────────────────────────────────────────────');
log(`  Root item:                1`);
log(`  Data items:               ${counts.items}`);
log(`  Type definitions:         ${counts.types}`);
log(`  Relationship items:       ${counts.relationships}`);

if (counts.errors.length > 0) {
  log(`\n  Warnings (${counts.errors.length}):`);
  for (const e of counts.errors) log(`    • ${e}`);
}

if (DRY_RUN) {
  log('\nDry run complete — no files were written.');
} else {
  log(`\nMigration complete. item.json files written to ${itemsDir}`);
  log('Open the datastore with the 1.4.0 adapter — it will build index.db');
  log('automatically from the item.json files on first open.');
  log('The original data/, types/, relationships/, config/ remain as backup.');
  log('Delete them manually once you have verified the migrated datastore.');
}
