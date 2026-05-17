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
  expect(cfg.specVersion).toBe('1.2.0');
  fs.rmSync(ds.root, { recursive: true });
});

test('isDatastore returns false for non-datastore directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-ds-'));
  expect(Datastore.isDatastore(dir)).toBe(false);
  fs.rmSync(dir, { recursive: true });
});

// ─── create / get ─────────────────────────────────────────────────────────────

test('create returns item with valid UUID and correct fields', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'hello', type: 'string', tags: ['x'] });
  expect(item.id).toMatch(UUID_RE);
  expect(item.value).toBe('hello');
  expect(item.type).toBe('string');
  expect(item.tags).toEqual(['x']);
  expect(item.owner).toBe('test@example.com');
  expect(item.parentId).toMatch(UUID_RE); // defaults to data_root
  expect(item.sortOrder).toBe(0);
  fs.rmSync(ds.root, { recursive: true });
});

test('create auto-increments sortOrder among siblings', () => {
  const ds = tmpDs();
  const a = ds.create({ value: 'a' });
  const b = ds.create({ value: 'b' });
  expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
  fs.rmSync(ds.root, { recursive: true });
});

test('get returns item by UUID, null for unknown', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  expect(ds.get(item.id).id).toBe(item.id);
  expect(ds.get('ffffffff-ffff-4fff-bfff-ffffffffffff')).toBeNull(); // unknown UUID
  fs.rmSync(ds.root, { recursive: true });
});

test('create records [[uuid]] backlinks', () => {
  const ds = tmpDs();
  const target = ds.create({ value: 'target' });
  const src = ds.create({ value: `see [[${target.id}]]` });
  expect(ds.backlinks(target.id)).toContain(src.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('create writes history entry with changeType create', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'test' });
  const hist = ds.history(item.id);
  expect(hist).toHaveLength(1);
  expect(hist[0].changeType).toBe('create');
  fs.rmSync(ds.root, { recursive: true });
});

// ─── resolve / alias ──────────────────────────────────────────────────────────

