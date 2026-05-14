'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { Datastore, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES } = require('./lib/datastore');

const SAMPLE = path.resolve(__dirname, '..', 'kanecta-datastore-sample');
const CLI = path.resolve(__dirname, 'index.js');

const ROOT_ID = 'f1a00001-b45e-4c3d-9e7f-000000000001';
const CLARIFY_ID = 'f1a00002-b45e-4c3d-9e7f-000000000001';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpDs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-test-'));
  return Datastore.init(root, 'test@example.com');
}

function cli(ds, ...args) {
  return execFileSync('node', [CLI, '--datastore', ds.root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, KANECTA_DATASTORE: undefined },
  });
}

function cliErr(ds, ...args) {
  try {
    execFileSync('node', [CLI, '--datastore', ds.root, ...args], {
      encoding: 'utf8',
      env: { ...process.env, KANECTA_DATASTORE: undefined },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    throw new Error('Expected CLI to exit non-zero');
  } catch (e) {
    if (e.message === 'Expected CLI to exit non-zero') throw e;
    return e.stderr || e.stdout || '';
  }
}

// ─── Datastore.init ───────────────────────────────────────────────────────────

test('init: creates .kanecta directory structure', () => {
  const ds = tmpDs();
  const dirs = ['data', 'aliases', 'annotations', 'config', 'history', 'links',
    'relationships', 'remotes', 'remotes-index', 'search', 'tags', 'types'];
  for (const d of dirs) {
    assert.ok(fs.existsSync(path.join(ds.k, d)), `missing dir: ${d}`);
  }
});

test('init: writes config.json with owner and specVersion', () => {
  const ds = tmpDs();
  const cfg = JSON.parse(fs.readFileSync(path.join(ds.k, 'config', 'config.json'), 'utf8'));
  assert.equal(cfg.owner, 'test@example.com');
  assert.equal(cfg.specVersion, '1.1.0');
});

test('init: isDatastore returns true for initialised root', () => {
  const ds = tmpDs();
  assert.ok(Datastore.isDatastore(ds.root));
});

test('init: isDatastore returns false for random directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-empty-'));
  assert.ok(!Datastore.isDatastore(dir));
});

// ─── Shard path ───────────────────────────────────────────────────────────────

test('_itemDir: computes 2+2+full_uuid shard path', () => {
  const ds = tmpDs();
  const id = 'a1b2c3d4-e5f6-4abc-9def-123456789012';
  const dir = ds._itemDir(id);
  assert.ok(dir.endsWith(path.join('data', 'a1', 'b2', id)));
});

// ─── create ───────────────────────────────────────────────────────────────────

test('create: returns item with UUID v4', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'hello', type: 'string' });
  assert.match(item.id, UUID_RE);
});

test('create: writes metadata.json at correct shard path', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'hello', type: 'string' });
  const metaPath = path.join(ds._itemDir(item.id), 'metadata.json');
  assert.ok(fs.existsSync(metaPath), 'metadata.json missing');
  const written = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.equal(written.id, item.id);
  assert.equal(written.value, 'hello');
});

test('create: populates all required fields', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x', type: 'text' });
  assert.ok(item.createdAt);
  assert.ok(item.modifiedAt);
  assert.equal(item.createdBy, 'test@example.com');
  assert.equal(item.modifiedBy, 'test@example.com');
  assert.equal(item.owner, 'test@example.com');
  assert.deepEqual(item.tags, []);
  assert.equal(item.confidence, null);
});

test('create: sets sortOrder to 0 for first root item', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'first', type: 'string' });
  assert.equal(item.sortOrder, 0);
});

test('create: appends sortOrder after last sibling', () => {
  const ds = tmpDs();
  const a = ds.create({ value: 'a', type: 'string' });
  const b = ds.create({ value: 'b', type: 'string' });
  assert.equal(a.sortOrder, 0);
  assert.equal(b.sortOrder, 1);
});

test('create: respects explicit sortOrder', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x', type: 'string', sortOrder: 42 });
  assert.equal(item.sortOrder, 42);
});

test('create: stores tags and updates tag index', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x', type: 'string', tags: ['alpha', 'beta'] });
  assert.deepEqual(item.tags, ['alpha', 'beta']);
  assert.ok(ds.byTag('alpha').includes(item.id));
  assert.ok(ds.byTag('beta').includes(item.id));
});

