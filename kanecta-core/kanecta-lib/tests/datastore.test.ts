'use strict';

import os from 'os';
import path from 'path';
import fs from 'fs';
import { Datastore, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, TYPES_NODE } from '../src/index.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tmpDs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-lib-test-'));
  return Datastore.init(root, 'test@example.com');
}

afterEach(() => {
  // individual tests clean up their own temp dirs
});

// ─── Exports ──────────────────────────────────────────────────────────────────

test('exports Datastore class and constants', () => {
  expect(typeof Datastore).toBe('function');
  expect(Array.isArray(VALID_TYPES)).toBe(true);
  expect(Array.isArray(VALID_CONFIDENCES)).toBe(true);
  expect(Array.isArray(VALID_REL_TYPES)).toBe(true);
});

// ─── init / isDatastore ───────────────────────────────────────────────────────

test('init creates a valid datastore', () => {
  const ds = tmpDs();
  expect(Datastore.isDatastore(ds.root)).toBe(true);
  // Config lives in the root node's payload (not a separate config file in 1.4.0)
  expect(ds.config.owner).toBe('test@example.com');
  expect(ds.config.specVersion).toBe('1.4.0');
  // Each branch is a self-contained folder: main's items/ and index.db must exist
  expect(fs.existsSync(path.join(ds.k, 'branches', 'main', 'items'))).toBe(true);
  expect(fs.existsSync(path.join(ds.k, 'branches', 'main', 'index.db'))).toBe(true);
  fs.rmSync(ds.root, { recursive: true });
});

test('isDatastore returns false for non-datastore directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-ds-'));
  expect(Datastore.isDatastore(dir)).toBe(false);
  fs.rmSync(dir, { recursive: true });
});

// ─── create / get ─────────────────────────────────────────────────────────────

test('create returns item with valid UUID and correct fields', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'hello', type: 'string', tags: ['x'] });
  expect(item.id).toMatch(UUID_RE);
  expect(item.value).toBe('hello');
  expect(item.type).toBe('string');
  expect(item.tags).toEqual(['x']);
  expect(item.owner).toBe('test@example.com');
  expect(item.parentId).toMatch(UUID_RE); // defaults to root
  expect(item.sortOrder).toBe(1);
  fs.rmSync(ds.root, { recursive: true });
});

test('create auto-increments sortOrder among siblings', async () => {
  const ds = tmpDs();
  const a = await ds.create({ value: 'a' });
  const b = await ds.create({ value: 'b' });
  expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
  fs.rmSync(ds.root, { recursive: true });
});

test('get returns item by UUID, null for unknown', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  expect((await ds.get(item.id)).id).toBe(item.id);
  expect(await ds.get('ffffffff-ffff-4fff-bfff-ffffffffffff')).toBeNull(); // unknown UUID
  fs.rmSync(ds.root, { recursive: true });
});

test('create records [[uuid]] backlinks', async () => {
  const ds = tmpDs();
  const target = await ds.create({ value: 'target' });
  const src = await ds.create({ value: `see [[${target.id}]]` });
  expect(await ds.backlinks(target.id)).toContain(src.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('create writes history entry with changeType create', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'test' });
  const hist = await ds.history(item.id);
  expect(hist).toHaveLength(1);
  expect(hist[0].changeType).toBe('create');
  fs.rmSync(ds.root, { recursive: true });
});

// ─── resolve / alias ──────────────────────────────────────────────────────────

