#!/usr/bin/env node
'use strict';

/**
 * Kanecta datastore migration: overlay branches → per-branch full folders
 *
 * Restructures a 1.4.0 filesystem datastore from the OLD overlay model to the
 * NEW per-branch full-folder model.
 *
 * OLD layout (overlay model):
 *   .kanecta/items/<s1>/<s2>/<uuid>/item.json   main items
 *   .kanecta/index.db                           one shared index, with
 *                                               `branches` + `branch_changes` tables
 *   .kanecta/branches/<name>/items/...          overlay files (changed/created only)
 *
 * NEW layout (per-branch full folders):
 *   .kanecta/branches/main/items/<s1>/<s2>/<uuid>/item.json   full tree for main
 *   .kanecta/branches/main/index.db                           derived index (gitignored)
 *   .kanecta/branches/main/branch.json                        { name, fill, upstream, createdAt }
 *   .kanecta/branches/<name>/items/...                        FULL copy of main + overlay applied
 *   .kanecta/branches/<name>/index.db
 *   .kanecta/branches/<name>/branch.json
 *
 * `main` is no longer special — it becomes branches/main. Every branch becomes a
 * complete, self-contained datastore folder (fill: "full", upstream: null).
 *
 * index.db is 100% derived: this script does NOT copy or rebuild index.db. After
 * migration, open each branch with the 1.4.0 adapter — it rebuilds index.db from
 * that branch's items/ automatically on first open.
 *
 * Idempotent: if branches/main/items already exists the datastore is already on
 * the new layout and the script is a no-op (unless --force).
 *
 * Usage:
 *   node migrate-datastore-to-per-branch.js <datastore-path> [--dry-run] [--force]
 *
 * --dry-run  Report what would change without writing any files.
 * --force    Re-run even if branches/main/items already exists.
 *
 * The original .kanecta/items and .kanecta/index.db are left in place as a
 * backup until you have verified the migration; delete them manually once
 * satisfied.
 */

const fs   = require('fs');
const path = require('path');

// ─── CLI ─────────────────────────────────────────────────────────────────────

const [,, datastorePath, ...flags] = process.argv;
const DRY_RUN = flags.includes('--dry-run');
const FORCE   = flags.includes('--force');

// ─── Migration (exported for tests) ────────────────────────────────────────────

function shardDir(baseItemsDir, id) {
  const hex = id.replace(/-/g, '');
  return path.join(baseItemsDir, hex.slice(0, 2), hex.slice(2, 4), id);
}