test('create: sets typeId only for object type', () => {
  const ds = tmpDs();
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const obj = ds.create({ type: 'object', typeId: tid });
  assert.equal(obj.typeId, tid);
  assert.ok(ds.byType(tid).includes(obj.id));
  const str = ds.create({ type: 'string', typeId: tid });
  assert.equal(str.typeId, null);
});

test('create: records [[uuid]] backlinks', () => {
  const ds = tmpDs();
  const target = ds.create({ value: 'target' });
  const linker = ds.create({ value: `See [[${target.id}]] for details` });
  const backlinks = ds.backlinks(target.id);
  assert.ok(backlinks.includes(linker.id));
});

test('create: writes history entry with changeType create', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'test' });
  const hist = ds.history(item.id);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].changeType, 'create');
  assert.equal(hist[0].id, item.id);
});

// ─── get ──────────────────────────────────────────────────────────────────────

test('get: returns item for valid UUID', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'hello' });
  const fetched = ds.get(item.id);
  assert.equal(fetched.id, item.id);
  assert.equal(fetched.value, 'hello');
});

test('get: returns null for unknown UUID', () => {
  const ds = tmpDs();
  assert.equal(ds.get('00000000-0000-0000-0000-000000000000'), null);
});

// ─── alias ────────────────────────────────────────────────────────────────────

test('setAlias / resolveAlias: round-trip', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  ds.setAlias('my-alias', item.id);
  assert.equal(ds.resolveAlias('my-alias'), item.id);
});

test('resolveAlias: returns null for unknown alias', () => {
  const ds = tmpDs();
  assert.equal(ds.resolveAlias('nope'), null);
});

test('resolve: handles UUID directly', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  assert.equal(ds.resolve(item.id)?.id, item.id);
});

test('resolve: handles alias', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  ds.setAlias('myalias', item.id);
  assert.equal(ds.resolve('myalias')?.id, item.id);
});

test('resolve: returns null for neither', () => {
  const ds = tmpDs();
  assert.equal(ds.resolve('nonexistent-alias'), null);
});

test('listAliases: returns all aliases sorted', () => {
  const ds = tmpDs();
  const a = ds.create({ value: 'a' });
  const b = ds.create({ value: 'b' });
  ds.setAlias('zzz', a.id);
  ds.setAlias('aaa', b.id);
  const list = ds.listAliases();
  assert.equal(list[0].alias, 'aaa');
  assert.equal(list[1].alias, 'zzz');
});

test('removeAlias: alias is no longer resolvable', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  ds.setAlias('gone', item.id);
  ds.removeAlias('gone');
  assert.equal(ds.resolveAlias('gone'), null);
});

// ─── update ───────────────────────────────────────────────────────────────────

test('update: changes value and bumps modifiedAt', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'old' });
  const before = item.modifiedAt;
  const updated = ds.update(item.id, { value: 'new' });
  assert.equal(updated.value, 'new');
  assert.ok(updated.modifiedAt >= before);
});

test('update: snapshots before modifying (update entry in history)', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'v1' });
  ds.update(item.id, { value: 'v2' });
  const hist = ds.history(item.id);
  // create + update
  assert.equal(hist.length, 2);
  assert.equal(hist[1].changeType, 'update');
  // snapshot captured the old value
  assert.equal(hist[1].value, 'v1');
});

test('update: reconciles backlinks when value changes', () => {
  const ds = tmpDs();
  const t1 = ds.create({ value: 'target1' });
  const t2 = ds.create({ value: 'target2' });
  const src = ds.create({ value: `[[${t1.id}]]` });
  assert.ok(ds.backlinks(t1.id).includes(src.id));
  ds.update(src.id, { value: `[[${t2.id}]]` });
  assert.ok(!ds.backlinks(t1.id).includes(src.id), 'old backlink not removed');
  assert.ok(ds.backlinks(t2.id).includes(src.id));
});

test('update: reconciles tags', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x', tags: ['old'] });
  ds.update(item.id, { tags: ['new'] });
  assert.ok(!ds.byTag('old').includes(item.id));
  assert.ok(ds.byTag('new').includes(item.id));
});

