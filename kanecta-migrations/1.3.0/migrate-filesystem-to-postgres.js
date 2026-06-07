#!/usr/bin/env node
/**
 * Migrate a Kanecta filesystem datastore into Postgres.
 *
 * Usage:
 *   node migrate-filesystem-to-postgres.js <datastore-path> [postgres-url]
 *
 * Defaults:
 *   datastore-path  /home/richard/wiki/ricthomas/datastore
 *   postgres-url    postgres://kanecta:kanecta@localhost:45432/kanecta
 *
 * Safe to re-run — all inserts use ON CONFLICT DO NOTHING.
 * Object-type tables are created with CREATE TABLE IF NOT EXISTS before insertion.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATASTORE  = process.argv[2] ?? '/home/richard/wiki/ricthomas/datastore';
const PG_URL     = process.argv[3] ?? 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const KANECTA    = path.join(DATASTORE, '.kanecta');
const DATA_DIR   = path.join(KANECTA, 'data');
const TYPES_DIR  = path.join(KANECTA, 'types');

// Path to system-type definitions (for sqlSchema when the type isn't in the datastore types/)
const SYSTEM_ITEMS = path.join(__dirname, '../../kanecta-system-items/items');

const DEFAULT_LICENSE = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739'; // All Rights Reserved

// ─── helpers ──────────────────────────────────────────────────────────────────

function camelToSnake(str) {
  return str.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
}

function walkDir(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, results);
    else results.push(full);
  }
  return results;
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

/** Extract the table name from a CREATE TABLE DDL string. */
function tableNameFromDdl(ddl) {
  const m = ddl.match(/CREATE TABLE\s+"?([^"\s(]+)"?\s*\(/i);
  return m ? m[1] : null;
}

/** Extract quoted column names from a CREATE TABLE DDL string. */
function columnsFromDdl(ddl) {
  const cols = [];
  const re = /^\s+"([^"]+)"\s+/gm;
  let m;
  while ((m = re.exec(ddl)) !== null) {
    // Skip constraint lines — they don't start with a plain quoted column
    const line = ddl.slice(m.index).split('\n')[0];
    if (!line.includes('CONSTRAINT')) cols.push(m[1]);
  }
  return cols;
}

/** Resolve a parent ID — root is self-referential, orphans go to data_root. */
function resolveParent(id, parentId, knownIds, dataRoot, counts) {
  if (!parentId) return id;
  if (parentId === id) return id;
  if (knownIds.has(parentId)) return parentId;
  console.warn(`  WARN: orphan ${id} — parent ${parentId} not found, re-parenting to data_root`);
  counts.reparented++;
  return dataRoot;
}

/** Resolve typeId → type.json.
 *  Prefers system-items (updated with sqlSchema) over the local datastore
 *  types/ which may be pre-1.3.0 files without sqlSchema. Falls back to
 *  local if system-items doesn't have a match. */
function resolveTypeJson(typeId) {
  const shard = (id) => path.join(id.slice(0, 2), id.slice(2, 4), typeId);

  const systemPath = path.join(SYSTEM_ITEMS, shard(typeId), 'type.json');
  const systemJson = fs.existsSync(systemPath) ? readJson(systemPath) : null;
  if (systemJson?.sqlSchema?.length) return systemJson;

  const localPath = path.join(TYPES_DIR, shard(typeId), 'type.json');
  const localJson = fs.existsSync(localPath) ? readJson(localPath) : null;
  if (localJson?.sqlSchema?.length) return localJson;

  return null;
}

// ─── collect items ────────────────────────────────────────────────────────────

