// Integration tests against a real Postgres instance.
//
// Uses a per-run schema (search_path-scoped) so the kanecta database and its
// data are never touched. Run with:
//
//   docker compose -f docker-compose.test.yml up -d
//   npm test
//
// Or set KANECTA_TEST_PG_URL to point at any Postgres with pgvector enabled.

import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PostgresAdapter, ROOT_ID } from '../src/adapter';
import { reciprocalRankFusion } from '../src/embeddings';

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
  // Tear down the AGE graph (a global namespace, not inside SCHEMA) if one was
  // created. No-op when AGE isn't installed.
  try { await adapter?.dropGraphProjection?.(); } catch { /* ignore */ }
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

  test('the reserved root node is structurally locked', async () => {
    // The root is renamable (see the root-protection suite) but its structural
    // fields stay locked so it remains the self-parented type:'root' anchor.
    await expect(adapter.update(ROOT_ID, { parentId: crypto.randomUUID() }, OWNER))
      .rejects.toThrow(/cannot be changed/);
    await expect(adapter.update(ROOT_ID, { typeId: crypto.randomUUID() }, OWNER))
      .rejects.toThrow(/cannot be changed/);
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

// ─── relationship-type registry cutover (Part 3a: rel_types -> obj_<reltype>) ────

const RELATIONSHIP_TYPE_TYPE_ID = '15861dd7-e54c-4209-bceb-bdd65de4f472';
const RELTYPE_OBJ = `obj_${RELATIONSHIP_TYPE_TYPE_ID.replace(/-/g, '_')}`;

describe('relationship-type registry -> obj_<relationship-type>', () => {
  test('the bespoke rel_types table is gone (dropped by migration 039)', async () => {
    const { rows } = await pool.query(
      `SELECT to_regclass('"${SCHEMA}".rel_types') IS NOT NULL AS has_rel_types`,
    );
    expect(rows[0].has_rel_types).toBe(false);
  });

  test('the 9 canonical relationship-types are seeded as items projecting to obj_<relationship-type>', async () => {
    const { rows } = await pool.query(
      `SELECT i.value FROM items i
        JOIN "${RELTYPE_OBJ}" o ON o.item_id = i.id
       WHERE i.type = 'relationship-type' AND i.deleted_at IS NULL
       ORDER BY i.value`,
    );
    const slugs = rows.map(r => r.value);
    for (const s of ['relates-to', 'depends-on', 'enables', 'contradicts', 'blocks',
      'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes'])
      expect(slugs).toContain(s);
  });

  test('relTypes are sourced from the relationship-type items (not a table)', () => {
    expect(adapter.relTypes).toEqual(expect.arrayContaining(['relates-to', 'depends-on', 'supersedes']));
  });

  test('meta_directional / meta_inverse are wired (depends-on <-> enables)', async () => {
    const { rows } = await pool.query(
      `SELECT i.value, o.meta_directional, o.meta_inverse,
              inv.value AS inverse_value
         FROM items i
         JOIN "${RELTYPE_OBJ}" o   ON o.item_id = i.id
         LEFT JOIN items inv       ON inv.id = o.meta_inverse
        WHERE i.type = 'relationship-type'
          AND i.value IN ('depends-on', 'enables', 'relates-to')`,
    );
    const byName = Object.fromEntries(rows.map(r => [r.value, r]));
    expect(byName['depends-on'].meta_directional).toBe(true);
    expect(byName['depends-on'].inverse_value).toBe('enables');
    expect(byName['enables'].inverse_value).toBe('depends-on');
    expect(byName['relates-to'].meta_directional).toBe(false);
    expect(byName['relates-to'].meta_inverse).toBeNull();
  });

  test('addRelTypes creates a relationship-type item (not a rel_types row)', async () => {
    await adapter.addRelTypes(['influences']);
    const { rows } = await pool.query(
      `SELECT 1 FROM items WHERE type = 'relationship-type' AND value = 'influences' AND deleted_at IS NULL`,
    );
    expect(rows).toHaveLength(1);
    expect(adapter.relTypes).toContain('influences');
  });
});

// ─── relationships-as-items cutover (Part 3b: relationships -> obj_<relationship>) ─

const RELATIONSHIP_TYPE_ID = '334ea5f6-6bfa-43e5-b77f-5d811642d897';
const REL_OBJ = `obj_${RELATIONSHIP_TYPE_ID.replace(/-/g, '_')}`;

describe('relationships -> obj_<relationship>', () => {
  test('the bespoke relationships table is gone (dropped by migration 040)', async () => {
    const { rows } = await pool.query(
      `SELECT to_regclass('"${SCHEMA}".relationships') IS NOT NULL AS has_relationships`,
    );
    expect(rows[0].has_relationships).toBe(false);
  });

  test('relate() creates a relationship item whose payload projects to obj_<relationship>', async () => {
    const a = await adapter.create({ value: 'obj-rel-a' });
    const b = await adapter.create({ value: 'obj-rel-b' });
    const r = await adapter.relate(a.id, 'depends-on', b.id, { note: 'x' });
    // The item exists as a first-class `relationship` item.
    const item = await adapter.get(r.id);
    expect(item.type).toBe('relationship');
    // Its payload row carries the resolved relationship-type UUID + endpoints.
    const { rows } = await pool.query(
      `SELECT o.type_id, o.source_id, o.target_id, o.note, rt.value AS type_slug
         FROM "${REL_OBJ}" o LEFT JOIN items rt ON rt.id = o.type_id
        WHERE o.item_id = $1`, [r.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source_id).toBe(a.id);
    expect(rows[0].target_id).toBe(b.id);
    expect(rows[0].note).toBe('x');
    expect(rows[0].type_slug).toBe('depends-on');   // payload.typeId resolves to the slug
  });

  test('relationships() reads obj_<relationship> (outbound + inbound)', async () => {
    const a = await adapter.create({ value: 'obj-rel2-a' });
    const b = await adapter.create({ value: 'obj-rel2-b' });
    await adapter.relate(a.id, 'blocks', b.id);
    const ra = await adapter.relationships(a.id);
    expect(ra.outbound.map(o => o.targetId)).toContain(b.id);
    expect(ra.outbound.find(o => o.targetId === b.id).type).toBe('blocks');
    const rb = await adapter.relationships(b.id);
    expect(rb.inbound.map(o => o.sourceId)).toContain(a.id);
  });

  test('unrelate() deletes the relationship item and its obj_<relationship> row', async () => {
    const a = await adapter.create({ value: 'obj-unrel-a' });
    const b = await adapter.create({ value: 'obj-unrel-b' });
    const r = await adapter.relate(a.id, 'relates-to', b.id);
    expect(await adapter.unrelate(r.id)).toBe(true);
    expect(await adapter.get(r.id)).toBeNull();
    const { rows } = await pool.query(`SELECT 1 FROM "${REL_OBJ}" WHERE item_id = $1`, [r.id]);
    expect(rows).toHaveLength(0);
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

  test('createType does NOT create the obj_<typeId> table (N=0); the first instance does', async () => {
    const id        = crypto.randomUUID();
    const tableName = `obj_${id.replace(/-/g, '_')}`;
    await adapter.createType('Gadget', { schema: makeTypeSchema(tableName, 'Gadget'), id });
    // A fresh type has no instances, so per the projection invariant no table exists yet.
    const before = await pool.query(`SELECT to_regclass($1) AS reg`, [tableName]);
    expect(before.rows[0].reg).toBeNull();
    // The first live object instance materialises it.
    await adapter.create({ type: 'object', typeId: id, value: 'gadget-1', objectData: { label: 'g' } });
    const after = await pool.query(`SELECT to_regclass($1) AS reg`, [tableName]);
    expect(after.rows[0].reg).toBe(tableName);
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

  // _listTypeDefs is the pg parity of the sqlite-fs method kanecta-api's GraphQL
  // schema builder + /types endpoint call through the Datastore facade — without
  // it a Postgres-backed working set could not build its GraphQL schema.
  test('_listTypeDefs returns {id,value} for every registered type, ordered by value', async () => {
    const id        = crypto.randomUUID();
    const tableName = `obj_${id.replace(/-/g, '_')}`;
    await adapter.createType('ZzzListDefsProbe', { schema: makeTypeSchema(tableName, 'ZzzListDefsProbe'), id });
    const defs = await adapter._listTypeDefs();
    const probe = defs.find((d: any) => d.value === 'ZzzListDefsProbe');
    expect(probe).toEqual({ id, value: 'ZzzListDefsProbe' });
    // Rows carry only id + value.
    expect(Object.keys(probe).sort()).toEqual(['id', 'value']);
    // Ordered by value (Postgres collation) and free of duplicates.
    const values = defs.map((d: any) => d.value);
    expect(values).toEqual([...values].sort((a: string, b: string) => a.localeCompare(b)));
    expect(new Set(values).size).toBe(values.length);
  });
});

// The type registry lives in obj_<type-type>, not a bespoke `types` table (spec
// §cqrs-projections, the four-table law). obj_<type-type> is built from the flat
// seed metaschema (rootPayload.seedMetaschema) because the type-type can't derive
// its own columns from type.json (circular). Migration 038 drops `types`.
describe('type registry cutover (types -> obj_<type-type>)', () => {
  const TYPE_TYPE_ID = 'abbd7b52-92aa-4fca-b458-d9c4e1a60061';
  const TYPE_OBJ     = `obj_${TYPE_TYPE_ID.replace(/-/g, '_')}`;

  test('the bespoke `types` table is dropped', async () => {
    const { rows } = await pool.query(`SELECT to_regclass(current_schema() || '.types') AS reg`);
    expect(rows[0].reg).toBeNull();
  });

  test('obj_<type-type> exists and holds a registry row per built-in type', async () => {
    const reg = await pool.query(`SELECT to_regclass($1) AS reg`, [TYPE_OBJ]);
    expect(reg.rows[0].reg).toBe(TYPE_OBJ);
    // Every seeded built-in type item has an items row AND an obj_<type-type> row.
    const items = await pool.query(`SELECT count(*)::int n FROM items WHERE type = 'type'`);
    const regRows = await pool.query(`SELECT count(*)::int n FROM "${TYPE_OBJ}"`);
    expect(regRows.rows[0].n).toBeGreaterThanOrEqual(40);
    expect(regRows.rows[0].n).toBe(items.rows[0].n);
  });

  test('obj_<type-type> has the flat seed-metaschema columns, not a nested meta blob', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1`, [TYPE_OBJ],
    );
    const cols = rows.map((r) => r.column_name);
    for (const c of ['meta_icon', 'meta_description', 'json_schema', 'sql_schema', 'indexes'])
      expect(cols).toContain(c);
    expect(cols).not.toContain('meta');       // meta is flattened, never a blob column
    expect(cols).not.toContain('table_name'); // table_name is derivable, dropped
  });

  test('the type-type describes itself — its own row is in the registry (self-referential)', async () => {
    const { rows } = await pool.query(`SELECT item_id FROM "${TYPE_OBJ}" WHERE item_id = $1`, [TYPE_TYPE_ID]);
    expect(rows.length).toBe(1);
    const def = await adapter.readTypeJson(TYPE_TYPE_ID);
    expect(def).toBeTruthy();
    expect(def.jsonSchema).toBeTruthy();
  });

  test('rootPayload carries the seed metaschema (self-describing bootstrap)', async () => {
    const ROOT_TYPE_ID = '73068dfc-e56b-4c4b-a8e6-f623f9ad9ab9';
    const objRoot = `obj_${ROOT_TYPE_ID.replace(/-/g, '_')}`;
    const { rows } = await pool.query(`SELECT seed_metaschema FROM "${objRoot}" WHERE item_id = $1`, [ROOT_ID]);
    const seed = rows[0]?.seed_metaschema;
    expect(seed).toBeTruthy();
    expect(seed.title).toBe('typeSeedMetaschema');
    // It describes the flat obj_<type-type> columns — meta_* + json_schema, no meta blob.
    expect(seed.properties.metaIcon).toBeTruthy();
    expect(seed.properties.jsonSchema['x-kanecta-storage']).toBe('json');
  });

  test('a user type created after cutover round-trips through obj_<type-type>', async () => {
    const id = crypto.randomUUID();
    await adapter.createType('CutoverWidget', {
      schema: {
        meta: { icon: 'Star', description: 'post-cutover type', skills: { claude: '' } },
        jsonSchema: {
          '$schema': 'http://json-schema.org/draft-07/schema#', title: 'CutoverWidget',
          type: 'object', properties: { label: { type: 'string' } }, required: [], additionalProperties: false,
        },
        sqlSchema: [],
      },
      id,
    });
    // The definition row lives in obj_<type-type> (not a `types` table, which is gone).
    const inReg = await pool.query(`SELECT meta_description FROM "${TYPE_OBJ}" WHERE item_id = $1`, [id]);
    expect(inReg.rows[0]?.meta_description).toBe('post-cutover type');
    const def = await adapter.readTypeJson(id);
    expect(def.meta.description).toBe('post-cutover type');
    expect(def.jsonSchema.title).toBe('CutoverWidget');
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

  // The Datastore facade calls writeObjectJson(id, data) / readObjectJson(id)
  // with no typeId (as the API's object-write endpoints and connectorEngine do).
  // The adapter must look the typeId up from the item, not treat the payload as
  // the typeId and silently no-op.
  test('writeObjectJson/readObjectJson work without an explicit typeId (facade form)', async () => {
    const item = await adapter.create({ value: 'obj-facade', type: 'object', typeId });
    await adapter.writeObjectJson(item.id, { label: 'via-facade', rank: 7 });
    expect(await adapter.readObjectJson(item.id)).toMatchObject({ label: 'via-facade', rank: 7 });
  });

  test('the (id, typeId, data) form still works (back-compat)', async () => {
    const item = await adapter.create({ value: 'obj-3arg', type: 'object', typeId });
    await adapter.writeObjectJson(item.id, typeId, { label: 'explicit', rank: 9 });
    expect(await adapter.readObjectJson(item.id, typeId)).toMatchObject({ label: 'explicit', rank: 9 });
  });
});

// ─── object payload validation (validateItem enforcement) ───────────────────────

describe('object payload validation', () => {
  let typeId, tableName;

  beforeAll(async () => {
    typeId    = crypto.randomUUID();
    tableName = `obj_${typeId.replace(/-/g, '_')}`;
    await adapter.createType('ValidatedBug', {
      schema: {
        meta: {},
        jsonSchema: {
          type: 'object',
          properties: { severity: { type: 'string' }, count: { type: 'integer' } },
          required: ['severity'], additionalProperties: false,
        },
        sqlSchema: [
          `CREATE TABLE "${tableName}" (
             item_id UUID NOT NULL, "severity" TEXT, "count" INTEGER,
             CONSTRAINT "pk_${tableName}" PRIMARY KEY (item_id),
             CONSTRAINT "fk_${tableName}_item" FOREIGN KEY (item_id) REFERENCES items(id)
           )`,
        ],
      },
      id: typeId,
    });
  });

  test('create() accepts a payload that satisfies the type schema', async () => {
    const item = await adapter.create({ value: 'ok', type: 'object', typeId, objectData: { severity: 'P1', count: 3 } });
    expect(await adapter.readObjectJson(item.id, typeId)).toMatchObject({ severity: 'P1', count: 3 });
  });

  test('create() rejects a payload with a wrong field type', async () => {
    await expect(adapter.create({ value: 'bad-type', type: 'object', typeId, objectData: { severity: 123 } }))
      .rejects.toThrow(/failed validation/i);
  });

  test('create() rejects a payload missing a required field', async () => {
    await expect(adapter.create({ value: 'bad-req', type: 'object', typeId, objectData: { count: 1 } }))
      .rejects.toThrow(/failed validation/i);
  });

  test('a rejected create() leaves no dangling item row', async () => {
    const before = await pool.query(`SELECT count(*)::int AS n FROM items WHERE value = $1`, ['no-dangle']);
    await expect(adapter.create({ value: 'no-dangle', type: 'object', typeId, objectData: { severity: 5 } }))
      .rejects.toThrow(/failed validation/i);
    const after = await pool.query(`SELECT count(*)::int AS n FROM items WHERE value = $1`, ['no-dangle']);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  test('writeObjectJson() rejects an invalid payload (facade form)', async () => {
    const item = await adapter.create({ value: 'shell', type: 'object', typeId, objectData: { severity: 'P1' } });
    await expect(adapter.writeObjectJson(item.id, { severity: 'P2', count: 'lots' }))
      .rejects.toThrow(/failed validation/i);
  });

  test('writeObjectJson() accepts a valid payload', async () => {
    const item = await adapter.create({ value: 'shell2', type: 'object', typeId, objectData: { severity: 'P1' } });
    await adapter.writeObjectJson(item.id, { severity: 'P2', count: 5 });
    expect(await adapter.readObjectJson(item.id, typeId)).toMatchObject({ severity: 'P2', count: 5 });
  });
});

// ─── per-type table projection ──────────────────────────────────────────────

describe('per-type table projection', () => {
  // Person type: scalar, integer, boolean, string-array, plus a declared index.
  async function definePerson() {
    const id = crypto.randomUUID();
    await adapter.createType('Person', {
      id,
      schema: {
        meta: { icon: 'Person' },
        jsonSchema: {
          type: 'object',
          properties: {
            fullName: { type: 'string' },
            age:      { type: 'integer' },
            active:   { type: 'boolean' },
            tags:     { type: 'array', items: { type: 'string' } },
          },
        },
        indexes: [{ fields: ['fullName'] }],
      },
    });
    return { id, table: `obj_${id.replace(/-/g, '_')}` };
  }
  const regclass = async (t) => (await pool.query('SELECT to_regclass($1) AS reg', [t])).rows[0].reg;
  const rowCount = async (t) => (await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;

  test('a type with no instances projects no table', async () => {
    const { table } = await definePerson();
    expect(await regclass(table)).toBeNull();
    expect(await adapter.listProjectedRelations()).not.toContain(table);
  });

  test('the first instance materialises the table; a declared index is created', async () => {
    const { id, table } = await definePerson();
    await adapter.create({ type: 'object', typeId: id, value: 'Ada', objectData: { fullName: 'Ada' } });
    expect(await regclass(table)).toBe(table);
    expect(await adapter.listProjectedRelations()).toContain(table);
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1`, [table]);
    expect(rows.map(r => r.indexname)).toContain(`idx_${table}_full_name`);
  });

  test('integer fields round-trip as JS numbers (BIGINT coercion), booleans and arrays map correctly', async () => {
    const { id } = await definePerson();
    const p = await adapter.create({ type: 'object', typeId: id, value: 'Ada',
      objectData: { fullName: 'Ada', age: 36, active: true, tags: ['math', 'cs'] } });
    const payload = await adapter.readObjectJson(p.id, id);
    expect(payload).toMatchObject({ fullName: 'Ada', age: 36, active: true, tags: ['math', 'cs'] });
    expect(typeof payload.age).toBe('number');
  });

  test('an object instance with no payload still gets a row', async () => {
    const { id, table } = await definePerson();
    await adapter.create({ type: 'object', typeId: id, value: 'blank' });
    expect(await rowCount(table)).toBe(1);
  });

  test('deleting a non-last instance leaves the table; deleting the last drops it', async () => {
    const { id, table } = await definePerson();
    const p1 = await adapter.create({ type: 'object', typeId: id, value: 'Ada',   objectData: { fullName: 'Ada' } });
    const p2 = await adapter.create({ type: 'object', typeId: id, value: 'Grace', objectData: { fullName: 'Grace' } });
    await adapter.delete(p1.id);
    expect(await regclass(table)).toBe(table);
    expect(await rowCount(table)).toBe(1);
    await adapter.delete(p2.id);
    expect(await regclass(table)).toBeNull();
  });

  test('soft-delete of the last instance KEEPS the table and its row (pg payload store); restore works', async () => {
    const { id, table } = await definePerson();
    const p = await adapter.create({ type: 'object', typeId: id, value: 'Ada', objectData: { fullName: 'Ada', age: 36 } });
    await adapter.softDelete(p.id);
    // The row must persist — the obj_ table IS the payload store, so restore can recover it.
    expect(await regclass(table)).toBe(table);
    expect(await rowCount(table)).toBe(1);
    await adapter.restore(p.id);
    expect(await adapter.readObjectJson(p.id, id)).toMatchObject({ fullName: 'Ada', age: 36 });
  });

  test('reassigning an item\'s typeId drops the emptied old table and projects into the new one', async () => {
    const { id: personId, table: personTable } = await definePerson();
    const robotId = crypto.randomUUID();
    const robotTable = `obj_${robotId.replace(/-/g, '_')}`;
    await adapter.createType('Robot', {
      id: robotId,
      schema: { meta: { icon: 'SmartToy' }, jsonSchema: { type: 'object', properties: { model: { type: 'string' } } } },
    });
    const p = await adapter.create({ type: 'object', typeId: personId, value: 'Ada', objectData: { fullName: 'Ada' } });
    expect(await regclass(personTable)).toBe(personTable);
    await adapter.update(p.id, { typeId: robotId }, OWNER);
    expect(await regclass(personTable)).toBeNull();          // emptied → dropped
    expect(await adapter.listProjectedRelations()).toContain(robotTable);
  });

  test('non-object items never project a table', async () => {
    const before = await adapter.listProjectedRelations();
    await adapter.create({ value: 'plain text', type: 'text' });
    expect(await adapter.listProjectedRelations()).toEqual(before);
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

// ─── documentData round-trip ──────────────────────────────────────────────────
// Characterization tests for the document read/write CONTRACT (not the underlying
// documents table). These pin createDocument / readDocumentPayload /
// writeDocumentPayload / listDocuments behaviour so the pending documents-table →
// obj_<document-type> cutover (plans/uniform-projection-modernisation.md #3) can be
// proven to preserve the signatures. Written before the cutover, they must stay
// green through it.
describe('documentData round-trip', () => {
  test('createDocument creates a document item under the document type node', async () => {
    const target = await adapter.create({ value: 'target', type: 'note' });
    const doc = await adapter.createDocument(target.id, 'My Doc', { owner: OWNER });
    expect(doc.type).toBe('document');
    expect(doc.parentId).toBe(PostgresAdapter.DOCUMENT_TYPE_UUID);
    expect(doc.value).toBe('My Doc');
  });

  test('readDocumentPayload round-trips the created payload with defaults applied', async () => {
    const target = await adapter.create({ value: 'target-defaults', type: 'note' });
    const doc = await adapter.createDocument(target.id, 'Defaults Doc', { owner: OWNER });
    const payload = await adapter.readDocumentPayload(doc.id);
    expect(payload.targetId).toBe(target.id);
    expect(payload.name).toBe('Defaults Doc');
    expect(payload.expandState).toEqual({ defaultDepth: 2, exceptions: {} });
    expect(payload.roleMap).toEqual({
      byDepth: { '1': 'heading', '2': 'subheading', '3': 'body' }, byType: {},
    });
    expect(payload.isOrgDefault).toBe(false);
    expect(payload.baseDocumentId).toBeNull();
  });

  test('createDocument honours explicit expandState / roleMap / isOrgDefault / baseDocumentId', async () => {
    const target = await adapter.create({ value: 'target-explicit', type: 'note' });
    const base = await adapter.create({ value: 'base-doc', type: 'note' });
    const expandState = { defaultDepth: 4, exceptions: { [base.id]: 1 } };
    const roleMap = { byDepth: { '1': 'body' }, byType: { [target.id]: 'heading' } };
    const doc = await adapter.createDocument(target.id, 'Explicit Doc', {
      owner: OWNER, expandState, roleMap, isOrgDefault: true, baseDocumentId: base.id,
    });
    const payload = await adapter.readDocumentPayload(doc.id);
    expect(payload.expandState).toEqual(expandState);
    expect(payload.roleMap).toEqual(roleMap);
    expect(payload.isOrgDefault).toBe(true);
    expect(payload.baseDocumentId).toBe(base.id);
  });

  test('readDocumentPayload returns null when the item has no document payload', async () => {
    const item = await adapter.create({ value: 'not-a-doc', type: 'note' });
    expect(await adapter.readDocumentPayload(item.id)).toBeNull();
  });

  test('writeDocumentPayload upserts — a second write replaces the payload', async () => {
    const target = await adapter.create({ value: 'target-upsert', type: 'note' });
    const doc = await adapter.createDocument(target.id, 'Upsert Doc', { owner: OWNER });
    const next = {
      targetId: target.id, name: 'Renamed', isOrgDefault: true, baseDocumentId: null,
      expandState: { defaultDepth: 1, exceptions: {} },
      roleMap: { byDepth: {}, byType: {} },
    };
    await adapter.writeDocumentPayload(doc.id, next);
    expect(await adapter.readDocumentPayload(doc.id)).toEqual(next);
  });

  test('listDocuments returns only documents for the given target, excluding soft-deleted', async () => {
    const targetA = await adapter.create({ value: 'target-A', type: 'note' });
    const targetB = await adapter.create({ value: 'target-B', type: 'note' });
    const d1 = await adapter.createDocument(targetA.id, 'A-1', { owner: OWNER });
    const d2 = await adapter.createDocument(targetA.id, 'A-2', { owner: OWNER });
    await adapter.createDocument(targetB.id, 'B-1', { owner: OWNER });

    const forA = await adapter.listDocuments(targetA.id);
    expect(forA.map((d: any) => d.id).sort()).toEqual([d1.id, d2.id].sort());

    await adapter.softDelete(d2.id);
    const afterDelete = await adapter.listDocuments(targetA.id);
    expect(afterDelete.map((d: any) => d.id)).toEqual([d1.id]);
  });

  test('createDocument requires targetId and name', async () => {
    await expect(adapter.createDocument(null, 'x', { owner: OWNER })).rejects.toThrow(/targetId/);
    const target = await adapter.create({ value: 'target-noname', type: 'note' });
    await expect(adapter.createDocument(target.id, null, { owner: OWNER })).rejects.toThrow(/name/);
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
    await pool.query('DELETE FROM perf_backlinks WHERE source_id = $1', [linker.id]);
    expect(await adapter.backlinks(target.id)).not.toContain(linker.id);
    await adapter.rebuildIndexes();
    expect(await adapter.backlinks(target.id)).toContain(linker.id);
  });
});

describe('checkIntegrity', () => {
  test('returns [] for a clean datastore', async () => {
    // Use an isolated schema: the shared test schema accumulates the orphan
    // objects other tests create, so "clean" must be its own fresh datastore.
    const cleanSchema = `clean_${crypto.randomBytes(4).toString('hex')}`;
    await adminPool.query(`CREATE SCHEMA "${cleanSchema}"`);
    const cleanPool = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path="${cleanSchema}"` });
    try {
      const clean = await PostgresAdapter.init(cleanPool, OWNER);
      const findings = await clean.checkIntegrity({ checks: ['orphan-type-id'] });
      expect(findings).toEqual([]);
    } finally {
      await cleanPool.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${cleanSchema}" CASCADE`);
    }
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

  test('the root node is renamable but cannot be structurally changed or deleted', async () => {
    // A datastore can be given a meaningful name by renaming its root…
    const renamed = await adapter.update(ROOT_ID, { value: 'Org Space' }, OWNER);
    expect(renamed.value).toBe('Org Space');
    // …but its structural identity is locked, and it can never be deleted.
    await expect(adapter.update(ROOT_ID, { type: 'object', typeId: crypto.randomUUID() }, OWNER))
      .rejects.toThrow(/cannot be changed/);
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

test('the first instance materialises the obj_* table with the FTS trigger', async () => {
  const id        = crypto.randomUUID();
  const tableName = `obj_${id.replace(/-/g, '_')}`;
  await adapter.createType('Doohickey', {
    schema: {
      meta: {}, jsonSchema: { type: 'object', properties: { label: { type: 'string' } }, required: [], additionalProperties: false },
    },
    id,
  });
  await adapter.create({ type: 'object', typeId: id, value: 'doohickey-1', objectData: { label: 'd' } });
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
    // Isolated schema: the shared schema accumulates 100s of queued items from
    // other tests, so this item (newest) may fall outside any single batch.
    const s = `emb_${crypto.randomBytes(4).toString('hex')}`;
    await adminPool.query(`CREATE SCHEMA "${s}"`);
    const p = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path="${s}"` });
    try {
      await PostgresAdapter.init(p, OWNER);
      const emb = await PostgresAdapter.open(p, { embeddings: { provider: 'mock', dimensions: 16 } });
      const item = await emb.create({ value: 'queued for background embedding' });
      expect((await p.query('SELECT 1 FROM perf_embedding_queue WHERE item_id = $1', [item.id])).rows).toHaveLength(1);
      const result = await emb.processPendingEmbeddings({ limit: 100 });
      expect(result.embedded).toBeGreaterThan(0);
      const { rows: remaining } = await p.query('SELECT 1 FROM perf_embedding_queue WHERE item_id = $1', [item.id]);
      expect(remaining).toHaveLength(0);
    } finally {
      await p.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
    }
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

  test('listDueSchedules returns active schedules due at/before the cutoff (regression: rowToItem)', async () => {
    const due    = await adapter.create({ type: 'schedule', status: 'active', value: 'due',    dueAt: '2020-01-01T00:00:00.000Z' });
    const notYet = await adapter.create({ type: 'schedule', status: 'active', value: 'notYet', dueAt: '2999-01-01T00:00:00.000Z' });
    const paused = await adapter.create({ type: 'schedule', status: 'paused', value: 'paused', dueAt: '2020-01-01T00:00:00.000Z' });

    // Previously threw `this.rowToItem is not a function` whenever rows came back.
    const ids = (await adapter.listDueSchedules('2025-01-01T00:00:00.000Z')).map((r) => r.id);

    expect(ids).toContain(due.id);
    expect(ids).not.toContain(notYet.id);   // future due date
    expect(ids).not.toContain(paused.id);   // not active
  });
});

// ─── Graph projection (Apache AGE) ──────────────────────────────────────────────
//
// Gated on KANECTA_TEST_AGE=1 because the projection needs the Apache AGE
// extension, which the default test Postgres (and CI) does not have. Run with:
//
//   KANECTA_TEST_AGE=1 KANECTA_TEST_PG_URL=postgres://kanecta:kanecta@localhost:45434/kanecta npm test
//
// (localhost:45434 is a postgres:18 image with both pgvector and AGE installed.)
const AGE_ENABLED = process.env.KANECTA_TEST_AGE === '1';

describe.skipIf(!AGE_ENABLED)('graph projection (AGE)', () => {
  test('AGE is detected as enabled', async () => {
    // Force a probe via any graph op.
    await adapter.countProjectedGraphEdges();
    expect(adapter.graphEnabled).toBe(true);
  });

  test('relate() projects an edge; graphNeighbors traverses it', async () => {
    const a = await adapter.create({ value: 'g-a' });
    const b = await adapter.create({ value: 'g-b' });
    await adapter.relate(a.id, 'depends-on', b.id);

    const out = await adapter.graphNeighbors(a.id, { direction: 'out' });
    expect(out).toContain(b.id);

    const inn = await adapter.graphNeighbors(b.id, { direction: 'in' });
    expect(inn).toContain(a.id);

    // Wrong direction / wrong type find nothing.
    expect(await adapter.graphNeighbors(a.id, { direction: 'in' })).not.toContain(b.id);
    expect(await adapter.graphNeighbors(a.id, { direction: 'out', relType: 'blocks' })).not.toContain(b.id);
  });

  test('graphNeighbors can filter by relationship type', async () => {
    const a = await adapter.create({ value: 'g-f-a' });
    const b = await adapter.create({ value: 'g-f-b' });
    const c = await adapter.create({ value: 'g-f-c' });
    await adapter.relate(a.id, 'depends-on', b.id);
    await adapter.relate(a.id, 'blocks', c.id);

    const dep = await adapter.graphNeighbors(a.id, { relType: 'depends-on' });
    expect(dep).toContain(b.id);
    expect(dep).not.toContain(c.id);
  });

  test('unrelate() retracts the edge', async () => {
    const a = await adapter.create({ value: 'g-u-a' });
    const b = await adapter.create({ value: 'g-u-b' });
    const rel = await adapter.relate(a.id, 'relates-to', b.id);
    expect(await adapter.graphNeighbors(a.id)).toContain(b.id);

    const removed = await adapter.unrelate(rel.id);
    expect(removed).toBe(true);
    expect(await adapter.graphNeighbors(a.id)).not.toContain(b.id);
  });

  test('rebuildGraphProjection reconstructs edges from obj_<relationship>', async () => {
    const a = await adapter.create({ value: 'g-r-a' });
    const b = await adapter.create({ value: 'g-r-b' });
    await adapter.relate(a.id, 'enables', b.id);

    const summary = await adapter.rebuildGraphProjection();
    expect(summary.rebuilt).toBe(true);
    // Every relationship item is mirrored as exactly one edge.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM items WHERE type = 'relationship' AND deleted_at IS NULL`,
    );
    expect(await adapter.countProjectedGraphEdges()).toBe(rows[0].n);
    // The rebuilt graph still answers traversals.
    expect(await adapter.graphNeighbors(a.id, { relType: 'enables' })).toContain(b.id);
  });
});

// ─── Structured built-in projection (four-table law) ─────────────────────────────

describe('structured built-in projection', () => {
  const GRANT_TYPE_ID = '89138971-cd16-4c7a-b4cd-669711bfab75';
  const grantTable = `obj_${GRANT_TYPE_ID.replace(/-/g, '_')}`;

  test('the grant type definition is seeded (readTypeJson resolves its jsonSchema)', async () => {
    const def = await adapter.readTypeJson(GRANT_TYPE_ID);
    expect(def?.jsonSchema?.title).toBe('grantPayload');
  });

  test('a grant instance projects to obj_<grant-type> with typed columns', async () => {
    const governed = await adapter.create({ value: 'governed-doc' });
    const grant = await adapter.create({
      type: 'grant',
      value: 'grant',
      objectData: {
        governedItemId: governed.id,
        principal: 'alice@example.com',
        permissions: ['read', 'write'],
        cascade: false,
      },
    });

    // The instance carries the grant type's fixed UUID (the projection key) —
    // NOT type='object'. This is the four-table law: a built-in is an ordinary
    // type projected to obj_<typeId>.
    expect(grant.type).toBe('grant');
    expect(grant.typeId).toBe(GRANT_TYPE_ID);

    // Payload round-trips through the projected table's typed columns.
    const payload = await adapter.readObjectJson(grant.id, GRANT_TYPE_ID);
    expect(payload.governedItemId).toBe(governed.id);
    expect(payload.principal).toBe('alice@example.com');
    expect(payload.permissions).toEqual(['read', 'write']);
    expect(payload.cascade).toBe(false);

    // The exact read contract PgAuthzSource.grantsFor() depends on: typed
    // columns on obj_<grant-type>, joined to items, filtered by governed_item_id.
    const { rows } = await pool.query(
      `SELECT g.principal, g.permissions, g.cascade
         FROM "${grantTable}" g JOIN items i ON i.id = g.item_id
        WHERE g.governed_item_id = $1 AND i.deleted_at IS NULL`,
      [governed.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].principal).toBe('alice@example.com');
    expect(rows[0].permissions).toEqual(['read', 'write']);
    expect(rows[0].cascade).toBe(false);
  });

  test('an invalid grant payload is rejected before the item row is written', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM items')).rows[0].n;
    await expect(adapter.create({
      type: 'grant', value: 'grant',
      objectData: { governedItemId: crypto.randomUUID(), principal: 'x' }, // missing permissions
    })).rejects.toThrow(/validation|permissions/i);
    const after = (await pool.query('SELECT count(*)::int AS n FROM items')).rows[0].n;
    expect(after).toBe(before);
  });
});

describe('structured built-in projection (query + query-param children)', () => {
  const QUERY_TYPE_ID = '1c23396d-c3a0-4f51-9307-a1aecd1f44fa';
  const QUERY_PARAM_TYPE_ID = '82a025d4-a862-434a-9e56-68657814af0f';
  test('a query projects (no inline params); its params are query-param children', async () => {
    const q = await adapter.create({
      type: 'query', value: 'tasks-by-assignee',
      objectData: { language: 'kanecta', expression: 'type:task assignee:{{params.assignee}}' },
    });
    expect(q.typeId).toBe(QUERY_TYPE_ID);
    const p = await adapter.readObjectJson(q.id, QUERY_TYPE_ID);
    expect(p.expression).toBe('type:task assignee:{{params.assignee}}');
    expect('params' in p).toBe(false);   // normalised out — params are children

    const param = await adapter.create({
      type: 'query-param', value: 'assignee', parentId: q.id,
      objectData: { name: 'assignee', type: 'string', description: 'Who the task is assigned to' },
    });
    expect(param.typeId).toBe(QUERY_PARAM_TYPE_ID);
    expect(param.parentId).toBe(q.id);
    const pp = await adapter.readObjectJson(param.id, QUERY_PARAM_TYPE_ID);
    expect(pp.name).toBe('assignee');
    expect(pp.type).toBe('string');
  });
});

// ─── Schema-change guard (fail-closed migration protection) ──────────────────────

describe('schema-change guard', () => {
  test('init throws on a fresh schema when KANECTA_ALLOW_SCHEMA_CHANGES is unset', async () => {
    const guardSchema = `kanecta_guard_${crypto.randomBytes(4).toString('hex')}`;
    await adminPool.query(`CREATE SCHEMA "${guardSchema}"`);
    const gPool = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path="${guardSchema}"` });
    const saved = process.env.KANECTA_ALLOW_SCHEMA_CHANGES;
    try {
      delete process.env.KANECTA_ALLOW_SCHEMA_CHANGES;
      await expect(PostgresAdapter.init(gPool, OWNER))
        .rejects.toThrow(/Refusing to apply .* pending schema migration/);
      // With the flag set, the same init succeeds and applies migrations.
      process.env.KANECTA_ALLOW_SCHEMA_CHANGES = '1';
      const ok = await PostgresAdapter.init(gPool, OWNER);
      expect((await ok.getRoot()).type).toBe('root');
    } finally {
      if (saved === undefined) delete process.env.KANECTA_ALLOW_SCHEMA_CHANGES;
      else process.env.KANECTA_ALLOW_SCHEMA_CHANGES = saved;
      await gPool.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${guardSchema}" CASCADE`);
    }
  });
});

describe('structured built-in projection (reference, file)', () => {
  const REFERENCE_TYPE_ID = 'cb120719-5a23-4b4f-b614-898f79f1904f';
  const FILE_TYPE_ID = 'c0f603f1-a3ac-4a7d-b9ac-983822c7304f';

  test('a reference instance projects to obj_<reference-type> and round-trips', async () => {
    const target = await adapter.create({ value: 'ref-target' });
    const ref = await adapter.create({
      type: 'reference', value: 'external-fk',
      objectData: { targetId: target.id, kind: 'external-system', description: 'FK held in another DB', blockDeletion: true },
    });
    expect(ref.type).toBe('reference');
    expect(ref.typeId).toBe(REFERENCE_TYPE_ID);
    const payload = await adapter.readObjectJson(ref.id, REFERENCE_TYPE_ID);
    expect(payload.targetId).toBe(target.id);
    expect(payload.kind).toBe('external-system');
    expect(payload.blockDeletion).toBe(true);
  });

  test('a file instance projects to obj_<file-type> (metadata; bytes live in S3/sidecar)', async () => {
    const f = await adapter.create({
      type: 'file', value: 'photo.jpg',
      objectData: { mimeType: 'image/jpeg', size: 20481, width: 1024, height: 768, altText: 'A photo' },
    });
    expect(f.type).toBe('file');
    expect(f.typeId).toBe(FILE_TYPE_ID);
    const payload = await adapter.readObjectJson(f.id, FILE_TYPE_ID);
    expect(payload.mimeType).toBe('image/jpeg');
    expect(payload.size).toBe(20481);
    expect(payload.width).toBe(1024);
  });
});

describe('structured built-in projection (formula, context, cell)', () => {
  const cases = [
    { type: 'formula', id: 'd605ed1b-2c53-44a0-b4ac-3a307b61e82a',
      data: { level: 'template', expression: 'TASK-{n}' }, check: (p: any) => expect(p.expression).toBe('TASK-{n}') },
    { type: 'context', id: 'bd48218a-1c21-4c8e-ac0e-9ea026f2cf4d',
      data: { runtime: 'web', display: 'detail-panel', capabilities: ['react', 'css'] },
      check: (p: any) => { expect(p.runtime).toBe('web'); expect(p.capabilities).toEqual(['react', 'css']); } },
    { type: 'cell', id: '42561614-32d6-4c01-93c8-2f6e023ad19f',
      data: { row: 3, column: 'B' }, check: (p: any) => { expect(p.row).toBe(3); expect(p.column).toBe('B'); } },
  ];
  for (const c of cases) {
    test(`a ${c.type} instance projects to obj_<${c.type}-type> and round-trips`, async () => {
      const item = await adapter.create({ type: c.type, value: c.type, objectData: c.data });
      expect(item.type).toBe(c.type);
      expect(item.typeId).toBe(c.id);
      c.check(await adapter.readObjectJson(item.id, c.id));
    });
  }
});

describe('structured built-in projection (view)', () => {
  const VIEW_TYPE_ID = 'cfba24ea-be40-46ba-b4db-e15a55af4392';
  test('a view instance projects to obj_<view-type>; viewedItemId does not collide with item_id', async () => {
    const [viewed, comp, ctx] = await Promise.all([
      adapter.create({ value: 'viewed' }), adapter.create({ value: 'comp' }), adapter.create({ value: 'ctx' }),
    ]);
    const view = await adapter.create({
      type: 'view', value: 'compact-card',
      objectData: { viewedItemId: viewed.id, componentId: comp.id, contextId: ctx.id },
    });
    expect(view.type).toBe('view');
    expect(view.typeId).toBe(VIEW_TYPE_ID);
    const payload = await adapter.readObjectJson(view.id, VIEW_TYPE_ID);
    expect(payload.viewedItemId).toBe(viewed.id);   // the viewed item, stored in viewed_item_id
    expect(view.id).not.toBe(viewed.id);            // the row's item_id is the VIEW item, distinct
  });
});

describe('annotation + licence are seeded structured types', () => {
  test('their type definitions resolve via readTypeJson', async () => {
    const ann = await adapter.readTypeJson('235d6155-db2a-4232-9548-8f5a66150d82');
    expect(ann?.jsonSchema?.title).toBe('annotationPayload');
    const lic = await adapter.readTypeJson('9798b629-06f4-495f-90e8-2d70f817466e');
    expect(lic?.jsonSchema?.title).toBe('licencePayload');
  });
});

describe('licence cutover — licences are items projecting to obj_<licence-type>', () => {
  const LICENCE_TYPE_ID = '9798b629-06f4-495f-90e8-2d70f817466e';
  const DEFAULT_LICENCE = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739';
  const OBJ_LICENCE     = `obj_${LICENCE_TYPE_ID.replace(/-/g, '_')}`;

  test('the bespoke licences table is gone (four-table law)', async () => {
    const { rows } = await pool.query("SELECT to_regclass('licences') AS t");
    expect(rows[0].t).toBeNull();
  });

  test('all 19 built-in licences are seeded as licence items projecting to obj_licence', async () => {
    const { rows: n }    = await pool.query("SELECT COUNT(*)::int AS n FROM items WHERE type = 'licence'");
    expect(n[0].n).toBe(19);
    const { rows: proj } = await pool.query(`SELECT COUNT(*)::int AS n FROM "${OBJ_LICENCE}"`);
    expect(proj[0].n).toBe(19);
  });

  test('the default licence is reparented under the licence type and projects its payload', async () => {
    const def = await adapter.get(DEFAULT_LICENCE);
    expect(def.type).toBe('licence');
    expect(def.parentId).toBe(LICENCE_TYPE_ID);      // out of the self-parented bootstrap state
    const payload = await adapter.readObjectJson(DEFAULT_LICENCE, LICENCE_TYPE_ID);
    expect(payload.name).toBe('All Rights Reserved (Copyright)');
    expect(payload.spdxId).toBeNull();
  });

  test('an spdx licence projects its identity (GPL-3.0)', async () => {
    const payload = await adapter.readObjectJson('6af82527-a086-4596-a07f-84ca3cad2277', LICENCE_TYPE_ID);
    expect(payload.spdxId).toBe('GPL-3.0-only');
    expect(payload.url).toBe('https://www.gnu.org/licenses/gpl-3.0.html');
  });

  test('items.license now references items(id): a new item resolves to the default licence item', async () => {
    const it = await adapter.create({ value: 'licensed thing', type: 'note' });
    const { rows } = await pool.query('SELECT license FROM items WHERE id = $1', [it.id]);
    expect(rows[0].license).toBe(DEFAULT_LICENCE);
    const lic = await adapter.get(rows[0].license);   // FK target is a real licence item
    expect(lic.type).toBe('licence');
  });
});

describe('config cutover — datastore config lives in rootPayload (obj_<root>)', () => {
  const ROOT_TYPE_ID = '73068dfc-e56b-4c4b-a8e6-f623f9ad9ab9';
  const OBJ_ROOT     = `obj_${ROOT_TYPE_ID.replace(/-/g, '_')}`;

  test('the bespoke config table is gone (four-table law)', async () => {
    const { rows } = await pool.query("SELECT to_regclass('config') AS t");
    expect(rows[0].t).toBeNull();
  });

  test('the root item projects its config payload to obj_<root>', async () => {
    const { rows } = await pool.query(
      `SELECT owner, spec_version, item_history, activity FROM "${OBJ_ROOT}" WHERE item_id = $1`,
      [ROOT_ID],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].owner).toBe(OWNER);
    expect(rows[0].spec_version).toBe('1.4.0');
    expect(rows[0].item_history).toBe('EXTERNAL');
    expect(rows[0].activity).toBe('EXTERNAL');
  });

  test('adapter.config resolves owner + spec_version from rootPayload', async () => {
    expect(adapter.config.owner).toBe(OWNER);
    expect(adapter.config.spec_version).toBe('1.4.0');
  });

  test('open() reads config back from obj_<root> (no config table)', async () => {
    const reopened = await PostgresAdapter.open(pool);
    expect(reopened.config.owner).toBe(OWNER);
    expect(reopened.config.spec_version).toBe('1.4.0');
  });
});

describe('structured built-in projection (subscription + channel, normalised)', () => {
  const CHANNEL_TYPE_ID = 'b4e15597-5a90-4e40-bed0-dbb28a9165a9';
  const SUB_TYPE_ID = 'cf066390-a599-4dbe-bc20-491de885cb18';
  test('a channel projects, and a subscription references it via channelId (no inline object)', async () => {
    const watched = await adapter.create({ value: 'watched-item' });
    const channel = await adapter.create({
      type: 'channel', value: 'my-webhook',
      objectData: { type: 'webhook', url: 'https://example.test/hook', secret: '$HOOK' },
    });
    expect(channel.typeId).toBe(CHANNEL_TYPE_ID);
    expect((await adapter.readObjectJson(channel.id, CHANNEL_TYPE_ID)).url).toBe('https://example.test/hook');

    const sub = await adapter.create({
      type: 'subscription', value: 'watch',
      objectData: { targetId: watched.id, channelId: channel.id, events: ['update', 'delete'], recursive: true },
    });
    expect(sub.typeId).toBe(SUB_TYPE_ID);
    const p = await adapter.readObjectJson(sub.id, SUB_TYPE_ID);
    expect(p.channelId).toBe(channel.id);      // normalised reference, not an inline object
    expect(p.events).toEqual(['update', 'delete']);
    expect(p.recursive).toBe(true);            // nullable-union boolean -> real BOOLEAN column
  });
});

describe('structured built-in projection (aspect-type, genuine-JSON field)', () => {
  const ASPECT_TYPE_TYPE_ID = '45bc6fbe-aa63-41be-8566-7217a9a15ece';
  test('aspect-type projects with jsonSchema stored as a JSON column (round-trips)', async () => {
    const schema = { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] };
    const at = await adapter.create({
      type: 'aspect-type', value: 'financial-costs',
      objectData: { jsonSchema: schema, description: 'Cost breakdown dimension' },
    });
    expect(at.typeId).toBe(ASPECT_TYPE_TYPE_ID);
    const p = await adapter.readObjectJson(at.id, ASPECT_TYPE_TYPE_ID);
    expect(p.description).toBe('Cost breakdown dimension');
    expect(p.jsonSchema).toEqual(schema);   // full JSON document round-trips through JSONB
  });
});

describe('structured built-in projection (agent + per-runtime config, normalised)', () => {
  const AGENT_TYPE_ID = 'e5d3fad0-5123-46cc-a827-80954f7f96b2';
  const CLAUDE_API_CFG = 'fe57b551-b0d8-4e49-b720-d858557bd571';
  const GROUP_CHAT_CFG = 'f94eaf19-b880-403f-8d93-bed168308efe';

  test('an agent references its runtime config by configId (a normalised per-runtime type)', async () => {
    const cfg = await adapter.create({
      type: 'claude-api-config', value: 'default-sampling',
      objectData: { maxTokens: 4096, temperature: 0.7, topP: 0.95 },
    });
    expect(cfg.typeId).toBe(CLAUDE_API_CFG);
    expect((await adapter.readObjectJson(cfg.id, CLAUDE_API_CFG)).maxTokens).toBe(4096);

    const agent = await adapter.create({
      type: 'agent', value: 'auditor',
      objectData: { runtime: 'claude-api', model: 'claude-opus-4-8', tools: ['kanecta_query'], configId: cfg.id },
    });
    expect(agent.typeId).toBe(AGENT_TYPE_ID);
    const p = await adapter.readObjectJson(agent.id, AGENT_TYPE_ID);
    expect(p.runtime).toBe('claude-api');
    expect(p.configId).toBe(cfg.id);           // normalised reference, not an inline config object
    expect(p.tools).toEqual(['kanecta_query']);
  });

  test('group-chat-config normalises participants to a UUID[] of agent refs', async () => {
    const [a1, a2] = await Promise.all([
      adapter.create({ type: 'agent', value: 'panelist-1', objectData: { runtime: 'claude-api' } }),
      adapter.create({ type: 'agent', value: 'panelist-2', objectData: { runtime: 'claude-api' } }),
    ]);
    const gc = await adapter.create({
      type: 'group-chat-config', value: 'panel',
      objectData: { participants: [a1.id, a2.id], maxTurns: 8, terminationCondition: 'max-turns' },
    });
    expect(gc.typeId).toBe(GROUP_CHAT_CFG);
    expect((await adapter.readObjectJson(gc.id, GROUP_CHAT_CFG)).participants).toEqual([a1.id, a2.id]);
  });
});

describe('structured built-in projection (action, params normalised out)', () => {
  const ACTION_TYPE_ID = '1ab2a990-c2cf-4b91-aace-588c66b0a78b';
  test('action projects with no inline params object (defaults are property children)', async () => {
    const pipeline = await adapter.create({ value: 'summarise-pipeline' });
    const action = await adapter.create({
      type: 'action', value: 'Summarise',
      objectData: { pipelineId: pipeline.id, targetTypes: ['task', 'note'], icon: 'AutoAwesome' },
    });
    expect(action.typeId).toBe(ACTION_TYPE_ID);
    const p = await adapter.readObjectJson(action.id, ACTION_TYPE_ID);
    expect(p.pipelineId).toBe(pipeline.id);
    expect(p.targetTypes).toEqual(['task', 'note']);
    expect('params' in p).toBe(false);   // no inline params column — normalised to property children
  });
});

describe('structured built-in projection (component + parameter children)', () => {
  const COMPONENT_TYPE_ID = 'fab55d91-6975-422a-9398-2b16f72bc805';
  const PARAMETER_TYPE_ID = 'e19f06be-5f2c-4bef-ae1f-7885832b1a90';
  test('component projects with no inline props/bundleHash; props are parameter children', async () => {
    const c = await adapter.create({
      type: 'component', value: 'PersonCard',
      objectData: { target: 'react', description: 'Compact person card', dependencies: ['date-fns'] },
    });
    expect(c.typeId).toBe(COMPONENT_TYPE_ID);
    const p = await adapter.readObjectJson(c.id, COMPONENT_TYPE_ID);
    expect(p.target).toBe('react');
    expect(p.dependencies).toEqual(['date-fns']);
    expect('props' in p).toBe(false);
    expect('bundleHash' in p).toBe(false);

    const prop = await adapter.create({
      type: 'parameter', value: 'personId', parentId: c.id, sortOrder: 0,
      objectData: { name: 'personId', type: 'string', optional: false },
    });
    expect(prop.typeId).toBe(PARAMETER_TYPE_ID);
    expect(prop.parentId).toBe(c.id);
    expect((await adapter.readObjectJson(prop.id, PARAMETER_TYPE_ID)).name).toBe('personId');
  });
});

// ─── Universal transactions (atomic multi-op writes) ──────────────────────────

describe('transactions', () => {
  test('transaction(fn) commits every op together', async () => {
    let aId, bId;
    await adapter.transaction(async (tx) => {
      const a = await tx.create({ value: 'tx-commit-a' });
      const b = await tx.create({ value: 'tx-commit-b', parentId: a.id });
      aId = a.id; bId = b.id;
    });
    // Both survive the commit, and the second's parent link to the first held.
    expect((await adapter.get(aId))?.value).toBe('tx-commit-a');
    const b = await adapter.get(bId);
    expect(b?.value).toBe('tx-commit-b');
    expect(b?.parentId).toBe(aId);
  });

  test('a throw mid-transaction rolls back ALL ops (no partial write)', async () => {
    let aId;
    await expect(
      adapter.transaction(async (tx) => {
        const a = await tx.create({ value: 'tx-rollback-a' });
        aId = a.id;
        // Second op fails — the whole transaction must unwind, including op 1.
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(aId).toBeTruthy();
    expect(await adapter.get(aId)).toBeNull();
  });

  test('the return value of transaction(fn) is fn\'s result', async () => {
    const out = await adapter.transaction(async (tx) => {
      const a = await tx.create({ value: 'tx-return' });
      return a.id;
    });
    expect(typeof out).toBe('string');
    expect((await adapter.get(out))?.value).toBe('tx-return');
  });

  test('client-supplied id lets a later op reference an item created earlier', async () => {
    const parentId = crypto.randomUUID();
    let childId;
    await adapter.transaction(async (tx) => {
      await tx.create({ id: parentId, value: 'tx-parent' });
      const child = await tx.create({ value: 'tx-child', parentId });
      childId = child.id;
    });
    expect((await adapter.get(parentId))?.value).toBe('tx-parent');
    expect((await adapter.get(childId))?.parentId).toBe(parentId);
  });

  // Level 1 — per-write atomicity. Force a failure AFTER the `items` row is
  // inserted (in `_snapshot`, which `_createImpl` calls once the row exists) and
  // assert the create left NO orphan `items` row behind — i.e. each single write
  // is itself all-or-nothing, not just multi-op transactions.
  test('crash mid-create leaves no orphan items row (per-write atomicity)', async () => {
    const orig = adapter._snapshot.bind(adapter);
    let attemptedId;
    adapter._snapshot = async (idOrItem, ...rest) => {
      // Remember the id we were about to snapshot, then blow up.
      attemptedId = typeof idOrItem === 'string' ? idOrItem : idOrItem?.id;
      throw new Error('injected crash after items insert');
    };
    try {
      await expect(adapter.create({ value: 'orphan-check' })).rejects.toThrow('injected crash');
    } finally {
      adapter._snapshot = orig;
    }
    expect(attemptedId).toBeTruthy();
    // The items INSERT ran before the crash; rollback must have removed it.
    const { rows } = await pool.query('SELECT id FROM items WHERE id = $1', [attemptedId]);
    expect(rows).toHaveLength(0);
  });

  // Regression (#3): a transaction that fails on a REAL Postgres error leaves the
  // connection mid-transaction (aborted). `_withTx` must ROLLBACK and hand the
  // pool a usable connection — never a poisoned one, or the NEXT caller gets
  // "current transaction is aborted, commands ignored until end of transaction
  // block". A single-connection pool makes the leak observable: the same
  // connection is reused, so a poisoned one would fail the very next query.
  test('a failed transaction does not poison the pooled connection (single-conn pool)', async () => {
    const soloPool = new Pool({
      connectionString: CONNECTION_STRING,
      options: `-c search_path="${SCHEMA}"`,
      max: 1, // exactly one connection — reused across requests, so poisoning shows
    });
    const solo = await PostgresAdapter.open(soloPool);
    try {
      // Force a genuine DB-level failure INSIDE the transaction so the tx enters
      // the aborted state (a plain JS throw before any SQL wouldn't reproduce it).
      let startedId;
      await expect(
        solo.transaction(async (tx) => {
          const a = await tx.create({ value: 'poison-check-a' });
          startedId = a.id;
          await tx._exec('SELECT * FROM a_table_that_does_not_exist_xyz');
        }),
      ).rejects.toThrow(/does not exist/i);

      // The SAME single connection is now back in the pool. If it were still
      // aborted, this would throw "current transaction is aborted…". It must not.
      const after = await solo.create({ value: 'poison-check-after' });
      expect(after.id).toBeTruthy();
      expect((await solo.get(after.id))?.value).toBe('poison-check-after');

      // And the failed transaction rolled back cleanly — the create it started
      // before the DB error must have unwound (no partial write survived).
      expect(startedId).toBeTruthy();
      expect(await solo.get(startedId)).toBeNull();
    } finally {
      await soloPool.end();
    }
  });

  // Regression (#3), discard path: if the tx is aborted AND the ROLLBACK meant to
  // reset it can't run (a genuinely broken connection), `_withTx` must DISCARD the
  // connection — `client.release(err)` with a truthy arg tells pg to destroy it —
  // rather than recycle a poisoned one back into the pool. Driven with a stub pool
  // so the "ROLLBACK fails" case is exercised deterministically without a real
  // network fault.
  test('a failed transaction whose ROLLBACK also fails discards the connection (release with error)', async () => {
    const queries: string[] = [];
    let releasedWith: any = 'NOT_RELEASED';
    const fakeClient = {
      query: (text: any) => {
        const sql = String(text);
        queries.push(sql);
        if (/^\s*ROLLBACK/i.test(sql)) return Promise.reject(new Error('connection is dead'));
        return Promise.resolve({ rows: [] });
      },
      release: (err?: any) => { releasedWith = err; },
    };
    const fakePool = { connect: async () => fakeClient };

    const origPool = adapter._pool;
    adapter._pool = fakePool as any;
    try {
      await expect(
        adapter.transaction(async () => { throw new Error('op blew up'); }),
      ).rejects.toThrow('op blew up');
    } finally {
      adapter._pool = origPool;
    }

    // BEGIN then an attempted (failing) ROLLBACK; COMMIT must NOT have run.
    expect(queries.some((q) => /^\s*BEGIN/i.test(q))).toBe(true);
    expect(queries.some((q) => /^\s*ROLLBACK/i.test(q))).toBe(true);
    expect(queries.some((q) => /^\s*COMMIT/i.test(q))).toBe(false);
    // The key assertion: the connection was released WITH an error, so pg discards
    // it instead of handing the next caller a poisoned connection.
    expect(releasedWith).not.toBe('NOT_RELEASED');
    expect(releasedWith).toBeInstanceOf(Error);
  });
});