test('update: changes parent', () => {
  const ds = tmpDs();
  const p1 = ds.create({ value: 'parent1' });
  const p2 = ds.create({ value: 'parent2' });
  const child = ds.create({ value: 'child', parentId: p1.id });
  const updated = ds.update(child.id, { parentId: p2.id });
  assert.equal(updated.parentId, p2.id);
});

test('update: changes confidence', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  const updated = ds.update(item.id, { confidence: 'locked' });
  assert.equal(updated.confidence, 'locked');
});

test('update: removes old type from type index, adds new one', () => {
  const ds = tmpDs();
  const tid1 = 'aaaaaaaa-bbbb-cccc-dddd-000000000001';
  const tid2 = 'aaaaaaaa-bbbb-cccc-dddd-000000000002';
  const item = ds.create({ type: 'object', typeId: tid1 });
  assert.ok(ds.byType(tid1).includes(item.id));
  ds.update(item.id, { type: 'object', typeId: tid2 });
  assert.ok(!ds.byType(tid1).includes(item.id));
  assert.ok(ds.byType(tid2).includes(item.id));
});

// ─── delete ───────────────────────────────────────────────────────────────────

test('delete: item no longer readable after deletion', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'bye' });
  ds.delete(item.id);
  assert.equal(ds.get(item.id), null);
});

test('delete: snapshots with changeType delete before removing', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'ephemeral' });
  ds.delete(item.id);
  const histDir = ds._historyDir(item.id);
  const files = fs.readdirSync(histDir).filter(n => n.endsWith('.json'));
  const snapshots = files.map(f => JSON.parse(fs.readFileSync(path.join(histDir, f), 'utf8')));
  const del = snapshots.find(s => s.changeType === 'delete');
  assert.ok(del, 'no delete snapshot found');
  assert.equal(del.value, 'ephemeral');
});

test('delete: cleans up tag index entries', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x', tags: ['mytag'] });
  assert.ok(ds.byTag('mytag').includes(item.id));
  ds.delete(item.id);
  assert.ok(!ds.byTag('mytag').includes(item.id));
});

test('delete: cleans up type index entries', () => {
  const ds = tmpDs();
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const item = ds.create({ type: 'object', typeId: tid });
  assert.ok(ds.byType(tid).includes(item.id));
  ds.delete(item.id);
  assert.ok(!ds.byType(tid).includes(item.id));
});

test('delete: returns warnings when item has backlinks', () => {
  const ds = tmpDs();
  const target = ds.create({ value: 'target' });
  ds.create({ value: `[[${target.id}]]` });
  const { warnings } = ds.delete(target.id);
  assert.ok(warnings.some(w => w.includes('backlink') || w.includes('link')));
});

test('delete: returns warnings when item has inbound relationships', () => {
  const ds = tmpDs();
  const a = ds.create({ value: 'a' });
  const b = ds.create({ value: 'b' });
  ds.relate(a.id, 'depends-on', b.id);
  const { warnings } = ds.delete(b.id);
  assert.ok(warnings.some(w => w.includes('relationship')));
});

test('delete: returns empty warnings when no references', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'isolated' });
  const { warnings } = ds.delete(item.id);
  assert.equal(warnings.length, 0);
});

// ─── annotations ──────────────────────────────────────────────────────────────

test('annotate: creates annotation file', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  const ann = ds.annotate(item.id, { content: 'my note' });
  assert.match(ann.id, UUID_RE);
  assert.equal(ann.targetId, item.id);
  assert.equal(ann.content, 'my note');
  assert.equal(ann.parentAnnotationId, null);
});

test('annotations: returns both annotations sorted deterministically', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  const a1 = ds.annotate(item.id, { content: 'first' });
  const a2 = ds.annotate(item.id, { content: 'second' });
  const list = ds.annotations(item.id);
  assert.equal(list.length, 2);
  const ids = list.map(a => a.id);
  assert.ok(ids.includes(a1.id));
  assert.ok(ids.includes(a2.id));
  // Verify sort is stable: same result on repeated call
  const list2 = ds.annotations(item.id);
  assert.deepEqual(list.map(a => a.id), list2.map(a => a.id));
});