function collectItems() {
  const items = [];
  for (const file of walkDir(DATA_DIR)) {
    if (path.basename(file) !== 'metadata.json') continue;
    const meta = readJson(file);
    if (!meta) continue;
    const dir = path.dirname(file);
    const objectData = readJson(path.join(dir, 'object.json'));
    items.push({ meta, objectData, dir });
  }
  return items;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  console.log('Connected to Postgres');

  const items = collectItems();
  console.log(`Found ${items.length} items (${items.filter(i => i.meta.type === 'object').length} object-type)`);

  // ── 1. ensure obj_* tables exist for every typeId we'll encounter ──────────
  const typeIdsSeen = new Set(items.filter(i => i.meta.typeId).map(i => i.meta.typeId));
  for (const typeId of typeIdsSeen) {
    const typeJson = resolveTypeJson(typeId);
    if (!typeJson?.sqlSchema?.length) {
      console.warn(`  WARN: no sqlSchema found for typeId ${typeId} — skipping table creation`);
      continue;
    }
    for (const ddl of typeJson.sqlSchema) {
      const createIfNotExists = ddl.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
      await client.query(createIfNotExists);
    }
    const tableName = tableNameFromDdl(typeJson.sqlSchema[0]);
    console.log(`  Ensured table: ${tableName}`);
  }

  // ── 2. insert all items first (one transaction, FK is DEFERRABLE) ─────────
  // Build a set of all known IDs so we can detect orphaned parents.
  const knownIds = new Set(items.map(i => i.meta.id));
  const dataRoot = items.find(i => i.meta.type === 'data_root')?.meta.id;
  if (!dataRoot) throw new Error('data_root item not found in datastore — cannot re-parent orphans');

  await client.query('BEGIN');
  let inserted = 0, skipped = 0;
  const counts = { reparented: 0 };

  for (const { meta } of items) {
    const {
      id,
      parentId,
      value        = null,
      type,
      typeId       = null,
      owner,
      license      = null,
      sortOrder    = 0,
      confidence   = null,
      status       = null,
      tags         = [],
      createdAt,
      modifiedAt,
      createdBy,
      modifiedBy,
      cachedAt     = null,
      subscribedAt = null,
      subscriptionSource = null,
      completedAt  = null,
      dueAt        = null,
      visibility   = 'private',
    } = meta;

    const res = await client.query(
      `INSERT INTO items (
        id, parent_id, value, type, type_id, owner, license,
        sort_order, confidence, status, tags,
        created_at, modified_at, created_by, modified_by,
        cached_at, subscribed_at, subscription_source,
        is_remote, completed_at, due_at, visibility, aspect
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,
        $12,$13,$14,$15,
        $16,$17,$18,
        $19,$20,$21,$22,$23
      ) ON CONFLICT (id) DO NOTHING`,
      [
        id,
        resolveParent(id, parentId, knownIds, dataRoot, counts),
        value,
        type,
        typeId,
        owner,
        license ?? DEFAULT_LICENSE,
        sortOrder,
        confidence,
        status,
        tags,
        createdAt,
        modifiedAt,
        createdBy  ?? owner,
        modifiedBy ?? owner,
        cachedAt,
        subscribedAt,
        subscriptionSource,
        false,
        completedAt,
        dueAt,
        visibility,
        null,
      ]
    );

    if (res.rowCount > 0) inserted++; else skipped++;
  }

  await client.query('COMMIT');
  console.log(`  Items: ${inserted} inserted, ${skipped} skipped${counts.reparented ? `, ${counts.reparented} re-parented to data_root` : ''}`);

  // ── 3. insert object data (separate pass — all items now exist) ────────────
  await client.query('BEGIN');
  let objInserted = 0;

  for (const { meta, objectData } of items) {
    const { id, type, typeId } = meta;
    if (type !== 'object' || !typeId || !objectData) continue;

    const typeJson = resolveTypeJson(typeId);
    if (!typeJson?.sqlSchema?.length) continue;

    const tableName = tableNameFromDdl(typeJson.sqlSchema[0]);
    if (!tableName) continue;

    const knownCols = columnsFromDdl(typeJson.sqlSchema[0]);

    // Map camelCase object.json keys → snake_case column names, keeping only known columns
    const colVals = {};
    for (const [key, val] of Object.entries(objectData)) {
      const col = camelToSnake(key);
      if (knownCols.includes(col)) colVals[col] = val;
    }

    const cols   = Object.keys(colVals);
    const vals   = Object.values(colVals);
    const params = vals.map((_, i) => `$${i + 2}`).join(', ');

    await client.query(
      `INSERT INTO "${tableName}" (item_id, ${cols.map(c => `"${c}"`).join(', ')})
       VALUES ($1, ${params})
       ON CONFLICT (item_id) DO NOTHING`,
      [id, ...vals]
    );
    objInserted++;
  }

  await client.query('COMMIT');

  console.log(`\nDone.`);
  console.log(`  Items inserted : ${inserted}`);
  console.log(`  Items skipped  : ${skipped} (already present)`);
  console.log(`  Object rows    : ${objInserted}`);

  await client.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
