'use strict';

// Integration tests against a real Postgres instance.
//
// Uses a per-run schema (search_path-scoped) so the kanecta database and its
// data are never touched. Run with:
//
//   docker compose -f docker-compose.test.yml up -d
//   npm test
//
// Or set KANECTA_TEST_PG_URL to point at any Postgres with pgvector enabled.

const crypto = require('crypto');
const { Pool } = require('pg');
const { PostgresAdapter, ROOT_ID } = require('../src/adapter');
const { reciprocalRankFusion } = require('../src/embeddings');

const CONNECTION_STRING =
  process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const OWNER = 'test@example.com';

const SCHEMA = `kanecta_test_${crypto.randomBytes(4).toString('hex')}`;

let adminPool;
let pool;
let adapter;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: CONNECTION_STRING });
  await adminPool.query(`CREATE SCHEMA "${SCHEMA}"`);
  pool    = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path="${SCHEMA}"` });
  adapter = await PostgresAdapter.init(pool, OWNER);
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await adminPool.end();
  }
});

// ─── Lifecycle ─────────────────────────────────────────────────────────────────

describe('init / open', () => {
  test('init sets owner and spec_version in config', async () => {
    expect(adapter.config.owner).toBe(OWNER);
    expect(adapter.config.spec_version).toBe('1.4.0');
  });

  test('init seeds the root node', async () => {
    const root = await adapter.getRoot();
    expect(root).toBeTruthy();
    expect(root.id).toBe(ROOT_ID);
    expect(root.type).toBe('root');
  });

  test('open works against existing schema', async () => {
    const ds2 = await PostgresAdapter.open(pool);
    expect(ds2.config.owner).toBe(OWNER);
    const root = await ds2.getRoot();
    expect(root.id).toBe(ROOT_ID);
  });

  test('open throws for empty schema', async () => {
    const emptySchema = `empty_${crypto.randomBytes(4).toString('hex')}`;
    await adminPool.query(`CREATE SCHEMA "${emptySchema}"`);
    const emptyPool = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path="${emptySchema}"` });
    try {
      await expect(PostgresAdapter.open(emptyPool)).rejects.toThrow(/Not a Kanecta database/);
    } finally {
      await emptyPool.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${emptySchema}" CASCADE`);
    }
  });

  test('well-known nodes not duplicated on reopen', async () => {
    await PostgresAdapter.init(pool, OWNER);
    const kids = await adapter.children(ROOT_ID);
    const types = kids.map(c => c.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

// ─── Materialized path ─────────────────────────────────────────────────────────

describe('materialized path', () => {
  test('root node path = ROOT_ID', async () => {
    expect(await adapter._getPath(ROOT_ID)).toBe(ROOT_ID);
  });

  test('child of root has path ROOT_ID/childId', async () => {
    const child = await adapter.create({ value: 'root-child' });
    expect(await adapter._getPath(child.id)).toBe(`${ROOT_ID}/${child.id}`);
  });

  test('create computes path from parent', async () => {
    const parent = await adapter.create({ value: 'parent' });
    const child  = await adapter.create({ value: 'child', parentId: parent.id });
    const expected = `${ROOT_ID}/${parent.id}/${child.id}`;
    expect(await adapter._getPath(child.id)).toBe(expected);
  });

  test('update with parentId change cascades path through subtree', async () => {
    const p1  = await adapter.create({ value: 'p1' });
    const p2  = await adapter.create({ value: 'p2' });
    const c   = await adapter.create({ value: 'c',  parentId: p1.id });
    const gc  = await adapter.create({ value: 'gc', parentId: c.id });
    const ggc = await adapter.create({ value: 'ggc', parentId: gc.id });

    await adapter.update(c.id, { parentId: p2.id }, OWNER);

    const p2Path  = await adapter._getPath(p2.id);
    const cPath   = await adapter._getPath(c.id);
    const gcPath  = await adapter._getPath(gc.id);
    const ggcPath = await adapter._getPath(ggc.id);

    expect(cPath).toBe(`${p2Path}/${c.id}`);
    expect(gcPath).toBe(`${cPath}/${gc.id}`);
    expect(ggcPath).toBe(`${gcPath}/${ggc.id}`);
  });

  test('tree() reflects moved subtree after parentId change', async () => {
    const p1    = await adapter.create({ value: 'move-p1' });
    const p2    = await adapter.create({ value: 'move-p2' });
    const child = await adapter.create({ value: 'move-c', parentId: p1.id });
    await adapter.update(child.id, { parentId: p2.id }, OWNER);
    const t1 = await adapter.tree(p1.id);
    const t2 = await adapter.tree(p2.id);
    expect(t1.some(n => n.item.id === child.id)).toBe(false);
    expect(t2.some(n => n.item.id === child.id)).toBe(true);
  });
});

// ─── ancestors / subtreeCount ──────────────────────────────────────────────────

describe('ancestors', () => {
  test('returns [] for root', async () => {
    expect(await adapter.ancestors(ROOT_ID)).toEqual([]);
  });

  test('returns full ancestor chain in root-to-parent order', async () => {
    const p   = await adapter.create({ value: 'anc-parent' });
    const c   = await adapter.create({ value: 'anc-child', parentId: p.id });
    const anc = await adapter.ancestors(c.id);
    const ids = anc.map(a => a.id);
    expect(ids[0]).toBe(ROOT_ID);
    expect(ids[ids.length - 1]).toBe(p.id);
    expect(ids).not.toContain(c.id);
  });

  test('direct child of root has root as only ancestor', async () => {
    const child = await adapter.create({ value: 'anc-root-child' });
    const anc = await adapter.ancestors(child.id);
    expect(anc.map(a => a.id)).toEqual([ROOT_ID]);
  });
});

describe('subtreeCount', () => {
  test('returns 1 for a leaf', async () => {
    const item = await adapter.create({ value: 'sc-leaf' });
    expect(await adapter.subtreeCount(item.id)).toBe(1);
  });

  test('counts all descendants', async () => {
    const p  = await adapter.create({ value: 'sc-root' });
    await adapter.create({ value: 'sc-c1', parentId: p.id });
    const c2 = await adapter.create({ value: 'sc-c2', parentId: p.id });
    await adapter.create({ value: 'sc-gc', parentId: c2.id });
    expect(await adapter.subtreeCount(p.id)).toBe(4);
  });

  test('returns 0 for unknown id', async () => {
    expect(await adapter.subtreeCount('ffffffff-ffff-4fff-bfff-ffffffffffff')).toBe(0);
  });
});

// ─── create ────────────────────────────────────────────────────────────────────

describe('create', () => {
  test('defaults parentId to root', async () => {
    const item = await adapter.create({ value: 'default-parent' });
    expect(item.parentId).toBe(ROOT_ID);
  });

  test('respects explicit parentId', async () => {
    const parent = await adapter.create({ value: 'explicit-parent' });
    const child  = await adapter.create({ value: 'explicit-child', parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
  });

  test('auto-assigns sortOrder after siblings', async () => {
    const parent = await adapter.create({ value: 'sort-parent' });
    const a = await adapter.create({ value: 'a', parentId: parent.id });
    const b = await adapter.create({ value: 'b', parentId: parent.id });
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
  });

  test('persists tags', async () => {
    const item = await adapter.create({ value: 'tagged', tags: ['alpha', 'beta'] });
    expect((await adapter.get(item.id)).tags).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  test('persists 1.4.0 meta fields at create', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const item   = await adapter.create({
      value: 'meta14',
      expiresAt:   future,
      connectorId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      materialized: false,
      cachedAt:    future,
    });
    expect(item.expiresAt).toBe(future);
    expect(item.connectorId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(item.materialized).toBe(false);
    expect(item.cachedAt).toBe(future);
  });

  test('writes backlinks for [[uuid]] references in value', async () => {
    const target = await adapter.create({ value: 'link-target' });
    const linker = await adapter.create({ value: `see [[${target.id}]]` });
    expect(await adapter.backlinks(target.id)).toContain(linker.id);
  });

  test('warns (not throws) for unknown typeId in default mode', async () => {
    const fake = 'deadbeef-0000-4000-8000-000000000001';
    const item = await adapter.create({ type: 'object', typeId: fake });
    expect(item.warning).toMatch(/has no type definition/);
    expect(await adapter.get(item.id)).toBeTruthy();
  });

  test('throws for unknown typeId in strict mode', async () => {
    const fake = 'deadbeef-0000-4000-8000-000000000002';
    await expect(
      adapter.create({ type: 'object', typeId: fake, strict: true }),
    ).rejects.toMatchObject({ name: 'UnknownTypeError', code: 'UNKNOWN_TYPE' });
  });

  test('throws for well-known type names', async () => {
    await expect(adapter.create({ type: 'root' })).rejects.toThrow(/well-known/);
    await expect(adapter.create({ type: 'root' })).rejects.toThrow(/well-known/);
  });

  test('records create event in history', async () => {
    const item = await adapter.create({ value: 'hist-create' });
    const h    = await adapter.history(item.id);
    expect(h.some(e => e.changeType === 'create')).toBe(true);
  });
});

// ─── get ───────────────────────────────────────────────────────────────────────

describe('get', () => {
  test('retrieves a created item', async () => {
    const item = await adapter.create({ value: 'get-me' });
    expect((await adapter.get(item.id)).value).toBe('get-me');
  });

  test('returns null for unknown id', async () => {
    expect(await adapter.get('ffffffff-ffff-4fff-bfff-ffffffffffff')).toBeNull();
  });

  test('gets ROOT_ID', async () => {
    expect((await adapter.get(ROOT_ID)).type).toBe('root');
  });
});

// ─── update ────────────────────────────────────────────────────────────────────

describe('update', () => {
  test('updates value', async () => {
    const item = await adapter.create({ value: 'old' });
    await adapter.update(item.id, { value: 'new' }, OWNER);
    expect((await adapter.get(item.id)).value).toBe('new');
  });

  test('updates tags', async () => {
    const item = await adapter.create({ value: 'tag-upd', tags: ['old'] });
    await adapter.update(item.id, { tags: ['new'] }, OWNER);
    const got = await adapter.get(item.id);
    expect(got.tags).toContain('new');
    expect(got.tags).not.toContain('old');
  });

  test('updates 1.4.0 meta fields', async () => {
    const item   = await adapter.create({ value: 'meta-upd' });
    const future = new Date(Date.now() + 60_000).toISOString();
    await adapter.update(item.id, {
      expiresAt:   future,
      connectorId: 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff',
      materialized: true,
      cachedAt:    future,
    }, OWNER);
    const got = await adapter.get(item.id);
    expect(got.expiresAt).toBe(future);
    expect(got.connectorId).toBe('aaaaaaaa-bbbb-cccc-dddd-ffffffffffff');
    expect(got.materialized).toBe(true);
    expect(got.cachedAt).toBe(future);
  });

  test('clears expiresAt by setting null', async () => {
    const item = await adapter.create({ value: 'exp-clear' });
    await adapter.update(item.id, { expiresAt: new Date().toISOString() }, OWNER);
    await adapter.update(item.id, { expiresAt: null }, OWNER);
    expect((await adapter.get(item.id)).expiresAt).toBeNull();
  });

  test('updates backlinks when value changes', async () => {
    const target = await adapter.create({ value: 'bl-target' });
    const linker = await adapter.create({ value: 'no link' });
    await adapter.update(linker.id, { value: `[[${target.id}]]` }, OWNER);
    expect(await adapter.backlinks(target.id)).toContain(linker.id);
    await adapter.update(linker.id, { value: 'removed' }, OWNER);
    expect(await adapter.backlinks(target.id)).not.toContain(linker.id);
  });

  test('bumps modifiedAt', async () => {
    const item = await adapter.create({ value: 'mod-time' });
    const t1   = item.modifiedAt;
    await new Promise(r => setTimeout(r, 10));
    const r2   = await adapter.update(item.id, { value: 'changed' }, OWNER);
    expect(r2.modifiedAt > t1).toBe(true);
  });

  test('records update event in history', async () => {
    const item = await adapter.create({ value: 'upd-hist' });
    await adapter.update(item.id, { value: 'changed' }, OWNER);
    expect((await adapter.history(item.id)).some(e => e.changeType === 'update')).toBe(true);
  });

  test('throws when editing the reserved root node', async () => {
    await expect(adapter.update(ROOT_ID, { value: 'x' }, OWNER)).rejects.toThrow(/reserved root node/);
  });
});

// ─── delete ────────────────────────────────────────────────────────────────────

describe('delete', () => {
  test('removes item', async () => {
    const item = await adapter.create({ value: 'del-me' });
    await adapter.delete(item.id, OWNER);
    expect(await adapter.get(item.id)).toBeNull();
  });

  test('returns warnings for items with backlinks', async () => {
    const target = await adapter.create({ value: 'del-target' });
    await adapter.create({ value: `[[${target.id}]]` });
    const w = await adapter.deleteWarnings(target.id);
    expect(w.length).toBeGreaterThan(0);
  });

  test('cleans up backlink entries', async () => {
    const target = await adapter.create({ value: 'del-bl-target' });
    const linker = await adapter.create({ value: `[[${target.id}]]` });
    await adapter.delete(linker.id, OWNER);
    expect(await adapter.backlinks(target.id)).not.toContain(linker.id);
  });

  test('throws for well-known nodes', async () => {
    await expect(adapter.delete(ROOT_ID, OWNER)).rejects.toThrow(/reserved root node/);
  });

  test('records delete event in history', async () => {
    const item = await adapter.create({ value: 'del-hist' });
    await adapter.delete(item.id, OWNER);
    const h = await adapter.history(item.id);
    expect(h.some(e => e.changeType === 'delete')).toBe(true);
  });
});

// ─── softDelete / restore ──────────────────────────────────────────────────────

describe('softDelete / restore', () => {
  test('softDelete sets deletedAt', async () => {
    const item = await adapter.create({ value: 'sd-item' });
    const res  = await adapter.softDelete(item.id, OWNER);
    expect(res.deletedAt).not.toBeNull();
    expect((await adapter.get(item.id)).deletedAt).not.toBeNull();
  });

  test('soft-deleted item is excluded from query() by default', async () => {
    const item = await adapter.create({ value: `sd-exclude-${Date.now()}` });
    await adapter.softDelete(item.id, OWNER);
    const results = await adapter.query({ limit: 1000 });
    expect(results.some(i => i.id === item.id)).toBe(false);
  });

  test('soft-deleted item included when includeDeleted: true', async () => {
    const item = await adapter.create({ value: `sd-include-${Date.now()}` });
    await adapter.softDelete(item.id, OWNER);
    const results = await adapter.query({ includeDeleted: true, limit: 1000 });
    expect(results.some(i => i.id === item.id)).toBe(true);
  });

  test('item remains get()-able after softDelete', async () => {
    const item = await adapter.create({ value: 'sd-gettable' });
    await adapter.softDelete(item.id, OWNER);
    expect(await adapter.get(item.id)).not.toBeNull();
  });

  test('restore clears deletedAt', async () => {
    const item = await adapter.create({ value: 'sd-restore' });
    await adapter.softDelete(item.id, OWNER);
    const res = await adapter.restore(item.id, OWNER);
    expect(res.deletedAt).toBeNull();
    expect((await adapter.get(item.id)).deletedAt).toBeNull();
  });

  test('restored item appears in default query() again', async () => {
    const tag  = `sd-round-${Date.now()}`;
    const item = await adapter.create({ value: tag, tags: [tag] });
    await adapter.softDelete(item.id, OWNER);
    await adapter.restore(item.id, OWNER);
    const results = await adapter.query({ limit: 1000 });
    expect(results.some(i => i.id === item.id)).toBe(true);
  });

  test('records soft-delete and restore events in history', async () => {
    const item = await adapter.create({ value: 'sd-history' });
    await adapter.softDelete(item.id, OWNER);
    await adapter.restore(item.id, OWNER);
    const types = (await adapter.history(item.id)).map(e => e.changeType);
    expect(types).toContain('soft-delete');
    expect(types).toContain('restore');
  });

  test('throws restore for unknown item', async () => {
    await expect(adapter.restore('ffffffff-ffff-4fff-bfff-ffffffffffff', OWNER))
      .rejects.toThrow(/Item not found/);
  });

  test('throws softDelete for well-known nodes', async () => {
    await expect(adapter.softDelete(ROOT_ID, OWNER)).rejects.toThrow(/reserved root node/);
  });

  test('soft-delete cycle: soft-delete → restore → soft-delete', async () => {
    const item = await adapter.create({ value: 'sd-cycle' });
    await adapter.softDelete(item.id, OWNER);
    await adapter.restore(item.id, OWNER);
    await adapter.softDelete(item.id, OWNER);
    expect((await adapter.get(item.id)).deletedAt).not.toBeNull();
  });
});

// ─── children ──────────────────────────────────────────────────────────────────

describe('children', () => {
  test('returns direct children sorted by sortOrder', async () => {
    const parent = await adapter.create({ value: 'ch-parent' });
    await adapter.create({ value: 'b', parentId: parent.id, sortOrder: 10 });
    await adapter.create({ value: 'a', parentId: parent.id, sortOrder: 0 });
    const kids = await adapter.children(parent.id);
    expect(kids[0].value).toBe('a');
    expect(kids[1].value).toBe('b');
  });

  test('returns empty array for a leaf', async () => {
    const item = await adapter.create({ value: 'ch-leaf' });
    expect(await adapter.children(item.id)).toEqual([]);
  });

  test('filters by named aspect', async () => {
    const parent = await adapter.create({ value: 'asp-parent' });
    await adapter.create({ value: 'sidebar', parentId: parent.id, aspect: 'sidebar' });
    await adapter.create({ value: 'main', parentId: parent.id });
    const sidebar = await adapter.children(parent.id, 'sidebar');
    expect(sidebar).toHaveLength(1);
    expect(sidebar[0].value).toBe('sidebar');
    // No aspect filter returns items without an aspect
    const main = await adapter.children(parent.id);
    expect(main).toHaveLength(1);
    expect(main[0].value).toBe('main');
  });
});

// ─── tree ──────────────────────────────────────────────────────────────────────

describe('tree', () => {
  test('returns root at depth 0 and children at depth 1', async () => {
    const root  = await adapter.create({ value: 'tree-root' });
    const child = await adapter.create({ value: 'tree-child', parentId: root.id });
    const t     = await adapter.tree(root.id);
    expect(t[0]).toMatchObject({ item: expect.objectContaining({ id: root.id }), depth: 0 });
    expect(t.some(n => n.item.id === child.id && n.depth === 1)).toBe(true);
  });

  test('respects maxDepth', async () => {
    const root  = await adapter.create({ value: 'td-root' });
    const child = await adapter.create({ value: 'td-child', parentId: root.id });
    const grand = await adapter.create({ value: 'td-grand', parentId: child.id });
    const t     = await adapter.tree(root.id, 1);
    expect(t.some(n => n.item.id === child.id)).toBe(true);
    expect(t.some(n => n.item.id === grand.id)).toBe(false);
  });

  test('returns [] for unknown rootId', async () => {
    expect(await adapter.tree('ffffffff-ffff-4fff-bfff-ffffffffffff')).toEqual([]);
  });

  test('uses root when no rootId given', async () => {
    const item = await adapter.create({ value: 'null-root-item' });
    const t    = await adapter.tree(null);
    expect(t.some(n => n.item.id === item.id)).toBe(true);
  });

  test('children within same depth sorted by sortOrder', async () => {
    const parent = await adapter.create({ value: 'tr-sort-parent' });
    await adapter.create({ value: 'z', parentId: parent.id, sortOrder: 10 });
    await adapter.create({ value: 'a', parentId: parent.id, sortOrder: 0 });
    const t    = await adapter.tree(parent.id);
    const vals = t.filter(n => n.depth === 1).map(n => n.item.value);
    expect(vals).toEqual(['a', 'z']);
  });

  test('path-scoped tree only returns subtree rows', async () => {
    const parent = await adapter.create({ value: 'isolated-root' });
    await adapter.create({ value: 'noise-outside' });
    const child = await adapter.create({ value: 'in-subtree', parentId: parent.id });
    const t = await adapter.tree(parent.id);
    expect(t).toHaveLength(2);
    expect(t[0].item.id).toBe(parent.id);
    expect(t[1].item.id).toBe(child.id);
  });
});

// ─── aliases ───────────────────────────────────────────────────────────────────

describe('aliases', () => {
  test('setAlias / resolveAlias round-trip', async () => {
    const item = await adapter.create({ value: 'alias-item' });
    await adapter.setAlias('my-alias', item.id);
    expect(await adapter.resolveAlias('my-alias')).toBe(item.id);
  });

  test('resolveAlias returns null for unknown alias', async () => {
    expect(await adapter.resolveAlias('no-such-alias')).toBeNull();
  });

  test('listAliases returns all aliases sorted', async () => {
    const a = await adapter.create({ value: 'al-a' });
    const b = await adapter.create({ value: 'al-b' });
    await adapter.setAlias(`zzz-${Date.now()}`, a.id);
    await adapter.setAlias(`aaa-${Date.now()}`, b.id);
    const list = await adapter.listAliases();
    expect(list.length).toBeGreaterThanOrEqual(2);
    // Should be sorted
    const aliases = list.map(l => l.alias);
    expect(aliases).toEqual([...aliases].sort());
  });

  test('removeAlias deletes it', async () => {
    const item = await adapter.create({ value: 'alias-del' });
    await adapter.setAlias('del-me-alias', item.id);
    await adapter.removeAlias('del-me-alias');
    expect(await adapter.resolveAlias('del-me-alias')).toBeNull();
  });

  test('overwriting alias updates target', async () => {
    const a = await adapter.create({ value: 'alias-overwrite-a' });
    const b = await adapter.create({ value: 'alias-overwrite-b' });
    await adapter.setAlias('overwrite-alias', a.id);
    await adapter.setAlias('overwrite-alias', b.id);
    expect(await adapter.resolveAlias('overwrite-alias')).toBe(b.id);
  });

  test('resolve() works by UUID or alias', async () => {
    const item = await adapter.create({ value: 'resolve-item' });
    await adapter.setAlias('resolve-alias', item.id);
    expect((await adapter.resolve(item.id))?.id).toBe(item.id);
    expect((await adapter.resolve('resolve-alias'))?.id).toBe(item.id);
    expect(await adapter.resolve('unknown-alias')).toBeNull();
  });
});

// ─── annotations ───────────────────────────────────────────────────────────────

describe('annotations', () => {
  test('annotate / annotations round-trip', async () => {
    const item = await adapter.create({ value: 'ann-item' });
    const ann  = await adapter.annotate(item.id, { content: 'my note' });
    expect(ann.id).toBeDefined();
    expect(ann.content).toBe('my note');
    const all = await adapter.annotations(item.id);
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('my note');
  });

  test('returns [] when no annotations', async () => {
    const item = await adapter.create({ value: 'ann-empty' });
    expect(await adapter.annotations(item.id)).toEqual([]);
  });

  test('stores explicit author', async () => {
    const item = await adapter.create({ value: 'ann-author' });
    const ann  = await adapter.annotate(item.id, { content: 'note', author: 'alice@example.com' });
    const all  = await adapter.annotations(item.id);
    const got  = all.find(a => a.id === ann.id);
    expect(got.author).toBe('alice@example.com');
  });

  test('stores parentAnnotationId', async () => {
    const item  = await adapter.create({ value: 'ann-reply' });
    const root  = await adapter.annotate(item.id, { content: 'root' });
    const reply = await adapter.annotate(item.id, { content: 'reply', parentAnnotationId: root.id });
    const all   = await adapter.annotations(item.id);
    expect(all.find(a => a.id === reply.id).parentAnnotationId).toBe(root.id);
  });
});

// ─── relationships ─────────────────────────────────────────────────────────────

describe('relationships', () => {
  test('relate / relationships round-trip', async () => {
    const a = await adapter.create({ value: 'rel-a' });
    const b = await adapter.create({ value: 'rel-b' });
    const r = await adapter.relate(a.id, 'depends-on', b.id, { note: 'critical' });
    expect(r.type).toBe('depends-on');
    expect(r.note).toBe('critical');
    const ra = await adapter.relationships(a.id);
    expect(ra.outbound).toHaveLength(1);
    expect(ra.outbound[0].targetId).toBe(b.id);
    const rb = await adapter.relationships(b.id);
    expect(rb.inbound).toHaveLength(1);
    expect(rb.inbound[0].sourceId).toBe(a.id);
  });

  test('throws for invalid relationship type', async () => {
    const a = await adapter.create({ value: 'rel-inv-a' });
    const b = await adapter.create({ value: 'rel-inv-b' });
    await expect(adapter.relate(a.id, 'invented-type', b.id)).rejects.toThrow(/Invalid relationship type/);
  });

  test('relationships returns empty outbound/inbound for item with no relationships', async () => {
    const item = await adapter.create({ value: 'rel-empty' });
    const r    = await adapter.relationships(item.id);
    expect(r.outbound).toEqual([]);
    expect(r.inbound).toEqual([]);
  });

  test('listRelationships returns all relationships', async () => {
    const a = await adapter.create({ value: 'lr-a' });
    const b = await adapter.create({ value: 'lr-b' });
    const c = await adapter.create({ value: 'lr-c' });
    await adapter.relate(a.id, 'depends-on', b.id);
    await adapter.relate(b.id, 'relates-to', c.id);
    const all = await adapter.listRelationships();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── addRelTypes ───────────────────────────────────────────────────────────────

describe('addRelTypes', () => {
  test('adds a custom rel type and allows using it in relate()', async () => {
    await adapter.addRelTypes(['affects']);
    expect(adapter.relTypes).toContain('affects');
    const a = await adapter.create({ value: 'art-a' });
    const b = await adapter.create({ value: 'art-b' });
    await expect(adapter.relate(a.id, 'affects', b.id)).resolves.not.toThrow();
  });

  test('is idempotent — no duplicates', async () => {
    await adapter.addRelTypes(['evidenced-by']);
    await adapter.addRelTypes(['evidenced-by']);
    expect(adapter.relTypes.filter(t => t === 'evidenced-by').length).toBe(1);
  });

  test('rejects invalid names', async () => {
    await expect(adapter.addRelTypes(['BadName'])).rejects.toThrow(/Invalid relationship type name/);
    await expect(adapter.addRelTypes(['123-start'])).rejects.toThrow(/Invalid relationship type name/);
  });

  test('custom types survive reopen', async () => {
    await adapter.addRelTypes(['persists-across-open']);
    const ds2 = await PostgresAdapter.open(pool);
    expect(ds2.relTypes).toContain('persists-across-open');
  });
});

// ─── history ───────────────────────────────────────────────────────────────────

describe('history', () => {
  test('create event has correct snapshot', async () => {
    const item = await adapter.create({ value: 'hist-val' });
    const h    = await adapter.history(item.id);
    expect(h.some(e => e.changeType === 'create')).toBe(true);
    const create = h.find(e => e.changeType === 'create');
    expect(create.value).toBe('hist-val');
  });

  test('accumulates create + update + soft-delete + restore events', async () => {
    const item  = await adapter.create({ value: 'hist-full' });
    await adapter.update(item.id, { value: 'changed' }, OWNER);
    await adapter.softDelete(item.id, OWNER);
    await adapter.restore(item.id, OWNER);
    const types = (await adapter.history(item.id)).map(e => e.changeType);
    expect(types).toContain('create');
    expect(types).toContain('update');
    expect(types).toContain('soft-delete');
    expect(types).toContain('restore');
  });

  test('each entry has snapshotAt and changedBy', async () => {
    const item = await adapter.create({ value: 'hist-meta' });
    const h    = await adapter.history(item.id);
    expect(h[0].snapshotAt).toBeDefined();
    expect(h[0].changedBy).toBe(OWNER);
  });

  test('returns [] for unknown id', async () => {
    expect(await adapter.history('ffffffff-ffff-4fff-bfff-ffffffffffff')).toEqual([]);
  });
});

// ─── time data ─────────────────────────────────────────────────────────────────

describe('readTimeJson / writeTimeJson / deleteTimeJson', () => {
  test('readTimeJson returns null when not set', async () => {
    const item = await adapter.create({ value: 'td-none' });
    expect(await adapter.readTimeJson(item.id)).toBeNull();
  });

  test('writeTimeJson / readTimeJson round-trips', async () => {
    const item     = await adapter.create({ value: 'td-rw' });
    const timeData = { main: { startAt: '2026-01-01T00:00:00Z', endAt: null, recurrenceRule: null } };
    await adapter.writeTimeJson(item.id, timeData);
    expect(await adapter.readTimeJson(item.id)).toEqual(timeData);
  });

  test('deleteTimeJson clears time_data', async () => {
    const item = await adapter.create({ value: 'td-del' });
    await adapter.writeTimeJson(item.id, { main: {} });
    await adapter.deleteTimeJson(item.id);
    expect(await adapter.readTimeJson(item.id)).toBeNull();
  });

  test('deleteTimeJson is a no-op if not set', async () => {
    const item = await adapter.create({ value: 'td-noop' });
    await expect(adapter.deleteTimeJson(item.id)).resolves.not.toThrow();
  });
});

// ─── byTag / byType ────────────────────────────────────────────────────────────

describe('byTag / byType', () => {
  test('byTag returns matching item ids', async () => {
    const tag  = `tag-${Date.now()}`;
    const item = await adapter.create({ value: 'tagged-item', tags: [tag] });
    await adapter.create({ value: 'untagged' });
    expect(await adapter.byTag(tag)).toContain(item.id);
    expect((await adapter.byTag(tag))).toHaveLength(1);
  });

  test('byTag returns [] for unused tag', async () => {
    expect(await adapter.byTag('definitely-unused-tag-xyz')).toEqual([]);
  });

  test('byType returns items with matching typeId', async () => {
    const { metadata: t } = await adapter.createType('TagByType', {
      schema: {
        meta: {}, jsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, sqlSchema: [],
      },
    });
    const item = await adapter.create({ value: 'bytype-item', type: 'object', typeId: t.id });
    await adapter.create({ value: 'other' });
    expect(await adapter.byType(t.id)).toContain(item.id);
    expect(await adapter.byType(t.id)).toHaveLength(1);
  });
});

// ─── query ─────────────────────────────────────────────────────────────────────

describe('query', () => {
  test('default limit is 50', async () => {
    const results = await adapter.query({});
    expect(results.length).toBeLessThanOrEqual(50);
  });

  test('explicit limit honoured', async () => {
    // Create enough items that we have at least 3
    for (let i = 0; i < 3; i++) await adapter.create({ value: `ql-item-${i}` });
    expect((await adapter.query({ limit: 2 })).length).toBe(2);
  });

  test('filters by primitive type', async () => {
    const tag = `qtype-${Date.now()}`;
    await adapter.create({ value: 'qtype-fn', type: 'function', tags: [tag] });
    const results = await adapter.query({ type: 'function', limit: 1000 });
    expect(results.every(i => i.type === 'function')).toBe(true);
    expect(results.some(i => i.tags?.includes(tag))).toBe(true);
  });

  test('unknown type warns by default', async () => {
    const results = await adapter.query({ type: 'no-such-type-xyz' });
    expect(results).toHaveLength(0);
    expect(results.warning).toMatch(/unknown type/);
  });

  test('unknown type throws with strictTypes', async () => {
    await expect(adapter.query({ type: 'no-such-type-xyz', strictTypes: true }))
      .rejects.toMatchObject({ name: 'UnknownTypeError' });
  });

  test('excludes soft-deleted items by default', async () => {
    const tag  = `qsd-${Date.now()}`;
    const item = await adapter.create({ value: 'sd-query-excl', tags: [tag] });
    await adapter.softDelete(item.id, OWNER);
    const results = await adapter.query({ limit: 1000 });
    expect(results.some(i => i.id === item.id)).toBe(false);
  });

  test('includeDeleted: true includes soft-deleted items', async () => {
    const tag  = `qsdi-${Date.now()}`;
    const item = await adapter.create({ value: 'sd-query-incl', tags: [tag] });
    await adapter.softDelete(item.id, OWNER);
    const results = await adapter.query({ includeDeleted: true, limit: 1000 });
    expect(results.some(i => i.id === item.id)).toBe(true);
  });

  test('expiredOnly returns only expired items', async () => {
    const past   = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const exp    = await adapter.create({ value: 'exp-item', expiresAt: past });
    const fresh  = await adapter.create({ value: 'fresh-item', expiresAt: future });
    const results = await adapter.query({ expiredOnly: true, limit: 1000 });
    expect(results.some(i => i.id === exp.id)).toBe(true);
    expect(results.some(i => i.id === fresh.id)).toBe(false);
  });

  test('excludeExpired omits items past their expiresAt', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const item = await adapter.create({ value: 'exex-expired', expiresAt: past });
    const results = await adapter.query({ excludeExpired: true, limit: 1000 });
    expect(results.some(i => i.id === item.id)).toBe(false);
  });

  test('rootId scopes results to subtree using path index', async () => {
    const r1 = await adapter.create({ value: 'qroot-r1' });
    const r2 = await adapter.create({ value: 'qroot-r2' });
    const c1 = await adapter.create({ value: `qroot-c1-${Date.now()}`, parentId: r1.id });
    const c2 = await adapter.create({ value: `qroot-c2-${Date.now()}`, parentId: r2.id });
    const results = await adapter.query({ rootId: r1.id, limit: 1000 });
    expect(results.some(i => i.id === c1.id)).toBe(true);
    expect(results.some(i => i.id === c2.id)).toBe(false);
  });
});

// ─── type definitions ──────────────────────────────────────────────────────────

describe('type definitions', () => {
  function makeTypeSchema(tableName, title) {
    return {
      meta: { icon: '', description: '', details: '', keywords: '', tags: '', skills: { claude: '' } },
      jsonSchema: {
        '$schema': 'http://json-schema.org/draft-07/schema#', '$id': '',
        title, type: 'object', properties: { label: { type: 'string' } },
        required: [], additionalProperties: false,
      },
      sqlSchema: [
        `CREATE TABLE "${tableName}" (
           item_id UUID NOT NULL, "label" TEXT,
           CONSTRAINT "pk_${tableName}" PRIMARY KEY (item_id),
           CONSTRAINT "fk_${tableName}_item" FOREIGN KEY (item_id) REFERENCES items(id)
         )`,
      ],
    };
  }

  test('createType returns metadata and schema', async () => {
    const id        = crypto.randomUUID();
    const tableName = `obj_${id.replace(/-/g, '_')}`;
    const { metadata, schema } = await adapter.createType('Widget', { schema: makeTypeSchema(tableName, 'Widget'), id });
    expect(metadata.value).toBe('Widget');
    expect(metadata.id).toBe(id);
    expect(schema.jsonSchema.title).toBe('Widget');
  });

  test('createType creates the obj_<typeId> table', async () => {
    const id        = crypto.randomUUID();
    const tableName = `obj_${id.replace(/-/g, '_')}`;
    await adapter.createType('Gadget', { schema: makeTypeSchema(tableName, 'Gadget'), id });
    const { rows } = await pool.query(`SELECT to_regclass($1) AS reg`, [tableName]);
    expect(rows[0].reg).toBe(tableName);
  });

  test('readTypeJson returns stored schema', async () => {
    const id        = crypto.randomUUID();
    const tableName = `obj_${id.replace(/-/g, '_')}`;
    await adapter.createType('Sprocket', { schema: makeTypeSchema(tableName, 'Sprocket'), id });
    const s = await adapter.readTypeJson(id);
    expect(s.jsonSchema.title).toBe('Sprocket');
  });

  test('writeTypeJson updates schema', async () => {
    const id        = crypto.randomUUID();
    const tableName = `obj_${id.replace(/-/g, '_')}`;
    await adapter.createType('Gizmo', { schema: makeTypeSchema(tableName, 'Gizmo'), id });
    await adapter.writeTypeJson(id, { meta: {}, jsonSchema: { title: 'GizmoV2' } });
    const s = await adapter.readTypeJson(id);
    expect(s.jsonSchema.title).toBe('GizmoV2');
  });

  test('readTypeJson returns null for unknown id', async () => {
    expect(await adapter.readTypeJson('ffffffff-ffff-4fff-bfff-ffffffffffff')).toBeNull();
  });

  test('resolveTypeId classifies primitive / registered / unknown', async () => {
    const id        = crypto.randomUUID();
    const tableName = `obj_${id.replace(/-/g, '_')}`;
    await adapter.createType('ResolveTest', { schema: makeTypeSchema(tableName, 'ResolveTest'), id });
    expect(await adapter.resolveTypeId('text')).toEqual({ primitive: true });
    expect(await adapter.resolveTypeId('ResolveTest')).toEqual({ id });
    expect(await adapter.resolveTypeId('Nonexistent')).toEqual({ unknown: true });
  });
});

// ─── objectData / functionData ─────────────────────────────────────────────────

describe('objectData round-trip', () => {
  let typeId, tableName;

  beforeAll(async () => {
    typeId    = crypto.randomUUID();
    tableName = `obj_${typeId.replace(/-/g, '_')}`;
    await adapter.createType('DataType', {
      schema: {
        meta: {}, jsonSchema: { type: 'object', properties: { label: { type: 'string' }, rank: { type: 'integer' } }, required: [], additionalProperties: false },
        sqlSchema: [
          `CREATE TABLE "${tableName}" (
             item_id UUID NOT NULL, "label" TEXT, "rank" INTEGER,
             CONSTRAINT "pk_${tableName}" PRIMARY KEY (item_id),
             CONSTRAINT "fk_${tableName}_item" FOREIGN KEY (item_id) REFERENCES items(id)
           )`,
        ],
      },
      id: typeId,
    });
  });

  test('readObjectJson returns null when not set', async () => {
    const item = await adapter.create({ value: 'obj-none' });
    expect(await adapter.readObjectJson(item.id, typeId)).toBeNull();
  });

  test('writeObjectJson / readObjectJson round-trips', async () => {
    const item = await adapter.create({ value: 'obj-rw', type: 'object', typeId, objectData: { label: 'hello', rank: 42 } });
    expect(await adapter.readObjectJson(item.id, typeId)).toMatchObject({ label: 'hello', rank: 42 });
  });

  test('objectData passed at create is stored correctly', async () => {
    const item = await adapter.create({ value: 'obj-create', type: 'object', typeId, objectData: { label: 'at-create' } });
    expect(await adapter.readObjectJson(item.id, typeId)).toMatchObject({ label: 'at-create' });
  });
});

describe('functionData round-trip', () => {
  test('readFunctionJson returns null when not set', async () => {
    const item = await adapter.create({ value: 'fn-none', type: 'function' });
    expect(await adapter.readFunctionJson(item.id)).toBeNull();
  });

  test('writeFunctionJson / readFunctionJson round-trips', async () => {
    const item = await adapter.create({ value: 'fn-rw', type: 'function' });
    await adapter.writeFunctionJson(item.id, {
      description: 'does a thing', async: true,
      parameters: [{ name: 'input', type: 'string' }],
      returnType: 'boolean',
    });
    const fn = await adapter.readFunctionJson(item.id);
    expect(fn.description).toBe('does a thing');
    expect(fn.async).toBe(true);
    expect(fn.parameters[0].name).toBe('input');
    expect(fn.returnType).toBe('boolean');
  });

  test('runtime defaults to typescript when not specified', async () => {
    const item = await adapter.create({ value: 'fn-rt-default', type: 'function' });
    await adapter.writeFunctionJson(item.id, { description: 'test' });
    const fn = await adapter.readFunctionJson(item.id);
    expect(fn.runtime).toBe('typescript');
  });

  test('runtime persists when set to typescript', async () => {
    const item = await adapter.create({ value: 'fn-rt-ts', type: 'function' });
    await adapter.writeFunctionJson(item.id, { runtime: 'typescript', description: 'ts fn' });
    const fn = await adapter.readFunctionJson(item.id);
    expect(fn.runtime).toBe('typescript');
  });

  test('runtime persists when set to python', async () => {
    const item = await adapter.create({ value: 'fn-rt-py', type: 'function' });
    await adapter.writeFunctionJson(item.id, { runtime: 'python', description: 'py fn' });
    const fn = await adapter.readFunctionJson(item.id);
    expect(fn.runtime).toBe('python');
  });

  test('runtime can be updated from typescript to python', async () => {
    const item = await adapter.create({ value: 'fn-rt-switch', type: 'function' });
    await adapter.writeFunctionJson(item.id, { runtime: 'typescript' });
    await adapter.writeFunctionJson(item.id, { runtime: 'python' });
    const fn = await adapter.readFunctionJson(item.id);
    expect(fn.runtime).toBe('python');
  });

  test('bundleHash round-trips', async () => {
    const item = await adapter.create({ value: 'fn-bh', type: 'function' });
    const bundleHash = { typescript: 'sha256:abc123', python: 'sha256:def456' };
    await adapter.writeFunctionJson(item.id, { runtime: 'typescript', bundleHash });
    const fn = await adapter.readFunctionJson(item.id);
    expect(fn.bundleHash).toEqual(bundleHash);
  });

  test('bundleHash is null when not set', async () => {
    const item = await adapter.create({ value: 'fn-bh-null', type: 'function' });
    await adapter.writeFunctionJson(item.id, { runtime: 'typescript' });
    const fn = await adapter.readFunctionJson(item.id);
    expect(fn.bundleHash).toBeUndefined();
  });

  test('bundleHash can be updated independently', async () => {
    const item = await adapter.create({ value: 'fn-bh-update', type: 'function' });
    await adapter.writeFunctionJson(item.id, {
      runtime: 'typescript',
      bundleHash: { typescript: 'sha256:v1' },
    });
    await adapter.writeFunctionJson(item.id, {
      runtime: 'typescript',
      bundleHash: { typescript: 'sha256:v2', python: 'sha256:py1' },
    });
    const fn = await adapter.readFunctionJson(item.id);
    expect(fn.bundleHash.typescript).toBe('sha256:v2');
    expect(fn.bundleHash.python).toBe('sha256:py1');
  });

  test('full function payload round-trips with runtime and bundleHash', async () => {
    const item = await adapter.create({ value: 'fn-full', type: 'function' });
    await adapter.writeFunctionJson(item.id, {
      runtime: 'python',
      description: 'Full python function',
      async: false,
      parameters: [
        { name: 'x', type: 'number', description: 'input value' },
        { name: 'label', type: 'string', optional: true },
      ],
      returnType: 'boolean',
      throws: [{ type: 'ValueError', description: 'bad input' }],
      includeKanectaSdk: false,
      dependencies: ['numpy>=1.24'],
      bundleHash: { python: 'sha256:abc' },
    });
    const fn = await adapter.readFunctionJson(item.id);
    expect(fn.runtime).toBe('python');
    expect(fn.description).toBe('Full python function');
    expect(fn.parameters).toHaveLength(2);
    expect(fn.parameters[1].optional).toBe(true);
    expect(fn.returnType).toBe('boolean');
    expect(fn.throws[0].type).toBe('ValueError');
    expect(fn.includeKanectaSdk).toBe(false);
    expect(fn.dependencies).toContain('numpy>=1.24');
    expect(fn.bundleHash.python).toBe('sha256:abc');
  });
});

// ─── rebuildIndexes / checkIntegrity / rebuildPaths ───────────────────────────

describe('rebuildIndexes', () => {
  test('returns item count', async () => {
    const count = await adapter.rebuildIndexes();
    expect(count).toBeGreaterThanOrEqual(5); // at least the well-known nodes
  });

  test('re-populates backlinks after manual delete', async () => {
    const target = await adapter.create({ value: 'rb-target' });
    const linker = await adapter.create({ value: `[[${target.id}]]` });
    await pool.query('DELETE FROM links WHERE source_id = $1', [linker.id]);
    expect(await adapter.backlinks(target.id)).not.toContain(linker.id);
    await adapter.rebuildIndexes();
    expect(await adapter.backlinks(target.id)).toContain(linker.id);
  });
});

describe('checkIntegrity', () => {
  test('returns [] for a clean datastore', async () => {
    const findings = await adapter.checkIntegrity({ checks: ['orphan-type-id'] });
    expect(findings).toEqual([]);
  });

  test('detects orphan-type-id', async () => {
    const item  = await adapter.create({ value: 'orphan-item' });
    const bogus = crypto.randomUUID();
    await pool.query('UPDATE items SET type = $1, type_id = $2 WHERE id = $3', ['object', bogus, item.id]);
    const findings = await adapter.checkIntegrity({ checks: ['orphan-type-id'] });
    expect(findings.some(f => f.check === 'orphan-type-id' && f.nodeId === item.id)).toBe(true);
    // restore
    await pool.query("UPDATE items SET type = 'string', type_id = NULL WHERE id = $1", [item.id]);
  });
});

describe('rebuildPaths', () => {
  test('fixes NULL paths', async () => {
    const item = await adapter.create({ value: 'rp-item' });
    await pool.query('UPDATE items SET path = NULL WHERE id = $1', [item.id]);
    expect(await adapter._getPath(item.id)).toBeNull();
    await adapter.rebuildPaths();
    expect(await adapter._getPath(item.id)).not.toBeNull();
  });
});

// ─── well-known node protection ────────────────────────────────────────────────

describe('well-known node protection', () => {
  test('cannot delete ROOT_ID', async () => {
    await expect(adapter.delete(ROOT_ID, OWNER)).rejects.toThrow(/reserved root node/);
  });

  test('cannot update system_root / app_root / component_root', async () => {
    const kids = await adapter.children(ROOT_ID);
    for (const k of kids) {
      if (['system_root', 'app_root', 'component_root'].includes(k.type)) {
        await expect(adapter.update(k.id, { value: 'x' }, OWNER)).rejects.toThrow(/reserved root node/);
      }
    }
  });

  test('the root node cannot be updated or deleted', async () => {
    await expect(adapter.update(ROOT_ID, { value: 'Org Space' }, OWNER)).rejects.toThrow(/reserved root node/);
    await expect(adapter.delete(ROOT_ID, OWNER)).rejects.toThrow(/reserved root node/);
  });
});

// ─── loadAll ───────────────────────────────────────────────────────────────────

describe('loadAll', () => {
  test('returns all items including well-known nodes', async () => {
    const item = await adapter.create({ value: 'loadall-item' });
    const all  = await adapter.loadAll();
    expect(all.some(i => i.id === ROOT_ID)).toBe(true);
    expect(all.some(i => i.id === item.id)).toBe(true);
  });
});

// ─── createType: obj_<typeId> table + search trigger ──────────────────────────

test('createType attaches FTS trigger to new obj_* table', async () => {
  const id        = crypto.randomUUID();
  const tableName = `obj_${id.replace(/-/g, '_')}`;
  await adapter.createType('Doohickey', {
    schema: {
      meta: {}, jsonSchema: { type: 'object', properties: { label: { type: 'string' } }, required: [], additionalProperties: false },
      sqlSchema: [`CREATE TABLE "${tableName}" (item_id UUID NOT NULL, "label" TEXT, CONSTRAINT "pk_${tableName}" PRIMARY KEY (item_id), CONSTRAINT "fk_${tableName}_item" FOREIGN KEY (item_id) REFERENCES items(id))`],
    },
    id,
  });
  const { rows } = await pool.query(
    `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_object_search_vector' AND tgrelid = $1::regclass`,
    [tableName],
  );
  expect(rows).toHaveLength(1);
});

// ─── Full-text search ─────────────────────────────────────────────────────────

describe('full-text search', () => {
  test('finds items by value and stays in sync on update', async () => {
    const a = await adapter.create({ value: 'the quick brown fox jumps over the lazy dog', type: 'text' });
    const b = await adapter.create({ value: 'foxes are quick and clever animals', type: 'text' });
    await adapter.create({ value: 'completely unrelated content about gardening', type: 'text' });

    let results = await adapter.search('fox', { limit: 10 });
    expect(results.map(r => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));

    await adapter.update(a.id, { value: 'no woodland creatures mentioned here' }, OWNER);
    results = await adapter.search('fox', { limit: 10 });
    expect(results.map(r => r.id)).not.toContain(a.id);
    expect(results.map(r => r.id)).toContain(b.id);
  });

  test('search can be scoped to a subtree via rootId', async () => {
    const branch  = await adapter.create({ value: 'fts-scope-branch' });
    const inside  = await adapter.create({ parentId: branch.id, value: 'needle inside the branch', type: 'text' });
    const outside = await adapter.create({ value: 'needle outside the branch', type: 'text' });
    const scoped  = await adapter.search('needle', { rootId: branch.id, limit: 10 });
    expect(scoped.map(r => r.id)).toContain(inside.id);
    expect(scoped.map(r => r.id)).not.toContain(outside.id);
  });

  test('search indexes object data fields', async () => {
    const id        = crypto.randomUUID();
    const tableName = `obj_${id.replace(/-/g, '_')}`;
    await adapter.createType('Searchable', {
      schema: {
        meta: {}, jsonSchema: { type: 'object', properties: { description: { type: 'string' } }, required: [], additionalProperties: false },
        sqlSchema: [`CREATE TABLE "${tableName}" (item_id UUID NOT NULL, "description" TEXT, CONSTRAINT "pk_${tableName}" PRIMARY KEY (item_id), CONSTRAINT "fk_${tableName}_item" FOREIGN KEY (item_id) REFERENCES items(id))`],
      },
      id,
    });
    const item = await adapter.create({ type: 'object', typeId: id, value: 'widget-fts', objectData: { description: 'uniquely identifiable zorbflange assembly' } });
    const results = await adapter.search('zorbflange', { limit: 10 });
    expect(results.map(r => r.id)).toContain(item.id);
  });
});

// ─── typeId referential integrity ─────────────────────────────────────────────

const ORPHAN_TYPE_ID = 'deadbeef-0000-4000-8000-000000000000';

test('create warns by default and throws under strict for orphan typeId', async () => {
  const item = await adapter.create({ type: 'object', typeId: ORPHAN_TYPE_ID });
  expect(item.warning).toMatch(/has no type definition/);
  await expect(
    adapter.create({ type: 'object', typeId: ORPHAN_TYPE_ID, strict: true }),
  ).rejects.toMatchObject({ name: 'UnknownTypeError', code: 'UNKNOWN_TYPE' });
});

test('update to orphan typeId warns by default and throws under strict', async () => {
  const item   = await adapter.create({ value: 'upd-orphan' });
  const warned = await adapter.update(item.id, { type: 'object', typeId: ORPHAN_TYPE_ID }, OWNER);
  expect(warned.warning).toMatch(/has no type definition/);
  const fresh = await adapter.create({ value: 'upd-orphan-strict' });
  await expect(
    adapter.update(fresh.id, { type: 'object', typeId: ORPHAN_TYPE_ID }, OWNER, { strict: true }),
  ).rejects.toMatchObject({ name: 'UnknownTypeError' });
});

test('checkIntegrity flags orphan-type-id', async () => {
  const id        = crypto.randomUUID();
  const tableName = `obj_${id.replace(/-/g, '_')}`;
  await adapter.createType('IntegChk', {
    schema: {
      meta: {}, jsonSchema: { type: 'object', properties: { label: { type: 'string' } }, required: [], additionalProperties: false },
      sqlSchema: [`CREATE TABLE "${tableName}" (item_id UUID NOT NULL, "label" TEXT, CONSTRAINT "pk_${tableName}" PRIMARY KEY (item_id), CONSTRAINT "fk_${tableName}_item" FOREIGN KEY (item_id) REFERENCES items(id))`],
    },
    id,
  });
  const obj   = await adapter.create({ type: 'object', typeId: id, value: 'integ-obj', objectData: { label: 'x' } });
  const bogus = crypto.randomUUID();
  await pool.query('UPDATE items SET type_id = $1 WHERE id = $2', [bogus, obj.id]);
  const findings = await adapter.checkIntegrity({ checks: ['orphan-type-id'] });
  const f = findings.find(x => x.nodeId === obj.id);
  expect(f).toBeTruthy();
  expect(f.check).toBe('orphan-type-id');
  expect(f.severity).toBe('error');
  await pool.query('UPDATE items SET type_id = $1 WHERE id = $2', [id, obj.id]);
});

// ─── Reciprocal Rank Fusion (pure merge logic — no DB) ───────────────────────

describe('reciprocalRankFusion', () => {
  test('ranks items appearing in multiple lists above single-list items', () => {
    const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, d = { id: 'd' };
    const merged = reciprocalRankFusion([[a, b, d], [c, a]]);
    expect(merged.map(x => x.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  test('returns each distinct item exactly once', () => {
    const a = { id: 'a' }, b = { id: 'b' };
    const merged = reciprocalRankFusion([[a, b], [b, a], [a, b]]);
    expect(merged.map(x => x.id).sort()).toEqual(['a', 'b']);
  });
});

// ─── Semantic / hybrid search ─────────────────────────────────────────────────

describe('semantic / hybrid search', () => {
  let semanticAdapter;

  beforeAll(async () => {
    semanticAdapter = await PostgresAdapter.open(pool, { embeddings: { provider: 'mock', dimensions: 16 } });
  });

  test('embedItem stores a vector and skips re-embedding unchanged content', async () => {
    const item = await semanticAdapter.create({ value: 'photosynthesis converts sunlight into chemical energy' });
    expect(await semanticAdapter.embedItem(item.id)).toBe(true);
    const { rows: first } = await pool.query('SELECT content_hash FROM item_embeddings WHERE item_id = $1', [item.id]);
    expect(first).toHaveLength(1);
    expect(await semanticAdapter.embedItem(item.id)).toBe(false);
    await semanticAdapter.update(item.id, { value: 'mitochondria are the powerhouse of the cell' }, OWNER);
    expect(await semanticAdapter.embedItem(item.id)).toBe(true);
    const { rows: second } = await pool.query('SELECT content_hash FROM item_embeddings WHERE item_id = $1', [item.id]);
    expect(second[0].content_hash).not.toBe(first[0].content_hash);
  });

  test('processPendingEmbeddings drains the queue', async () => {
    const item = await semanticAdapter.create({ value: 'queued for background embedding' });
    const { rows: queued } = await pool.query('SELECT 1 FROM pending_embeddings WHERE item_id = $1', [item.id]);
    expect(queued).toHaveLength(1);
    const result = await semanticAdapter.processPendingEmbeddings({ limit: 100 });
    expect(result.embedded).toBeGreaterThan(0);
    const { rows: remaining } = await pool.query('SELECT 1 FROM pending_embeddings WHERE item_id = $1', [item.id]);
    expect(remaining).toHaveLength(0);
  });

  test('semanticSearch and hybridSearch behave correctly without provider', async () => {
    await expect(adapter.semanticSearch('anything')).rejects.toThrow(/embedding provider/i);
    expect(adapter.embeddingsEnabled).toBe(false);
    const item    = await adapter.create({ value: 'fts-fallback-probe unique phrase' });
    const results = await adapter.hybridSearch('fts-fallback-probe', { limit: 10 });
    expect(results.map(r => r.id)).toContain(item.id);
  });

  test('embeddings.enabled: false keeps generating but disables semantic/hybrid', async () => {
    const pausedAdapter = await PostgresAdapter.open(pool, { embeddings: { provider: 'mock', dimensions: 16, enabled: false } });
    expect(pausedAdapter.embeddingsEnabled).toBe(false);
    const item = await pausedAdapter.create({ value: 'paused-mode embedding probe' });
    expect(await pausedAdapter.embedItem(item.id)).toBe(true);
    await expect(pausedAdapter.semanticSearch('anything')).rejects.toThrow(/disabled/i);
    const results = await pausedAdapter.hybridSearch('paused-mode embedding probe', { limit: 10 });
    expect(results.map(r => r.id)).toContain(item.id);
  });
});