test('annotate: supports threaded reply', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  const parent = ds.annotate(item.id, { content: 'parent' });
  const reply = ds.annotate(item.id, { content: 'reply', parentAnnotationId: parent.id });
  assert.equal(reply.parentAnnotationId, parent.id);
});

test('annotations: returns empty array when none exist', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  assert.deepEqual(ds.annotations(item.id), []);
});

// ─── relationships ────────────────────────────────────────────────────────────

test('relate: creates outbound entry on source', () => {
  const ds = tmpDs();
  const a = ds.create({ value: 'a' });
  const b = ds.create({ value: 'b' });
  const rel = ds.relate(a.id, 'depends-on', b.id, { note: 'because' });
  const rels = ds.relationships(a.id);
  assert.equal(rels.outbound.length, 1);
  assert.equal(rels.outbound[0].targetId, b.id);
  assert.equal(rels.outbound[0].type, 'depends-on');
  assert.equal(rels.outbound[0].note, 'because');
});

test('relate: creates inbound entry on target', () => {
  const ds = tmpDs();
  const a = ds.create({ value: 'a' });
  const b = ds.create({ value: 'b' });
  ds.relate(a.id, 'enables', b.id);
  const rels = ds.relationships(b.id);
  assert.equal(rels.inbound.length, 1);
  assert.equal(rels.inbound[0].sourceId, a.id);
  assert.equal(rels.inbound[0].type, 'enables');
});

test('relate: both entries share the same relationship ID', () => {
  const ds = tmpDs();
  const a = ds.create({ value: 'a' });
  const b = ds.create({ value: 'b' });
  const rel = ds.relate(a.id, 'blocks', b.id);
  const srcRels = ds.relationships(a.id);
  const tgtRels = ds.relationships(b.id);
  assert.equal(srcRels.outbound[0].id, rel.id);
  assert.equal(tgtRels.inbound[0].id, rel.id);
});

test('relationships: returns empty outbound/inbound when none exist', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  const rels = ds.relationships(item.id);
  assert.deepEqual(rels.outbound, []);
  assert.deepEqual(rels.inbound, []);
});

// ─── backlinks ────────────────────────────────────────────────────────────────

test('backlinks: returns empty array when no links', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x' });
  assert.deepEqual(ds.backlinks(item.id), []);
});

test('backlinks: multiple inbound links tracked', () => {
  const ds = tmpDs();
  const target = ds.create({ value: 'target' });
  const a = ds.create({ value: `[[${target.id}]]` });
  const b = ds.create({ value: `link: [[${target.id}]] text` });
  const links = ds.backlinks(target.id);
  assert.ok(links.includes(a.id));
  assert.ok(links.includes(b.id));
});

// ─── history ──────────────────────────────────────────────────────────────────

test('history: returns empty array for item with no history dir', () => {
  const ds = tmpDs();
  assert.deepEqual(ds.history('00000000-0000-0000-0000-000000000000'), []);
});

test('history: create → update → delete produces 3 snapshots with correct changeTypes', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'v1' });
  ds.update(item.id, { value: 'v2' });
  ds.delete(item.id);
  const entries = ds.history(item.id);
  assert.equal(entries.length, 3);
  const types = new Set(entries.map(e => e.changeType));
  assert.ok(types.has('create'));
  assert.ok(types.has('update'));
  assert.ok(types.has('delete'));
});

// ─── byTag ────────────────────────────────────────────────────────────────────

test('byTag: returns empty array when tag unused', () => {
  const ds = tmpDs();
  assert.deepEqual(ds.byTag('nope'), []);
});

test('byTag: returns correct item IDs', () => {
  const ds = tmpDs();
  const a = ds.create({ value: 'a', tags: ['important'] });
  ds.create({ value: 'b' });
  const tagged = ds.byTag('important');
  assert.ok(tagged.includes(a.id));
  assert.equal(tagged.length, 1);
});

// ─── tree ─────────────────────────────────────────────────────────────────────

