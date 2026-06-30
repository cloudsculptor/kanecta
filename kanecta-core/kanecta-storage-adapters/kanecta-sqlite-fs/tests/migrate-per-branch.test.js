'use strict';

// Tests for the overlay → per-branch-full-folder datastore migration. The
// migration script lives in @kanecta/migrations; we exercise it here because
// this package already has jest + better-sqlite3 wired up, and because the real
// proof is that the migrated datastore opens cleanly with the new adapter.

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const Database = require('better-sqlite3');

const { SqliteFsAdapter } = require('../src/adapter');
const {
  migrateDatastoreToPerBranch,
} = require('../../../kanecta-migrations/1.4.0/migrate-datastore-to-per-branch');

const ROOT_ID = '00000000-0000-0000-0000-000000000000';

// ─── Build an OLD-layout (overlay model) datastore by hand ──────────────────────

function shard(id) {
  const hex = id.replace(/-/g, '');
  return [hex.slice(0, 2), hex.slice(2, 4)];
}

function writeOldItem(k, baseItemsDir, doc) {
  const [s1, s2] = shard(doc.item.id);
  const dir = path.join(baseItemsDir, s1, s2, doc.item.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'item.json'), JSON.stringify(doc, null, 2), 'utf8');
}

function makeDoc(id, value, { parentId = ROOT_ID, type = 'text' } = {}) {
  const now = '2026-06-01T00:00:00.000Z';
  return {
    item: { id, parentId, type, typeId: null, value, sortOrder: 0, aspect: null },
    meta: {
      specVersion: '1.4.0', owner: 'test@example.com', license: null, visibility: 'private',
      confidence: null, status: null, tags: [], createdAt: now, modifiedAt: now,
      createdBy: 'test@example.com', modifiedBy: 'test@example.com',
      completedAt: null, dueAt: null, expiresAt: null, deletedAt: null, cachedAt: null,
      connectorId: null, materialized: null, files: {}, layer: null,
      sourceSystem: null, sourceExternalId: null, icon: null,
    },
    search: null, payload: null, time: null,
  };
}

