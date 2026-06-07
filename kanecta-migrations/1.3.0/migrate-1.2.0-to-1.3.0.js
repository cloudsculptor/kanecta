#!/usr/bin/env node
/**
 * Migrate a Kanecta filesystem datastore from spec v1.2.0 to v1.3.0.
 *
 * Usage:
 *   node migrate-1.2.0-to-1.3.0.js <datastore-path> [--dry-run]
 *
 * What this script does (the deterministic, mechanical part of the migration):
 *
 *   1. Bumps .kanecta/config/config.json specVersion to "1.3.0".
 *   2. Updates every metadata.json (items AND type-definition records) to the
 *      v1.3.0 shape: adds specVersion, defaults license/visibility/dueAt/aspect.
 *   3. Replaces every type.json whose ID matches a kanecta-system-items type
 *      with the canonical v1.3.0 version (adds sqlSchema, x-id, meta.sync/
 *      supersededBy/implements/extends/immutable, etc).
 *   4. Validates the results with @kanecta/specification's v1.3.0 schema
 *      validator and prints a report.
 *   5. Writes reshape-queue.json — the list of "object" items whose stored
 *      data references jsonSchema properties that no longer exist on their
 *      type's v1.3.0 shape (or whose type isn't a known system type at all).
 *
 * What this script deliberately does NOT do:
 *
 *   Reshaping the orphaned object data itself (e.g. turning a Test Case's
 *   `steps: [{action, expectedResult}]` array into something that fits the
 *   new flat type model) requires judgement calls that should involve both
 *   AI and the datastore owner. That phase is covered by the runbook in
 *   reshape-data-with-ai.md, which consumes reshape-queue.json.
 *
 * Safe to re-run — every step is idempotent.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { validateMetadata, validateType, validateItem } =
  require('../../kanecta-specification/1.3.0/kanecta-schema-validator/index.js');

const DATASTORE = process.argv[2];
const DRY_RUN   = process.argv.includes('--dry-run');

if (!DATASTORE) {
  console.error('Usage: node migrate-1.2.0-to-1.3.0.js <datastore-path> [--dry-run]');
  process.exit(1);
}

const KANECTA      = path.join(DATASTORE, '.kanecta');
const DATA_DIR     = path.join(KANECTA, 'data');
const TYPES_DIR    = path.join(KANECTA, 'types');
const CONFIG_PATH  = path.join(KANECTA, 'config', 'config.json');
const QUEUE_PATH   = path.join(__dirname, 'reshape-queue.json');
const SYSTEM_ITEMS = path.join(__dirname, '../../kanecta-system-items/items');

const TARGET_SPEC_VERSION = '1.3.0';
const DEFAULT_LICENSE     = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739'; // All Rights Reserved
const DEFAULT_VISIBILITY  = 'private';

// ─── helpers ──────────────────────────────────────────────────────────────────

function shard(id) { return path.join(id.slice(0, 2), id.slice(2, 4), id); }

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

function writeJson(filePath, value) {
  if (DRY_RUN) return;
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function systemTypeJson(typeId) {
  const p = path.join(SYSTEM_ITEMS, shard(typeId), 'type.json');
  return fs.existsSync(p) ? readJson(p) : null;
}

function propertyKeys(typeJson) {
  return new Set(Object.keys(typeJson?.jsonSchema?.properties ?? {}));
}

// ─── 1. config.json ──────────────────────────────────────────────────────────

function migrateConfig() {
  const config = readJson(CONFIG_PATH);
  if (!config) {
    console.warn(`  WARN: no config.json found at ${CONFIG_PATH}`);
    return;
  }
  if (config.specVersion === TARGET_SPEC_VERSION) {
    console.log('  config.json already at 1.3.0');
    return;
  }
  config.specVersion = TARGET_SPEC_VERSION;
  writeJson(CONFIG_PATH, config);
  console.log(`  config.json: specVersion -> ${TARGET_SPEC_VERSION}`);
}

// ─── 2. metadata.json (items + type records) ────────────────────────────────

function migrateMetadata(metaPath, counts) {
  const meta = readJson(metaPath);
  if (!meta) return;

  let changed = false;

  if (meta.specVersion !== TARGET_SPEC_VERSION) { meta.specVersion = TARGET_SPEC_VERSION; changed = true; }
  if (meta.license == null)                     { meta.license    = DEFAULT_LICENSE;      changed = true; }
  if (meta.visibility === undefined)            { meta.visibility = DEFAULT_VISIBILITY;   changed = true; }
  if (meta.dueAt === undefined)                 { meta.dueAt      = null;                 changed = true; }
  if (meta.aspect === undefined)                { meta.aspect     = null;                 changed = true; }

  if (changed) {
    writeJson(metaPath, meta);
    counts.metadataUpdated++;
  } else {
    counts.metadataAlreadyCurrent++;
  }

  const { valid, errors } = validateMetadata(meta);
  if (!valid) {
    counts.metadataInvalid++;
    console.warn(`  INVALID metadata: ${meta.id ?? metaPath}`);
    for (const err of errors) console.warn(`    [${err.rule}] ${err.path}: ${err.message}`);
  }
}

// ─── 3. type.json ────────────────────────────────────────────────────────────

/**
 * Replace a datastore type.json with its canonical v1.3.0 system-items
 * version (when one exists AND that canonical version itself passes
 * validation), and report whether the instance-data shape changed
 * (properties removed/added) so affected object items can be queued for
 * AI-assisted reshaping.
 *
 * We deliberately refuse to propagate a canonical type that fails its own
 * validation — that would trade a known-1.2.0 type for a broken 1.3.0 one.
 * Such types are left untouched and reported as "blocked on system-items".
 *
 * Returns one of:
 *   { typeId, replaced: true,  custom: false, newTypeJson, removedFields, addedFields }
 *   { typeId, replaced: false, custom: true,  oldTypeJson }                              — no system-items match
 *   { typeId, replaced: false, blocked: true, oldTypeJson }                              — system-items version itself invalid
 */