test('tree: returns all items depth-first sorted by sortOrder', () => {
  const ds = tmpDs();
  const root = ds.create({ value: 'root' });
  const c2 = ds.create({ value: 'c2', parentId: root.id });
  const c1 = ds.create({ value: 'c1', parentId: root.id, sortOrder: 0 });
  ds.update(c2.id, { sortOrder: 1 });
  const nodes = ds.tree();
  const values = nodes.map(n => n.item.value);
  assert.equal(values[0], 'root');
  assert.equal(values[1], 'c1');
  assert.equal(values[2], 'c2');
});

test('tree: respects maxDepth', () => {
  const ds = tmpDs();
  const root = ds.create({ value: 'root' });
  const child = ds.create({ value: 'child', parentId: root.id });
  ds.create({ value: 'grandchild', parentId: child.id });
  const nodes = ds.tree(null, 1);
  assert.equal(nodes.length, 2); // root + child, no grandchild
});

test('tree: roots at specific ID when given', () => {
  const ds = tmpDs();
  const root = ds.create({ value: 'root' });
  ds.create({ value: 'other-root' });
  const child = ds.create({ value: 'child', parentId: root.id });
  const nodes = ds.tree(root.id);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].item.id, root.id);
  assert.equal(nodes[1].item.id, child.id);
});

// ─── loadAll ──────────────────────────────────────────────────────────────────

test('loadAll: returns all items from sample datastore', () => {
  const ds = new Datastore(SAMPLE);
  const items = ds.loadAll();
  assert.equal(items.length, 35);
});

// ─── rebuildIndexes ───────────────────────────────────────────────────────────

test('rebuildIndexes: repopulates tag index', () => {
  const ds = tmpDs();
  const item = ds.create({ value: 'x', tags: ['mytag'] });
  // Corrupt the tag index
  const tagFile = path.join(ds._shardDir('tags', 'mytag'), 'items.json');
  fs.writeFileSync(tagFile, '{"items":[]}');
  ds.rebuildIndexes();
  assert.ok(ds.byTag('mytag').includes(item.id));
});

test('rebuildIndexes: repopulates backlinks index', () => {
  const ds = tmpDs();
  const target = ds.create({ value: 'target' });
  const src = ds.create({ value: `[[${target.id}]]` });
  // Corrupt backlinks
  const hex = target.id.replace(/-/g, '');
  const linksFile = path.join(ds.k, 'links', hex.slice(0, 2), hex.slice(2, 4), target.id, 'backlinks.json');
  fs.writeFileSync(linksFile, '{"backlinks":[]}');
  ds.rebuildIndexes();
  assert.ok(ds.backlinks(target.id).includes(src.id));
});

test('rebuildIndexes: returns item count', () => {
  const ds = new Datastore(SAMPLE);
  const count = ds.rebuildIndexes();
  assert.equal(count, 35);
});

// ─── Sample datastore (read-only integration) ─────────────────────────────────

test('sample: root item readable by UUID', () => {
  const ds = new Datastore(SAMPLE);
  const item = ds.get(ROOT_ID);
  assert.equal(item.value, 'Base Work Process');
  assert.equal(item.parentId, null);
  assert.equal(item.type, 'text');
});

test('sample: alias base-work-process resolves to root UUID', () => {
  const ds = new Datastore(SAMPLE);
  const id = ds.resolveAlias('base-work-process');
  assert.equal(id, ROOT_ID);
});

test('sample: tree produces 35 nodes from root', () => {
  const ds = new Datastore(SAMPLE);
  const nodes = ds.tree(ROOT_ID);
  assert.equal(nodes.length, 35);
});

test('sample: children of root are sorted correctly (Clarify first, Principles last)', () => {
  const ds = new Datastore(SAMPLE);
  const rootChildren = ds.children(ROOT_ID);
  assert.equal(rootChildren[0].value, 'Clarify');
  assert.equal(rootChildren[rootChildren.length - 1].value, 'Principles');
});

test('sample: clarify children in order', () => {
  const ds = new Datastore(SAMPLE);
  const kids = ds.children(CLARIFY_ID);
  assert.equal(kids[0].value, 'Confirm the goal and success criteria before starting');
  assert.equal(kids[1].value, 'Identify constraints (time, tech stack, compatibility)');
  assert.equal(kids[2].value, 'Ask questions now — not mid-build');
});

// ─── CLI integration ──────────────────────────────────────────────────────────