// Returns { root, ids } for an old-layout datastore with main items + one overlay
// branch that creates one item, edits one main item, and deletes one main item.
function buildOldLayout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-migrate-'));
  const k    = path.join(root, '.kanecta');
  const oldItemsDir = path.join(k, 'items');
  fs.mkdirSync(oldItemsDir, { recursive: true });
  fs.writeFileSync(path.join(k, '.gitignore'), 'index.db\n', 'utf8');

  const ids = {
    root: ROOT_ID,
    keep:   '11111111-1111-4111-8111-111111111111',
    edit:   '22222222-2222-4222-8222-222222222222',
    del:    '33333333-3333-4333-8333-333333333333',
    branchNew: '44444444-4444-4444-8444-444444444444',
    branchId:  '55555555-5555-4555-8555-555555555555',
  };

  // Main tree: root + 3 items.
  writeOldItem(k, oldItemsDir, makeDoc(ROOT_ID, 'root', { parentId: ROOT_ID, type: 'root' }));
  writeOldItem(k, oldItemsDir, makeDoc(ids.keep, 'keep me'));
  writeOldItem(k, oldItemsDir, makeDoc(ids.edit, 'original on main'));
  writeOldItem(k, oldItemsDir, makeDoc(ids.del,  'will be deleted on branch'));

  // Overlay branch "feature/x": items/ holds only the created + edited docs.
  const branchDir = path.join(k, 'branches', 'feature__x');
  const branchItemsDir = path.join(branchDir, 'items');
  fs.mkdirSync(branchItemsDir, { recursive: true });
  writeOldItem(k, branchItemsDir, makeDoc(ids.branchNew, 'created on branch'));
  writeOldItem(k, branchItemsDir, makeDoc(ids.edit, 'edited on branch'));

  // Shared index.db with the old branches + branch_changes tables.
  const db = new Database(path.join(k, 'index.db'));
  db.exec(`
    CREATE TABLE branches (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      base_branch TEXT NOT NULL DEFAULT 'main', created_at TEXT NOT NULL,
      merged_at TEXT, deleted_at TEXT
    );
    CREATE TABLE branch_changes (
      branch_id TEXT NOT NULL, item_id TEXT NOT NULL,
      change_type TEXT NOT NULL, section TEXT NOT NULL, data TEXT, changed_at TEXT NOT NULL,
      PRIMARY KEY (branch_id, item_id, section)
    );
  `);
  db.prepare('INSERT INTO branches (id, name, base_branch, created_at) VALUES (?, ?, ?, ?)')
    .run(ids.branchId, 'feature/x', 'main', '2026-06-02T00:00:00.000Z');
  // Only change_type + item_id (section='item') matter for the migration's delete set.
  db.prepare("INSERT INTO branch_changes (branch_id, item_id, change_type, section, data, changed_at) VALUES (?, ?, 'create', 'item', NULL, ?)")
    .run(ids.branchId, ids.branchNew, '2026-06-02T00:00:00.000Z');
  db.prepare("INSERT INTO branch_changes (branch_id, item_id, change_type, section, data, changed_at) VALUES (?, ?, 'update', 'item', NULL, ?)")
    .run(ids.branchId, ids.edit, '2026-06-02T00:00:00.000Z');
  db.prepare("INSERT INTO branch_changes (branch_id, item_id, change_type, section, data, changed_at) VALUES (?, ?, 'delete', 'item', NULL, ?)")
    .run(ids.branchId, ids.del, '2026-06-02T00:00:00.000Z');

  // Old format kept these ONLY in index.db (the bug we are fixing). The migration
  // must re-materialise them as item.json so they survive the index rebuild.
  db.exec(`
    CREATE TABLE aliases (alias TEXT PRIMARY KEY, target_id TEXT NOT NULL);
    CREATE TABLE relationships (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, type TEXT NOT NULL, target_id TEXT NOT NULL,
      note TEXT, created_at TEXT NOT NULL, created_by TEXT
    );
    CREATE TABLE annotations (
      id TEXT PRIMARY KEY, target_id TEXT NOT NULL, author TEXT, content TEXT NOT NULL,
      created_at TEXT NOT NULL, parent_annotation_id TEXT
    );
    CREATE TABLE history (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, change_type TEXT NOT NULL,
      snapshot TEXT NOT NULL, changed_at TEXT NOT NULL, changed_by TEXT
    );
  `);
  db.prepare('INSERT INTO aliases (alias, target_id) VALUES (?, ?)').run('keep-alias', ids.keep);
  db.prepare('INSERT INTO relationships (id, source_id, type, target_id, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('66666666-6666-4666-8666-666666666666', ids.keep, 'depends-on', ids.edit, 'a note', '2026-06-02T00:00:00.000Z', 'test@example.com');
  db.prepare('INSERT INTO annotations (id, target_id, author, content, created_at, parent_annotation_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('77777777-7777-4777-8777-777777777777', ids.keep, 'al@x.z', 'an old comment', '2026-06-02T00:00:00.000Z', null);
  db.prepare('INSERT INTO history (item_id, change_type, snapshot, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)')
    .run(ids.keep, 'create', JSON.stringify({ id: ids.keep, value: 'keep me', changeType: 'create' }), '2026-06-01T00:00:00.000Z', 'test@example.com');
  db.close();

  return { root, k, ids };
}

describe('migrate datastore overlay → per-branch full folders', () => {
  let root, k, ids;
  beforeEach(() => { ({ root, k, ids } = buildOldLayout()); });
  afterEach(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

  test('moves main items into branches/main and writes branch.json', () => {
    migrateDatastoreToPerBranch(root);
    expect(fs.existsSync(path.join(k, 'branches', 'main', 'items'))).toBe(true);
    const hex = ids.keep.replace(/-/g, '');
    expect(fs.existsSync(path.join(k, 'branches', 'main', 'items', hex.slice(0, 2), hex.slice(2, 4), ids.keep, 'item.json'))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(k, 'branches', 'main', 'branch.json'), 'utf8'));
    expect(manifest).toMatchObject({ name: 'main', fill: 'full', upstream: null });
  });

  test('migrated datastore is recognised and opens with the new adapter', () => {
    migrateDatastoreToPerBranch(root);
    expect(SqliteFsAdapter.isDatastore(root)).toBe(true);
    const a = SqliteFsAdapter.open(root);
    expect(a.get(ids.keep)?.value).toBe('keep me');
    expect(a.get(ids.edit)?.value).toBe('original on main'); // main unchanged
    expect(a.get(ids.del)?.value).toBe('will be deleted on branch'); // present on main
    expect(a.get(ids.branchNew)).toBeNull(); // branch-only item not on main
  });

  test('materialises the overlay branch into a full self-contained folder', () => {
    migrateDatastoreToPerBranch(root);
    const a = SqliteFsAdapter.open(root);
    a.useBranch('feature/x');

    // Full copy of main: keep item is present even though it was untouched on the branch.
    expect(a.get(ids.keep)?.value).toBe('keep me');
    // Edit applied (branch's own copy wins over main).
    expect(a.get(ids.edit)?.value).toBe('edited on branch');
    // Branch-created item present.
    expect(a.get(ids.branchNew)?.value).toBe('created on branch');
    // Tombstoned item is gone on the branch.
    expect(a.get(ids.del)).toBeNull();

    const manifest = JSON.parse(fs.readFileSync(path.join(k, 'branches', 'feature__x', 'branch.json'), 'utf8'));
    expect(manifest).toMatchObject({ name: 'feature/x', fill: 'full', upstream: null });
  });

  test('re-materialises old db-only metadata (aliases/relationships/annotations/history) — no data loss', () => {
    migrateDatastoreToPerBranch(root);
    const a = SqliteFsAdapter.open(root); // index rebuilt purely from the filesystem

    expect(a.resolveAlias('keep-alias')).toBe(ids.keep);
    expect(a.relationships(ids.keep).outbound).toHaveLength(1);
    expect(a.relationships(ids.keep).outbound[0].targetId).toBe(ids.edit);
    expect(a.annotations(ids.keep)).toHaveLength(1);
    expect(a.annotations(ids.keep)[0].content).toBe('an old comment');
    expect(a.history(ids.keep).length).toBeGreaterThan(0);
  });

  test('is idempotent — second run is a no-op', () => {
    const first = migrateDatastoreToPerBranch(root);
    expect(first.migrated).toBe(true);
    const second = migrateDatastoreToPerBranch(root);
    expect(second.migrated).toBe(false);
  });

  test('reports the set of migrated branches', () => {
    const log = [];
    const result = migrateDatastoreToPerBranch(root, { log });
    expect(result.branches.sort()).toEqual(['feature/x', 'main']);
    expect(log.join('\n')).toContain('Migrating main → branches/main');
  });
});