function migrateType(typePath, counts) {
  const oldTypeJson = readJson(typePath);
  const dir    = path.dirname(typePath);
  const typeId = path.basename(dir);
  const title  = oldTypeJson?.jsonSchema?.title ?? '?';

  const newTypeJson = systemTypeJson(typeId);
  if (!newTypeJson) {
    counts.customTypes++;
    console.warn(`  CUSTOM type (no system-items match, left as-is): ${typeId} — "${title}"`);
    return { typeId, replaced: false, custom: true, oldTypeJson };
  }

  const { valid, errors } = validateType(newTypeJson);
  if (!valid) {
    counts.typesBlocked++;
    console.warn(`  BLOCKED: kanecta-system-items version of ${typeId} ("${title}") fails v1.3.0 validation — left datastore copy untouched, fix system-items first:`);
    for (const err of errors) console.warn(`    [${err.rule}] ${err.path}: ${err.message}`);
    return { typeId, replaced: false, blocked: true, oldTypeJson };
  }

  const oldProps = propertyKeys(oldTypeJson);
  const newProps = propertyKeys(newTypeJson);
  const removedFields = [...oldProps].filter(p => !newProps.has(p));
  const addedFields   = [...newProps].filter(p => !oldProps.has(p));

  writeJson(typePath, newTypeJson);
  counts.typesReplaced++;
  if (removedFields.length || addedFields.length) {
    counts.typesShapeChanged++;
    console.log(`  type ${typeId} "${title}": shape changed`
      + (removedFields.length ? ` — removed [${removedFields.join(', ')}]` : '')
      + (addedFields.length   ? ` — added [${addedFields.join(', ')}]`     : ''));
  }

  return { typeId, replaced: true, custom: false, newTypeJson, removedFields, addedFields };
}

// ─── 4. reshape queue ────────────────────────────────────────────────────────

/**
 * For every "object" item, check whether its stored data references
 * properties that no longer exist on its (now-migrated) type, or whether
 * its type wasn't a recognised system type at all. Collect these into a
 * queue for the AI-assisted reshaping runbook.
 */