test('cli: help output contains command list', () => {
  const out = execFileSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.ok(out.includes('create'));
  assert.ok(out.includes('update'));
  assert.ok(out.includes('delete'));
  assert.ok(out.includes('tree'));
  assert.ok(out.includes('alias'));
  assert.ok(out.includes('annotate'));
  assert.ok(out.includes('relate'));
  assert.ok(out.includes('history'));
  assert.ok(out.includes('export'));
  assert.ok(out.includes('rebuild-indexes'));
});

test('cli: get by UUID returns item details', () => {
  const ds = new Datastore(SAMPLE);
  const out = cli(ds, 'get', ROOT_ID);
  assert.ok(out.includes(ROOT_ID));
  assert.ok(out.includes('Base Work Process'));
});

test('cli: get by alias resolves correctly', () => {
  const ds = new Datastore(SAMPLE);
  const out = cli(ds, 'get', 'base-work-process');
  assert.ok(out.includes(ROOT_ID));
});

test('cli: get --json outputs valid JSON', () => {
  const ds = new Datastore(SAMPLE);
  const out = cli(ds, 'get', ROOT_ID, '--json');
  const parsed = JSON.parse(out);
  assert.equal(parsed.id, ROOT_ID);
});

test('cli: get unknown ID exits non-zero', () => {
  const ds = new Datastore(SAMPLE);
  const err = cliErr(ds, 'get', '00000000-0000-0000-0000-000000000000');
  assert.ok(err.includes('Not found'));
});

test('cli: tree output is indented tree starting with root', () => {
  const ds = new Datastore(SAMPLE);
  const out = cli(ds, 'tree', ROOT_ID, '--depth', '1');
  const lines = out.trim().split('\n');
  assert.equal(lines[0], 'Base Work Process');
  assert.ok(lines[1].startsWith('  '));
});

test('cli: tree --ids prefixes each line with UUID', () => {
  const ds = new Datastore(SAMPLE);
  const out = cli(ds, 'tree', ROOT_ID, '--depth', '1', '--ids');
  const lines = out.trim().split('\n');
  for (const line of lines) {
    const uuid = line.split(' ')[0];
    assert.match(uuid, UUID_RE, `line missing UUID: ${line}`);
  }
});

test('cli: create then get round-trip', () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--type', 'string', '--value', 'Hello World');
  const match = out.match(/Created: ([0-9a-f-]{36})/);
  assert.ok(match, 'no UUID in create output');
  const id = match[1];
  const getOut = cli(ds, 'get', id);
  assert.ok(getOut.includes('Hello World'));
});

test('cli: create with --alias creates alias', () => {
  const ds = tmpDs();
  cli(ds, 'create', '--value', 'Item A', '--alias', 'item-a');
  const aliasOut = cli(ds, 'alias', 'get', 'item-a');
  assert.match(aliasOut.trim(), UUID_RE);
});

test('cli: create with --tag stores tag and tag index', () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'tagged', '--tag', 'alpha', '--tag', 'beta');
  const match = out.match(/Created: ([0-9a-f-]{36})/);
  const id = match[1];
  const item = ds.get(id);
  assert.ok(item.tags.includes('alpha'));
  assert.ok(item.tags.includes('beta'));
  assert.ok(ds.byTag('alpha').includes(id));
});

test('cli: update changes value', () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'old value');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'update', id, '--value', 'new value');
  const item = ds.get(id);
  assert.equal(item.value, 'new value');
});

test('cli: update --add-tag adds tags without removing existing', () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'x', '--tag', 'existing');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'update', id, '--add-tag', 'new-tag');
  const item = ds.get(id);
  assert.ok(item.tags.includes('existing'));
  assert.ok(item.tags.includes('new-tag'));
});

test('cli: update --remove-tag removes tag', () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'x', '--tag', 'remove-me', '--tag', 'keep');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'update', id, '--remove-tag', 'remove-me');
  const item = ds.get(id);
  assert.ok(!item.tags.includes('remove-me'));
  assert.ok(item.tags.includes('keep'));
});

test('cli: update --confidence sets confidence', () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'x');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'update', id, '--confidence', 'decided');
  assert.equal(ds.get(id).confidence, 'decided');
});