// Walk every item.json under an items/ tree.
function* scanItemFiles(baseDir) {
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

function writeItemJson(baseItemsDir, id, doc, log) {
  const dir = shardDir(baseItemsDir, id);
  if (log) log.push(`  write ${path.relative(baseItemsDir, path.join(dir, 'item.json'))}`);
  if (DRY_RUN) return;
  fs.mkdirSync(dir, { recursive: true });
  const p   = path.join(dir, 'item.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function deleteItemDir(baseItemsDir, id) {
  const dir = shardDir(baseItemsDir, id);
  if (DRY_RUN) return;
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// Read the OLD overlay registry + change set from the shared index.db, if present.
// Returns a Map<branchName, { id, baseBranch, createdAt }> and a function to read
// the per-branch overlay change set. Falls back gracefully if the table is gone.
function readOldBranchTables(sharedDbPath) {
  if (!fs.existsSync(sharedDbPath)) return null;
  let Database;
  try { Database = require('better-sqlite3'); } catch { return null; }
  let db;
  try { db = new Database(sharedDbPath, { readonly: true }); } catch { return null; }
  try {
    const hasBranches = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='branches'"
    ).get();
    if (!hasBranches) return { db, branches: [], overlay: () => ({ deletedIds: new Set() }) };

    const branches = db.prepare(
      'SELECT id, name, base_branch AS baseBranch, created_at AS createdAt FROM branches WHERE deleted_at IS NULL'
    ).all();

    const hasChanges = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='branch_changes'"
    ).get();

    const overlay = (branchId) => {
      const deletedIds = new Set();
      if (!hasChanges) return { deletedIds };
      const rows = db.prepare(
        "SELECT item_id, change_type FROM branch_changes WHERE branch_id = ? AND section = 'item'"
      ).all(branchId);
      for (const r of rows) if (r.change_type === 'delete') deletedIds.add(r.item_id);
      return { deletedIds };
    };

    return { db, branches, overlay };
  } catch {
    try { db.close(); } catch {}
    return null;
  }
}

function migrateDatastoreToPerBranch(datastorePath, { log = [] } = {}) {
  const k = path.join(datastorePath, '.kanecta');
  if (!fs.existsSync(k)) throw new Error(`No .kanecta directory found at: ${datastorePath}`);

  const oldItemsDir   = path.join(k, 'items');
  const oldSharedDb   = path.join(k, 'index.db');
  const branchesDir   = path.join(k, 'branches');
  const mainRoot      = path.join(branchesDir, 'main');
  const mainItemsDir  = path.join(mainRoot, 'items');

  // Idempotency: already on the new layout?
  if (fs.existsSync(mainItemsDir) && !FORCE) {
    log.push('Already migrated — branches/main/items exists. Use --force to re-run.');
    return { migrated: false, branches: [] };
  }

  if (!fs.existsSync(oldItemsDir)) {
    throw new Error(`No .kanecta/items found at: ${datastorePath} (nothing to migrate)`);
  }

  const now = new Date().toISOString();
  const migratedBranches = [];

  // 1) Move main: .kanecta/items → .kanecta/branches/main/items
  log.push('Migrating main → branches/main');
  if (!DRY_RUN) fs.mkdirSync(mainRoot, { recursive: true });
  for (const jsonPath of scanItemFiles(oldItemsDir)) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { continue; }
    if (!doc?.item?.id) continue;
    writeItemJson(mainItemsDir, doc.item.id, doc);
  }

  // branches/main/branch.json — canonical, local-only, full.
  log.push('  write branches/main/branch.json');
  if (!DRY_RUN) {
    fs.writeFileSync(
      path.join(mainRoot, 'branch.json'),
      JSON.stringify({ name: 'main', fill: 'full', upstream: null, createdAt: now }, null, 2),
      'utf8',
    );
  }
  migratedBranches.push('main');

  // Ensure .gitignore ignores index.db at any depth.
  const giPath = path.join(k, '.gitignore');
  if (!DRY_RUN) {
    let gi = '';
    try { gi = fs.readFileSync(giPath, 'utf8'); } catch {}
    if (!gi.split(/\r?\n/).some(l => l.trim() === 'index.db')) {
      fs.writeFileSync(giPath, (gi && !gi.endsWith('\n') ? gi + '\n' : gi) + 'index.db\n', 'utf8');
    }
  }

  // 2) Materialise overlay branches into full folders.
  //    Each old branches/<name> held only changed/created item.json files plus a
  //    branch_changes delete set. The full branch = copy of main + overlay edits
  //    applied + tombstoned (deleted) items removed.
  const reg = readOldBranchTables(oldSharedDb);
  const overlayNamesOnDisk = new Set();
  if (fs.existsSync(branchesDir)) {
    for (const entry of fs.readdirSync(branchesDir)) {
      if (entry === 'main') continue;
      const full = path.join(branchesDir, entry);
      if (!fs.statSync(full).isDirectory()) continue;
      // Skip dirs that already look like new-layout full folders (have branch.json
      // AND no need to re-materialise) only when not forcing — but to be safe we
      // re-materialise any dir that still has a (possibly partial) items/ overlay.
      overlayNamesOnDisk.add(entry);
    }
  }

  // Build a lookup of registered branches by encoded dir name.
  const encode = (name) => name.replace(/\//g, '__');
  const regByDir = new Map();
  if (reg?.branches) for (const b of reg.branches) regByDir.set(encode(b.name), b);

  for (const dirName of overlayNamesOnDisk) {
    const branchRoot      = path.join(branchesDir, dirName);
    const overlayItemsDir = path.join(branchRoot, 'items');
    const branchItemsDir  = overlayItemsDir; // we materialise in place

    const regEntry  = regByDir.get(dirName) || null;
    const name      = regEntry?.name ?? dirName.replace(/__/g, '/');
    const baseBranch = regEntry?.baseBranch ?? 'main';
    const createdAt = regEntry?.createdAt ?? now;

    log.push(`Materialising overlay branch "${name}" → full folder`);

    // Collect overlay edits/creates already present in the branch's items/.
    const overlayDocs = new Map();
    for (const jsonPath of scanItemFiles(overlayItemsDir)) {
      let doc;
      try { doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { continue; }
      if (doc?.item?.id) overlayDocs.set(doc.item.id, doc);
    }

    // Determine the delete (tombstone) set from branch_changes, if available.
    const { deletedIds } = regEntry && reg?.overlay
      ? reg.overlay(regEntry.id)
      : { deletedIds: new Set() };

    // Copy main's full tree into the branch (skip tombstoned + overlaid items).
    for (const jsonPath of scanItemFiles(mainItemsDir)) {
      let doc;
      try { doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { continue; }
      const id = doc?.item?.id;
      if (!id) continue;
      if (deletedIds.has(id)) continue;          // deleted on this branch → omit
      if (overlayDocs.has(id)) continue;         // overlaid → branch's own copy wins
      writeItemJson(branchItemsDir, id, doc);
    }

    // Remove any branch item files that are tombstoned (in case the overlay
    // physically held a stale copy) — the full branch must not contain them.
    for (const id of deletedIds) deleteItemDir(branchItemsDir, id);

    // overlayDocs (edits + creates) already live in branchItemsDir — leave them.

    // branch.json — every migrated branch is a full, local-only copy.
    log.push(`  write branches/${dirName}/branch.json`);
    if (!DRY_RUN) {
      fs.writeFileSync(
        path.join(branchRoot, 'branch.json'),
        JSON.stringify({ name, fill: 'full', upstream: null, base: baseBranch, createdAt }, null, 2),
        'utf8',
      );
    }

    // Drop any stale per-branch index/WAL so the adapter rebuilds it.
    if (!DRY_RUN) {
      for (const f of ['index.db', 'index.db-wal', 'index.db-shm']) {
        const p = path.join(branchRoot, f);
        if (fs.existsSync(p)) { try { fs.rmSync(p); } catch {} }
      }
    }

    migratedBranches.push(name);
  }

  if (reg?.db) { try { reg.db.close(); } catch {} }

  return { migrated: true, branches: migratedBranches };
}

// ─── CLI entry point ───────────────────────────────────────────────────────────

function main() {
  if (!datastorePath) {
    console.error('Usage: node migrate-datastore-to-per-branch.js <datastore-path> [--dry-run] [--force]');
    process.exit(1);
  }
  const log = [];
  let result;
  try {
    result = migrateDatastoreToPerBranch(datastorePath, { log });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  for (const line of log) console.log(line);
  if (!result.migrated) return;
  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Migrated ${result.branches.length} branch(es): ${result.branches.join(', ')}`);
  console.log('Old .kanecta/items and .kanecta/index.db left in place as backup — delete once verified.');
  console.log('index.db is derived and will be rebuilt per-branch on next open.');
}

if (require.main === module) main();

module.exports = { migrateDatastoreToPerBranch };