function buildReshapeQueue(typeResults, counts) {
  const queue = [];
  const typeById = new Map(typeResults.map(t => [t.typeId, t]));

  for (const metaPath of walkDir(DATA_DIR)) {
    if (path.basename(metaPath) !== 'metadata.json') continue;
    const meta = readJson(metaPath);
    if (!meta || meta.type !== 'object' || !meta.typeId) continue;

    const objectPath = path.join(path.dirname(metaPath), 'object.json');
    const objectData = readJson(objectPath);
    if (!objectData) continue;

    const typeResult = typeById.get(meta.typeId);

    if (!typeResult || typeResult.custom || typeResult.blocked) {
      queue.push({
        itemId: meta.id,
        itemValue: meta.value,
        typeId: meta.typeId,
        typeName: typeResult?.oldTypeJson?.jsonSchema?.title ?? null,
        reason: typeResult?.blocked ? 'system-items-type-invalid' : 'custom-type-not-in-system-items',
        objectPath,
        objectData,
      });
      continue;
    }

    // Compare against the *current* type shape (not old-vs-new) so this stays
    // correct whether or not type.json has already been replaced this run —
    // running the migration twice must not lose orphaned-field detections.
    const currentProps = propertyKeys(typeResult.newTypeJson);
    const orphanedKeys = Object.keys(objectData).filter(k => !currentProps.has(k));
    if (orphanedKeys.length) {
      queue.push({
        itemId: meta.id,
        itemValue: meta.value,
        typeId: meta.typeId,
        typeName: typeResult.newTypeJson.jsonSchema?.title,
        reason: 'orphaned-fields',
        orphanedFields: Object.fromEntries(orphanedKeys.map(k => [k, objectData[k]])),
        newProperties: typeResult.addedFields,
        objectPath,
        objectData,
      });
    }

    const { valid, errors } = validateItem(objectData, typeResult.newTypeJson);
    if (!valid) {
      counts.itemsInvalid++;
      console.warn(`  INVALID object data: ${meta.id} ("${meta.value}")`);
      for (const err of errors) console.warn(`    [${err.rule}] ${err.path}: ${err.message}`);
    }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n');
  }
  return queue;
}

// ─── main ─────────────────────────────────────────────────────────────────────

function main() {
  if (DRY_RUN) console.log('--- DRY RUN: no files will be written ---\n');

  console.log(`Migrating ${DATASTORE} (1.2.0 -> 1.3.0)\n`);

  console.log('1. Datastore config');
  migrateConfig();

  console.log('\n2. Type definitions (.kanecta/types/)');
  const counts = {
    metadataUpdated: 0, metadataAlreadyCurrent: 0, metadataInvalid: 0,
    typesReplaced: 0, typesShapeChanged: 0, typesBlocked: 0, customTypes: 0,
    itemsInvalid: 0,
  };
  const typeResults = [];
  for (const file of walkDir(TYPES_DIR)) {
    if (path.basename(file) === 'type.json') typeResults.push(migrateType(file, counts));
  }

  console.log('\n3. Item metadata (.kanecta/data/ and .kanecta/types/)');
  for (const dir of [DATA_DIR, TYPES_DIR]) {
    for (const file of walkDir(dir)) {
      if (path.basename(file) === 'metadata.json') migrateMetadata(file, counts);
    }
  }

  console.log('\n4. Reshape queue (object data orphaned by type-shape changes)');
  const queue = buildReshapeQueue(typeResults, counts);
  console.log(`  ${queue.length} item(s) need AI-assisted reshaping -> ${DRY_RUN ? '(dry run, not written)' : QUEUE_PATH}`);

  console.log('\n--- Summary ---');
  console.log(`  metadata.json updated         : ${counts.metadataUpdated}`);
  console.log(`  metadata.json already current : ${counts.metadataAlreadyCurrent}`);
  console.log(`  metadata.json invalid         : ${counts.metadataInvalid}`);
  console.log(`  type.json replaced            : ${counts.typesReplaced}`);
  console.log(`  type.json shape changed       : ${counts.typesShapeChanged}`);
  console.log(`  type.json blocked (bad system items def): ${counts.typesBlocked}`);
  console.log(`  custom types (no system match): ${counts.customTypes}`);
  console.log(`  object items needing reshape  : ${queue.length}`);
  console.log(`  object items invalid          : ${counts.itemsInvalid}`);

  if (queue.length) {
    console.log(`\nNext: follow reshape-data-with-ai.md to work through ${path.basename(QUEUE_PATH)} with the datastore owner.`);
  }
}

main();