test('setAlias / resolveAlias / resolve round-trip', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  ds.setAlias('my-alias', item.id);
  expect(ds.resolveAlias('my-alias')).toBe(item.id);
  expect(ds.resolve('my-alias').id).toBe(item.id);
  expect(ds.resolve(item.id).id).toBe(item.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('listAliases returns sorted aliases', () => {
  const ds = tmpDs();
  const a = ds.create({ value: 'a' });
  const b = ds.create({ value: 'b' });
  ds.setAlias('zzz', a.id);
  ds.setAlias('aaa', b.id);
  const list = ds.listAliases();
  expect(list[0].alias).toBe('aaa');
  expect(list[1].alias).toBe('zzz');
  fs.rmSync(ds.root, { recursive: true });
});

test('removeAlias makes alias unresolvable', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  ds.setAlias('gone', item.id);
  ds.removeAlias('gone');
  expect(ds.resolveAlias('gone')).toBeNull();
  fs.rmSync(ds.root, { recursive: true });
});

// ─── update ───────────────────────────────────────────────────────────────────

test('update changes value and reconciles backlinks', () => {
  const ds = tmpDs();
  const t1 = ds.create({ value: 'target1' });
  const t2 = ds.create({ value: 'target2' });
  const src = ds.create({ value: `[[${t1.id}]]` });
  ds.update(src.id, { value: `[[${t2.id}]]` });
  expect(ds.backlinks(t1.id)).not.toContain(src.id);
  expect(ds.backlinks(t2.id)).toContain(src.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('update reconciles tags', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x', tags: ['old'] });
  ds.update(item.id, { tags: ['new'] });
  expect(ds.byTag('old')).not.toContain(item.id);
  expect(ds.byTag('new')).toContain(item.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('update adds history snapshot', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'v1' });
  ds.update(item.id, { value: 'v2' });
  const hist = ds.history(item.id);
  expect(hist).toHaveLength(2);
  const types = hist.map(h => h.changeType);
  expect(types).toContain('create');
  expect(types).toContain('update');
  fs.rmSync(ds.root, { recursive: true });
});

// ─── delete ───────────────────────────────────────────────────────────────────

test('delete removes item and cleans up indexes', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'bye', tags: ['t'] });
  ds.delete(item.id);
  expect(ds.get(item.id)).toBeNull();
  expect(ds.byTag('t')).not.toContain(item.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('deleteWarnings reports backlinks and inbound relationships', () => {
  const ds = tmpDs();
  const target = ds.create({ value: 'target' });
  ds.create({ value: `[[${target.id}]]` });
  const warnings = ds.deleteWarnings(target.id);
  expect(warnings.length).toBeGreaterThan(0);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── annotations ─────────────────────────────────────────────────────────────

test('annotate / annotations round-trip', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  const ann = ds.annotate(item.id, { content: 'my note' });
  expect(ann.targetId).toBe(item.id);
  expect(ann.content).toBe('my note');
  const list = ds.annotations(item.id);
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe(ann.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('annotate supports threaded reply', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  const parent = ds.annotate(item.id, { content: 'parent' });
  const reply = ds.annotate(item.id, { content: 'reply', parentAnnotationId: parent.id });
  expect(reply.parentAnnotationId).toBe(parent.id);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── relationships ────────────────────────────────────────────────────────────

test('relate creates outbound and inbound entries', () => {
  const ds = tmpDs();
  const a = ds.create({ value: 'a' });
  const b = ds.create({ value: 'b' });
  const rel = ds.relate(a.id, 'depends-on', b.id, { note: 'reason' });
  const srcRels = ds.relationships(a.id);
  const tgtRels = ds.relationships(b.id);
  expect(srcRels.outbound[0].id).toBe(rel.id);
  expect(srcRels.outbound[0].type).toBe('depends-on');
  expect(tgtRels.inbound[0].id).toBe(rel.id);
  expect(tgtRels.inbound[0].sourceId).toBe(a.id);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── tree / children ──────────────────────────────────────────────────────────

test('children returns sorted children', () => {
  const ds = tmpDs();
  const root = ds.create({ value: 'root' });
  const c1 = ds.create({ value: 'c1', parentId: root.id, sortOrder: 0 });
  const c2 = ds.create({ value: 'c2', parentId: root.id, sortOrder: 1 });
  const kids = ds.children(root.id);
  expect(kids[0].id).toBe(c1.id);
  expect(kids[1].id).toBe(c2.id);
  fs.rmSync(ds.root, { recursive: true });
});

test('tree respects maxDepth', () => {
  const ds = tmpDs();
  const root = ds.create({ value: 'root' });
  const child = ds.create({ value: 'child', parentId: root.id });
  ds.create({ value: 'grandchild', parentId: child.id });
  const nodes = ds.tree(null, 1);
  expect(nodes.length).toBe(2);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── tags / byType ────────────────────────────────────────────────────────────

test('byTag returns IDs of tagged items', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x', tags: ['important'] });
  ds.create({ value: 'y' });
  expect(ds.byTag('important')).toContain(item.id);
  expect(ds.byTag('important')).toHaveLength(1);
  fs.rmSync(ds.root, { recursive: true });
});

test('byType returns IDs of typed object items', () => {
  const ds = tmpDs();
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const item = ds.create({ type: 'object', typeId: tid });
  expect(ds.byType(tid)).toContain(item.id);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── rebuildIndexes ───────────────────────────────────────────────────────────

test('rebuildIndexes repopulates indexes from data', () => {
  const ds = tmpDs();
  const target = ds.create({ value: 'target' });
  const src = ds.create({ value: `[[${target.id}]]`, tags: ['mytag'] });
  // corrupt the indexes
  const hex = target.id.replace(/-/g, '');
  fs.writeFileSync(
    path.join(ds.k, 'links', hex.slice(0, 2), hex.slice(2, 4), target.id, 'backlinks.json'),
    '{"backlinks":[]}'
  );
  ds.rebuildIndexes();
  expect(ds.backlinks(target.id)).toContain(src.id);
  expect(ds.byTag('mytag')).toContain(src.id);
  fs.rmSync(ds.root, { recursive: true });
});

// ─── Sample datastore (read-only) ────────────────────────────────────────────

test('sample: root item readable and correct', () => {
  const ds = Datastore.open(SAMPLE);
  const item = ds.get(ROOT_ID);
  expect(item.value).toBe('Base Work Process');
  expect(item.parentId).toMatch(UUID_RE); // reparented to data_root in 1.2.0
});

test('sample: alias resolves to root UUID', () => {
  const ds = Datastore.open(SAMPLE);
  expect(ds.resolveAlias('base-work-process')).toBe(ROOT_ID);
});

test('sample: loadAll returns 40 items', () => {
  const ds = Datastore.open(SAMPLE);
  expect(ds.loadAll()).toHaveLength(40); // 35 user items + 5 well-known root nodes
});

test('sample: tree from root produces 35 nodes', () => {
  const ds = Datastore.open(SAMPLE);
  expect(ds.tree(ROOT_ID)).toHaveLength(35);
});
