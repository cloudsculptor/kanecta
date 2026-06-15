'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { Datastore, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES } = require('../src/index');

const SAMPLE = path.resolve(__dirname, '../../kanecta-datastore-sample');
const ROOT_ID = 'f1a00001-b45e-4c3d-9e7f-000000000001';
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
  const cfg = JSON.parse(fs.readFileSync(path.join(ds.k, 'config', 'config.json'), 'utf8'));
  expect(cfg.owner).toBe('test@example.com');
  expect(cfg.specVersion).toBe('1.3.0');
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
  expect(item.parentId).toMatch(UUID_RE); // defaults to data_root
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

test('rebuildIndexes repopulates indexes from data', async () => {
  const ds = tmpDs();
  const target = await ds.create({ value: 'target' });
  const src = await ds.create({ value: `[[${target.id}]]`, tags: ['mytag'] });
  // corrupt the indexes
  const hex = target.id.replace(/-/g, '');
  fs.writeFileSync(
    path.join(ds.k, 'links', hex.slice(0, 2), hex.slice(2, 4), target.id, 'backlinks.json'),
    '{"backlinks":[]}'
  );
  await ds.rebuildIndexes();
  expect(await ds.backlinks(target.id)).toContain(src.id);
  expect(await ds.byTag('mytag')).toContain(src.id);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── Sample datastore (read-only) ────────────────────────────────────────────

test('sample: root item readable and correct', async () => {
  const ds = Datastore.open(SAMPLE);
  const item = await ds.get(ROOT_ID);
  expect(item.value).toBe('Base Work Process');
  expect(item.parentId).toMatch(UUID_RE); // reparented to data_root in 1.2.0
});

test('sample: alias resolves to root UUID', async () => {
  const ds = Datastore.open(SAMPLE);
  expect(await ds.resolveAlias('base-work-process')).toBe(ROOT_ID);
});

test('sample: loadAll returns 40 items', async () => {
  const ds = Datastore.open(SAMPLE);
  expect(await ds.loadAll()).toHaveLength(40); // 35 user items + 5 well-known root nodes
});

test('sample: tree from root produces 35 nodes', async () => {
  const ds = Datastore.open(SAMPLE);
  expect(await ds.tree(ROOT_ID)).toHaveLength(35);
});

// ─── Query ───────────────────────────────────────────────────────────────────

test('query filters by type and matches primitive/custom type names', async () => {
  const ds = tmpDs();
  const root = await ds.create({ value: 'root' });
  const textItem = await ds.create({ value: 'hello', type: 'text', parentId: root.id });
  const stringItem = await ds.create({ value: 'world', type: 'string', parentId: root.id });

  // Custom type
  const typeId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
  fs.mkdirSync(path.join(ds.k, 'types', 'bb', 'bb', typeId), { recursive: true });
  fs.writeFileSync(
    path.join(ds.k, 'types', 'bb', 'bb', typeId, 'metadata.json'),
    JSON.stringify({ id: typeId, value: 'mycustomtype' })
  );

  const customItem = await ds.create({
    type: 'object',
    typeId,
    parentId: root.id,
    objectData: { title: 'Custom Item' }
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
  const ds = tmpDs();
  const root = await ds.create({ value: 'root' });

  const typeId = 'cccccccc-dddd-eeee-ffff-000000000000';
  fs.mkdirSync(path.join(ds.k, 'types', 'cc', 'cc', typeId), { recursive: true });
  fs.writeFileSync(
    path.join(ds.k, 'types', 'cc', 'cc', typeId, 'metadata.json'),
    JSON.stringify({ id: typeId, value: 'item' })
  );

  const item1 = await ds.create({
    type: 'object',
    typeId,
    parentId: root.id,
    objectData: { severity: 'P1', status: 'open', score: 10, tags: ['bug', 'ui'] }
  });

  const item2 = await ds.create({
    type: 'object',
    typeId,
    parentId: root.id,
    objectData: { severity: 'P2', status: 'closed', score: 5, tags: ['backend'] }
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
  const ds = tmpDs();
  const root = await ds.create({ value: 'root' });

  const typeId = 'dddddddd-eeee-ffff-0000-111111111111';
  fs.mkdirSync(path.join(ds.k, 'types', 'dd', 'dd', typeId), { recursive: true });
  fs.writeFileSync(
    path.join(ds.k, 'types', 'dd', 'dd', typeId, 'metadata.json'),
    JSON.stringify({ id: typeId, value: 'item' })
  );

  await ds.create({
    type: 'object',
    typeId,
    parentId: root.id,
    objectData: { score: 10 }
  });
  await ds.create({
    type: 'object',
    typeId,
    parentId: root.id,
    objectData: { score: 30 }
  });
  await ds.create({
    type: 'object',
    typeId,
    parentId: root.id,
    objectData: { score: 20 }
  });

  // Sort ascending
  const asc = await ds.query({ type: 'item', sort: { field: 'score', dir: 'asc' } });
  expect(asc.map(a => a.objectData.score)).toEqual([10, 20, 30]);

  // Sort descending and limit
  const descLimit = await ds.query({ type: 'item', sort: { field: 'score', dir: 'desc' }, limit: 2 });
  expect(descLimit).toHaveLength(2);
  expect(descLimit.map(a => a.objectData.score)).toEqual([30, 20]);

  fs.rmSync(ds.root, { recursive: true });
});