test('cli: delete --force removes item without prompt', () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'to delete');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'delete', id, '--force');
  assert.equal(ds.get(id), null);
});

test('cli: alias set / get / list / remove', () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'test');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'alias', 'set', 'test-alias', id);
  const getOut = cli(ds, 'alias', 'get', 'test-alias');
  assert.equal(getOut.trim(), id);
  const listOut = cli(ds, 'alias', 'list');
  assert.ok(listOut.includes('test-alias'));
  cli(ds, 'alias', 'remove', 'test-alias');
  const err = cliErr(ds, 'alias', 'get', 'test-alias');
  assert.ok(err.includes('not found') || err.includes('Alias'));
});

test('cli: annotate creates annotation, annotations lists it', () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'item');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'annotate', id, 'My annotation text');
  const annOut = cli(ds, 'annotations', id);
  assert.ok(annOut.includes('My annotation text'));
});

test('cli: relate creates relationship, relationships lists it', () => {
  const ds = tmpDs();
  const a = cli(ds, 'create', '--value', 'A').match(/Created: ([0-9a-f-]{36})/)[1];
  const b = cli(ds, 'create', '--value', 'B').match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'relate', a, 'depends-on', b, '--note', 'A needs B');
  const rOut = cli(ds, 'relationships', a);
  assert.ok(rOut.includes('depends-on'));
  assert.ok(rOut.includes(b));
  assert.ok(rOut.includes('A needs B'));
});

test('cli: backlinks lists items that link here', () => {
  const ds = tmpDs();
  const target = cli(ds, 'create', '--value', 'target').match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'create', '--value', `see [[${target}]] here`);
  const blOut = cli(ds, 'backlinks', target);
  assert.ok(blOut.includes(target) || blOut.includes('link'));
});

test('cli: history shows create entry', () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'x');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  const histOut = cli(ds, 'history', id);
  assert.ok(histOut.toLowerCase().includes('create'));
});

test('cli: tag list returns items with tag', () => {
  const ds = tmpDs();
  cli(ds, 'create', '--value', 'x', '--tag', 'featured');
  const out = cli(ds, 'tag', 'list', 'featured');
  assert.ok(out.includes('featured'));
  assert.ok(out.includes('item'));
});

test('cli: export outputs indented plain text', () => {
  const ds = new Datastore(SAMPLE);
  const out = cli(ds, 'export', ROOT_ID, '--depth', '1');
  const lines = out.trim().split('\n');
  assert.equal(lines[0], 'Base Work Process');
  assert.ok(lines[1].startsWith('  '));
});

test('cli: export --ids prefixes every line with UUID', () => {
  const ds = new Datastore(SAMPLE);
  const out = cli(ds, 'export', ROOT_ID, '--depth', '1', '--ids');
  for (const line of out.trim().split('\n')) {
    assert.match(line.split(' ')[0], UUID_RE);
    assert.ok(line.includes(' | '));
  }
});

test('cli: export --output writes to file', () => {
  const ds = new Datastore(SAMPLE);
  const outFile = path.join(os.tmpdir(), `kanecta-export-test-${Date.now()}.txt`);
  try {
    cli(ds, 'export', ROOT_ID, '--depth', '1', '--output', outFile);
    const content = fs.readFileSync(outFile, 'utf8');
    assert.ok(content.startsWith('Base Work Process'));
  } finally {
    fs.rmSync(outFile, { force: true });
  }
});

test('cli: rebuild-indexes reports item count', () => {
  const ds = new Datastore(SAMPLE);
  const out = cli(ds, 'rebuild-indexes');
  assert.ok(out.includes('35'));
});

test('cli: unknown command exits non-zero with helpful message', () => {
  const ds = tmpDs();
  const err = cliErr(ds, 'frobnicate');
  assert.ok(err.includes('Unknown command') || err.includes('frobnicate'));
});

test('cli: init creates datastore at given path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-init-test-'));
  try {
    execFileSync('node', [CLI, 'init', dir, '--owner', 'init@example.com'], { encoding: 'utf8' });
    assert.ok(Datastore.isDatastore(dir));
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.kanecta', 'config', 'config.json'), 'utf8'));
    assert.equal(cfg.owner, 'init@example.com');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