test('setAlias / resolveAlias / resolve round-trip', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  await ds.setAlias('my-alias', item.id);
  expect(await ds.resolveAlias('my-alias')).toBe(item.id);
  expect((await ds.resolve('my-alias')).id).toBe(item.id);
  expect((await ds.resolve(item.id)).id).toBe(item.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('listAliases returns sorted aliases', async () => {
  const ds = tmpDs();
  const a = await ds.create({ value: 'a' });
  const b = await ds.create({ value: 'b' });
  await ds.setAlias('zzz', a.id);
  await ds.setAlias('aaa', b.id);
  const list = await ds.listAliases();
  expect(list[0].alias).toBe('aaa');
  expect(list[1].alias).toBe('zzz');
  fs.rmSync(ds.root, { recursive: true });
});

test('removeAlias makes alias unresolvable', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  await ds.setAlias('gone', item.id);
  await ds.removeAlias('gone');
  expect(await ds.resolveAlias('gone')).toBeNull();
  fs.rmSync(ds.root, { recursive: true });
});

// ─── update ───────────────────────────────────────────────────────────────────

test('update changes value and reconciles backlinks', async () => {
  const ds = tmpDs();
  const t1 = await ds.create({ value: 'target1' });
  const t2 = await ds.create({ value: 'target2' });
  const src = await ds.create({ value: `[[${t1.id}]]` });
  await ds.update(src.id, { value: `[[${t2.id}]]` });
  expect(await ds.backlinks(t1.id)).not.toContain(src.id);
  expect(await ds.backlinks(t2.id)).toContain(src.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('update reconciles tags', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x', tags: ['old'] });
  await ds.update(item.id, { tags: ['new'] });
  expect(await ds.byTag('old')).not.toContain(item.id);
  expect(await ds.byTag('new')).toContain(item.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('update adds history snapshot', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'v1' });
  await ds.update(item.id, { value: 'v2' });
  const hist = await ds.history(item.id);
  expect(hist).toHaveLength(2);
  const types = hist.map(h => h.changeType);
  expect(types).toContain('create');
  expect(types).toContain('update');
  fs.rmSync(ds.root, { recursive: true });
});

// ─── delete ───────────────────────────────────────────────────────────────────

test('delete removes item and cleans up indexes', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'bye', tags: ['t'] });
  await ds.delete(item.id);
  expect(await ds.get(item.id)).toBeNull();
  expect(await ds.byTag('t')).not.toContain(item.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('deleteWarnings reports backlinks and inbound relationships', async () => {
  const ds = tmpDs();
  const target = await ds.create({ value: 'target' });
  await ds.create({ value: `[[${target.id}]]` });
  const warnings = await ds.deleteWarnings(target.id);
  expect(warnings.length).toBeGreaterThan(0);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── annotations ─────────────────────────────────────────────────────────────

test('annotate / annotations round-trip', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  const ann = await ds.annotate(item.id, { content: 'my note' });
  expect(ann.targetId).toBe(item.id);
  expect(ann.content).toBe('my note');
  const list = await ds.annotations(item.id);
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe(ann.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('annotate supports threaded reply', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  const parent = await ds.annotate(item.id, { content: 'parent' });
  const reply = await ds.annotate(item.id, { content: 'reply', parentAnnotationId: parent.id });
  expect(reply.parentAnnotationId).toBe(parent.id);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── relationships ────────────────────────────────────────────────────────────

test('relate creates outbound and inbound entries', async () => {
  const ds = tmpDs();
  const a = await ds.create({ value: 'a' });
  const b = await ds.create({ value: 'b' });
  const rel = await ds.relate(a.id, 'depends-on', b.id, { note: 'reason' });
  const srcRels = await ds.relationships(a.id);
  const tgtRels = await ds.relationships(b.id);
  expect(srcRels.outbound[0].id).toBe(rel.id);
  expect(srcRels.outbound[0].type).toBe('depends-on');
  expect(tgtRels.inbound[0].id).toBe(rel.id);
  expect(tgtRels.inbound[0].sourceId).toBe(a.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('rel types: datastore-configurable via addRelTypes; relate validates against the effective list', async () => {
  const ds = tmpDs();
  const a = await ds.create({ value: 'a' });
  const b = await ds.create({ value: 'b' });
  // unknown type rejected against built-in defaults
  await expect(ds.relate(a.id, 'affects', b.id)).rejects.toThrow(/Invalid relationship type/);
  // register datastore-level types -> now accepted; built-ins preserved
  const eff = await ds.addRelTypes(['affects', 'evidenced-by']);
  expect(eff).toEqual(expect.arrayContaining([...VALID_REL_TYPES, 'affects', 'evidenced-by']));
  expect((await ds.relate(a.id, 'affects', b.id)).type).toBe('affects');
  expect((await ds.relate(a.id, 'depends-on', b.id)).type).toBe('depends-on'); // built-in still works
  await expect(ds.relate(a.id, 'nope', b.id)).rejects.toThrow(/Invalid relationship type/);
  // persisted to config.json: a freshly-opened datastore keeps the custom types
  expect(Datastore.open(ds.root).relTypes).toEqual(expect.arrayContaining(['affects', 'evidenced-by']));
  // names must be lowercase slugs
  await expect(ds.addRelTypes(['Bad Name'])).rejects.toThrow(/lowercase slug/);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── tree / children ──────────────────────────────────────────────────────────

test('children returns sorted children', async () => {
  const ds = tmpDs();
  const root = await ds.create({ value: 'root' });
  const c1 = await ds.create({ value: 'c1', parentId: root.id, sortOrder: 0 });
  const c2 = await ds.create({ value: 'c2', parentId: root.id, sortOrder: 1 });
  const kids = await ds.children(root.id);
  expect(kids[0].id).toBe(c1.id);
  expect(kids[1].id).toBe(c2.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('tree respects maxDepth', async () => {
  const ds = tmpDs();
  const root = await ds.create({ value: 'root' });
  const child = await ds.create({ value: 'child', parentId: root.id });
  await ds.create({ value: 'grandchild', parentId: child.id });
  const nodes = await ds.tree(root.id, 1);
  expect(nodes.length).toBe(2);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── tags / byType ────────────────────────────────────────────────────────────

test('byTag returns IDs of tagged items', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x', tags: ['important'] });
  await ds.create({ value: 'y' });
  expect(await ds.byTag('important')).toContain(item.id);
  expect(await ds.byTag('important')).toHaveLength(1);
  fs.rmSync(ds.root, { recursive: true });
});

test('byType returns IDs of typed object items', async () => {
  const ds = tmpDs();
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const item = await ds.create({ type: 'object', typeId: tid });
  expect(await ds.byType(tid)).toContain(item.id);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── rebuildIndexes ───────────────────────────────────────────────────────────

test('rebuildIndexes repopulates indexes from filesystem', async () => {
  const ds     = tmpDs();
  const target = await ds.create({ value: 'target' });
  const src    = await ds.create({ value: `[[${target.id}]]`, tags: ['mytag'] });
  // Corrupt the SQLite index directly — backlinks and tags derived from item.json files
  ds._adapter._openDb().prepare('DELETE FROM perf_tags WHERE item_id = ?').run(src.id);
  ds._adapter._openDb().prepare('DELETE FROM perf_backlinks WHERE source_id = ?').run(src.id);
  await ds.rebuildIndexes();
  expect(await ds.backlinks(target.id)).toContain(src.id);
  expect(await ds.byTag('mytag')).toContain(src.id);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── Fixtures are generated, not committed ──────────────────────────────────
// These suites build datastores on the fly with the current adapter (tmpDs
// above), so fixtures can never go stale. A richer shared fixture is available
// via kanecta-sqlite-fs/test-helpers/makeSampleDatastore for suites that need a
// populated read-only store (see kanecta-cli/index.test.js).

// ─── Query ───────────────────────────────────────────────────────────────────

test('query filters by type and matches primitive/custom type names', async () => {
  const ds       = tmpDs();
  const root     = await ds.create({ value: 'root' });
  const textItem = await ds.create({ value: 'hello', type: 'text', parentId: root.id });
  await ds.create({ value: 'world', type: 'string', parentId: root.id });

  // Register custom type via createType (1.4.0 approach)
  const { metadata: typeMeta } = await ds.createType('mycustomtype', { icon: 'Category' });
  const customItem = await ds.create({
    type: 'object', typeId: typeMeta.id, parentId: root.id, objectData: { title: 'Custom Item' },
  });

  const texts = await ds.query({ type: 'text', rootId: root.id });
  expect(texts).toHaveLength(1);
  expect(texts[0].id).toBe(textItem.id);

  const customs = await ds.query({ type: 'mycustomtype' });
  expect(customs).toHaveLength(1);
  expect(customs[0].id).toBe(customItem.id);
  expect(customs[0].objectData).toEqual({ title: 'Custom Item' });

  fs.rmSync(ds.root, { recursive: true });
});

test('query filters by rootId scoping', async () => {
  const ds = tmpDs();
  const r1 = await ds.create({ value: 'r1' });
  const r2 = await ds.create({ value: 'r2' });

  const c1 = await ds.create({ value: 'c1', parentId: r1.id });
  const c2 = await ds.create({ value: 'c2', parentId: r2.id });

  const results1 = await ds.query({ rootId: r1.id });
  const ids1 = results1.map(r => r.id);
  expect(ids1).toContain(r1.id);
  expect(ids1).toContain(c1.id);
  expect(ids1).not.toContain(r2.id);
  expect(ids1).not.toContain(c2.id);

  fs.rmSync(ds.root, { recursive: true });
});

test('query filters by where predicates (operators: =, !=, in, contains, >, <)', async () => {
  const ds   = tmpDs();
  const root = await ds.create({ value: 'root' });
  const { metadata: typeMeta } = await ds.createType('item', { icon: 'Category' });

  const item1 = await ds.create({
    type: 'object', typeId: typeMeta.id, parentId: root.id,
    objectData: { severity: 'P1', status: 'open', score: 10, tags: ['bug', 'ui'] },
  });
  const item2 = await ds.create({
    type: 'object', typeId: typeMeta.id, parentId: root.id,
    objectData: { severity: 'P2', status: 'closed', score: 5, tags: ['backend'] },
  });

  // '=' operator (default)
  const res1 = await ds.query({ where: { severity: 'P1' } });
  expect(res1).toHaveLength(1);
  expect(res1[0].id).toBe(item1.id);

  // '!=' operator
  const res2 = await ds.query({ where: { severity: { op: '!=', value: 'P1' } } });
  expect(res2).toHaveLength(1);
  expect(res2[0].id).toBe(item2.id);

  // 'in' operator
  const res3 = await ds.query({ where: { severity: { op: 'in', value: ['P1', 'P3'] } } });
  expect(res3).toHaveLength(1);
  expect(res3[0].id).toBe(item1.id);

  // 'contains' operator on string
  const res4 = await ds.query({ where: { status: { op: 'contains', value: 'ope' } } });
  expect(res4).toHaveLength(1);
  expect(res4[0].id).toBe(item1.id);

  // 'contains' operator on array
  const res5 = await ds.query({ where: { tags: { op: 'contains', value: 'Bug' } } });
  expect(res5).toHaveLength(1);
  expect(res5[0].id).toBe(item1.id);

  // '>' operator
  const res6 = await ds.query({ where: { score: { op: '>', value: 7 } } });
  expect(res6).toHaveLength(1);
  expect(res6[0].id).toBe(item1.id);

  // '<' operator
  const res7 = await ds.query({ where: { score: { op: '<', value: 7 } } });
  expect(res7).toHaveLength(1);
  expect(res7[0].id).toBe(item2.id);

  fs.rmSync(ds.root, { recursive: true });
});

test('query supports sorting and limits', async () => {
  const ds   = tmpDs();
  const root = await ds.create({ value: 'root' });
  const { metadata: typeMeta } = await ds.createType('item', { icon: 'Category' });

  await ds.create({ type: 'object', typeId: typeMeta.id, parentId: root.id, objectData: { score: 10 } });
  await ds.create({ type: 'object', typeId: typeMeta.id, parentId: root.id, objectData: { score: 30 } });
  await ds.create({ type: 'object', typeId: typeMeta.id, parentId: root.id, objectData: { score: 20 } });

  // Sort ascending
  const asc = await ds.query({ type: 'item', sort: { field: 'score', dir: 'asc' } });
  expect(asc.map(a => a.objectData.score)).toEqual([10, 20, 30]);

  // Sort descending and limit
  const descLimit = await ds.query({ type: 'item', sort: { field: 'score', dir: 'desc' }, limit: 2 });
  expect(descLimit).toHaveLength(2);
  expect(descLimit.map(a => a.objectData.score)).toEqual([30, 20]);

  fs.rmSync(ds.root, { recursive: true });
});

// ─── 1.4.0: Type model ───────────────────────────────────────────────────────

test('TYPES_NODE is exported with the correct well-known UUID', () => {
  expect(TYPES_NODE).toBe('11111111-1111-1111-1111-111111111111');
});

test('VALID_TYPES includes connector and excludes removed primitive types', () => {
  expect(VALID_TYPES).toContain('connector');
  const removed = ['task', 'note', 'event', 'decision', 'claim', 'question', 'concept', 'entity'];
  for (const t of removed) {
    expect(VALID_TYPES).not.toContain(t);
  }
});

// ─── 1.4.0: New meta fields ───────────────────────────────────────────────────

test('create initialises 1.4.0 meta fields to null', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'test' });
  expect(item.expiresAt).toBeNull();
  expect(item.deletedAt).toBeNull();
  expect(item.connectorId).toBeNull();
  expect(item.materialized).toBeNull();
  // removed fields must not exist
  expect(item.subscribedAt).toBeUndefined();
  expect(item.subscriptionSource).toBeUndefined();
  fs.rmSync(ds.root, { recursive: true });
});

test('update accepts and persists expiresAt, connectorId, materialized, cachedAt', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  const connectorId = 'aaaaaaaa-0000-0000-0000-000000000001';
  const expires = new Date(Date.now() + 86400_000).toISOString();
  const cached = new Date().toISOString();
  const updated = await ds.update(item.id, {
    expiresAt: expires,
    connectorId,
    materialized: false,
    cachedAt: cached,
  });
  expect(updated.expiresAt).toBe(expires);
  expect(updated.connectorId).toBe(connectorId);
  expect(updated.materialized).toBe(false);
  expect(updated.cachedAt).toBe(cached);
  // Persisted — reopen via get()
  const fetched = await ds.get(item.id);
  expect(fetched.expiresAt).toBe(expires);
  expect(fetched.connectorId).toBe(connectorId);
  expect(fetched.materialized).toBe(false);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── 1.4.0: Soft-delete ──────────────────────────────────────────────────────

test('softDelete sets deletedAt, item still exists on disk', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'doomed' });
  const deleted = await ds.softDelete(item.id);
  expect(deleted.deletedAt).not.toBeNull();
  // get() returns it (with deletedAt set)
  const fetched = await ds.get(item.id);
  expect(fetched.deletedAt).not.toBeNull();
  fs.rmSync(ds.root, { recursive: true });
});

test('softDelete writes a soft-delete history entry', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  await ds.softDelete(item.id);
  const hist = await ds.history(item.id);
  expect(hist.map(h => h.changeType)).toContain('soft-delete');
  fs.rmSync(ds.root, { recursive: true });
});

test('restore clears deletedAt and writes a restore history entry', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  await ds.softDelete(item.id);
  const restored = await ds.restore(item.id);
  expect(restored.deletedAt).toBeNull();
  const hist = await ds.history(item.id);
  expect(hist.map(h => h.changeType)).toContain('restore');
  fs.rmSync(ds.root, { recursive: true });
});

test('query excludes soft-deleted items by default', async () => {
  const ds = tmpDs();
  const live = await ds.create({ value: 'live' });
  const gone = await ds.create({ value: 'gone' });
  await ds.softDelete(gone.id);
  const results = await ds.query({ limit: 0 });
  const ids = results.map(r => r.id);
  expect(ids).toContain(live.id);
  expect(ids).not.toContain(gone.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('query with includeDeleted: true returns soft-deleted items', async () => {
  const ds = tmpDs();
  const live = await ds.create({ value: 'live' });
  const gone = await ds.create({ value: 'gone' });
  await ds.softDelete(gone.id);
  const results = await ds.query({ includeDeleted: true, limit: 0 });
  const ids = results.map(r => r.id);
  expect(ids).toContain(live.id);
  expect(ids).toContain(gone.id);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── 1.4.0: expiresAt query filters ─────────────────────────────────────────

test('query expiredOnly returns only items with expiresAt in the past', async () => {
  const ds = tmpDs();
  const past = new Date(Date.now() - 10_000).toISOString();
  const future = new Date(Date.now() + 86400_000).toISOString();
  const stale = await ds.create({ value: 'stale' });
  const fresh = await ds.create({ value: 'fresh' });
  const never = await ds.create({ value: 'never' });
  await ds.update(stale.id, { expiresAt: past });
  await ds.update(fresh.id, { expiresAt: future });
  const results = await ds.query({ expiredOnly: true, limit: 0 });
  const ids = results.map(r => r.id);
  expect(ids).toContain(stale.id);
  expect(ids).not.toContain(fresh.id);
  expect(ids).not.toContain(never.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('query excludeExpired omits items with expiresAt in the past', async () => {
  const ds = tmpDs();
  const past = new Date(Date.now() - 10_000).toISOString();
  const future = new Date(Date.now() + 86400_000).toISOString();
  const stale = await ds.create({ value: 'stale' });
  const fresh = await ds.create({ value: 'fresh' });
  const never = await ds.create({ value: 'never' });
  await ds.update(stale.id, { expiresAt: past });
  await ds.update(fresh.id, { expiresAt: future });
  const results = await ds.query({ excludeExpired: true, limit: 0 });
  const ids = results.map(r => r.id);
  expect(ids).not.toContain(stale.id);
  expect(ids).toContain(fresh.id);
  expect(ids).toContain(never.id);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── 1.4.0: Time section ─────────────────────────────────────────────────────

test('readTimeJson returns null when no time.json exists', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  expect(await ds.readTimeJson(item.id)).toBeNull();
  fs.rmSync(ds.root, { recursive: true });
});

test('writeTimeJson / readTimeJson round-trip persists keyed contexts', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  const timeData = {
    main: {
      startAt: '2026-07-01T09:00:00Z',
      endAt: '2026-07-01T17:00:00Z',
      recurrenceRule: null,
      recurrenceExceptions: [],
      nextOccurrenceAt: null,
      completedAt: null,
    },
    review: {
      startAt: null,
      endAt: null,
      recurrenceRule: 'FREQ=QUARTERLY;BYDAY=MO;BYHOUR=9',
      recurrenceExceptions: [],
      nextOccurrenceAt: '2026-10-05T09:00:00Z',
      completedAt: null,
    },
  };
  await ds.writeTimeJson(item.id, timeData);
  const read = await ds.readTimeJson(item.id);
  expect(read).toEqual(timeData);
  fs.rmSync(ds.root, { recursive: true });
});

test('deleteTimeJson removes time.json, readTimeJson returns null afterwards', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  await ds.writeTimeJson(item.id, { main: { startAt: '2026-07-01T00:00:00Z' } });
  await ds.deleteTimeJson(item.id);
  expect(await ds.readTimeJson(item.id)).toBeNull();
  fs.rmSync(ds.root, { recursive: true });
});

// ─── Sparse branches (lib passthrough) ──────────────────────────────────────────

describe('sparse branches via the Datastore facade', () => {
  test('create sparse branch, make local changes, read through, and merge', async () => {
    const ds     = tmpDs();
    const onMain = await ds.create({ value: 'on main', type: 'text' });
    const child  = await ds.create({ value: 'child', type: 'text', parentId: onMain.id });

    const branch = ds.createBranch('feature/sparse', { fill: 'sparse' });
    expect(branch.fill).toBe('sparse');
    expect(branch.upstream).toEqual({ branch: 'main' });

    ds.useBranch('feature/sparse');
    // Reads fall through to upstream.
    expect((await ds.get(onMain.id)).value).toBe('on main');

    // Local add + edit + delete.
    const added = await ds.create({ value: 'branch only', type: 'text' });
    await ds.update(onMain.id, { value: 'edited' }, 'test@example.com');
    await ds.delete(child.id, 'test@example.com');
    expect(await ds.get(child.id)).toBeNull();

    const diff = ds.branchDiff('feature/sparse');
    expect(diff.adds.map((x) => x.id)).toContain(added.id);
    expect(diff.edits.map((x) => x.id)).toContain(onMain.id);
    expect(diff.deletes.map((x) => x.id)).toContain(child.id);

    // Upstream untouched until merge.
    ds.useBranch('main');
    expect((await ds.get(onMain.id)).value).toBe('on main');
    expect((await ds.get(child.id)).value).toBe('child');

    const res = ds.mergeBranchLocally('feature/sparse');
    expect(res.merged).toBe(3);
    expect((await ds.get(added.id)).value).toBe('branch only');
    expect((await ds.get(onMain.id)).value).toBe('edited');
    expect(await ds.get(child.id)).toBeNull();

    fs.rmSync(ds.root, { recursive: true, force: true });
  });
});

// ─── transaction(fn) facade ───────────────────────────────────────────────────

describe('transaction(fn) facade', () => {
  test('delegates to the adapter and passes the datastore as the tx handle', async () => {
    let received;
    const calls = [];
    const stubAdapter = {
      // Mimic the Postgres adapter: open the tx scope, then invoke fn.
      async transaction(fn) { return fn(this); },
      async create(opts) { calls.push(['create', opts]); return { id: 'x', ...opts }; },
    };
    const ds = new Datastore(stubAdapter);
    const out = await ds.transaction(async (tx) => {
      received = tx;
      const a = await tx.create({ value: 'a' });
      return a.id;
    });
    // fn's return value flows back out.
    expect(out).toBe('x');
    // The handle passed to fn is the facade itself, so every tx.* enlists via it.
    expect(received).toBe(ds);
    expect(calls).toEqual([['create', { value: 'a' }]]);
  });

  test('throws on a working set whose adapter has no transaction support', async () => {
    const ds = new Datastore({}); // an adapter with no transaction()
    await expect(ds.transaction(async () => {})).rejects.toThrow(/not supported on this working set/);
  });

  test('sqlite-fs working set: transaction commits atomically and rejects an async fn', async () => {
    const ds = tmpDs();
    // sync fn: multi-op atomic commit. The tx handle is the SYNC surface
    // (plain returns, sync throws) — no reaching into _adapter needed.
    const id = await ds.transaction((tx) => {
      const a = tx.create({ value: 'tx-a' });
      tx.update(a.id, { value: 'tx-a2' });
      return a.id;
    });
    expect((await ds.get(id)).value).toBe('tx-a2');
    // async fn: rejected loudly (better-sqlite3 is synchronous), nothing written
    await expect(ds.transaction(async (tx) => { await tx.create({ value: 'lost' }); }))
      .rejects.toThrow(/synchronous/);
    fs.rmSync(ds.root, { recursive: true, force: true });
  });

  test('sqlite-fs working set: a failing op inside the fn rolls the whole transaction back', async () => {
    const ds = tmpDs();
    // The tx handle throws SYNCHRONOUSLY on a failing op — with the async
    // facade as the handle this surfaced as a floating rejected promise after
    // commit, and the earlier ops stayed applied (the bug this test pins).
    let createdId: any = null;
    await expect(ds.transaction((tx) => {
      createdId = tx.create({ value: 'doomed' }).id;
      tx.update('99999999-9999-4999-8999-999999999999', { value: 'no such item' });
    })).rejects.toThrow(/not found/i);
    expect(await ds.get(createdId)).toBeNull();
    fs.rmSync(ds.root, { recursive: true, force: true });
  });
});
