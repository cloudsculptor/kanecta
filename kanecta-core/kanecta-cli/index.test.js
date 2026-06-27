'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { Datastore, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, DEFAULT_LICENSE } = require('@kanecta/lib');

const SAMPLE = path.resolve(__dirname, '../kanecta-datastore-sample');
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
  assert.equal(cfg.specVersion, '1.4.0');
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
  const dir = ds._adapter._itemDir(id);
  assert.ok(dir.endsWith(path.join('data', 'a1', 'b2', id)));
});

// ─── create ───────────────────────────────────────────────────────────────────

test('create: returns item with UUID v4', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'hello', type: 'string' });
  assert.match(item.id, UUID_RE);
});

test('create: writes metadata.json at correct shard path', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'hello', type: 'string' });
  const metaPath = path.join(ds._adapter._itemDir(item.id), 'metadata.json');
  assert.ok(fs.existsSync(metaPath), 'metadata.json missing');
  const written = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.equal(written.id, item.id);
  assert.equal(written.value, 'hello');
});

test('create: defaults license, visibility, and aspect per spec 1.4.0', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'hello', type: 'string' });
  assert.equal(item.license, DEFAULT_LICENSE);
  assert.match(item.license, UUID_RE);
  assert.equal(item.visibility, 'private');
  assert.equal(item.aspect, null);
});

test('children: scopes results by aspect', async () => {
  const ds = tmpDs();
  const parent = await ds.create({ value: 'parent', type: 'string' });
  const defaultChild = await ds.create({ value: 'default-aspect', type: 'string', parentId: parent.id });
  const settingsChild = await ds.create({ value: 'settings-aspect', type: 'string', parentId: parent.id, aspect: 'settings' });

  const defaultChildren = await ds.children(parent.id);
  assert.equal(defaultChildren.length, 1);
  assert.equal(defaultChildren[0].id, defaultChild.id);

  const settingsChildren = await ds.children(parent.id, 'settings');
  assert.equal(settingsChildren.length, 1);
  assert.equal(settingsChildren[0].id, settingsChild.id);
});

test('create: populates all required fields', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x', type: 'text' });
  assert.ok(item.createdAt);
  assert.ok(item.modifiedAt);
  assert.equal(item.createdBy, 'test@example.com');
  assert.equal(item.modifiedBy, 'test@example.com');
  assert.equal(item.owner, 'test@example.com');
  assert.deepEqual(item.tags, []);
  assert.equal(item.confidence, null);
});

test('create: sets sortOrder to 0 for first child of a new parent', async () => {
  const ds = tmpDs();
  const parent = await ds.create({ value: 'parent' });
  const item = await ds.create({ value: 'first', type: 'string', parentId: parent.id });
  assert.equal(item.sortOrder, 0);
});

test('create: appends sortOrder after last sibling', async () => {
  const ds = tmpDs();
  const parent = await ds.create({ value: 'parent' });
  const a = await ds.create({ value: 'a', type: 'string', parentId: parent.id });
  const b = await ds.create({ value: 'b', type: 'string', parentId: parent.id });
  assert.equal(a.sortOrder, 0);
  assert.equal(b.sortOrder, 1);
});

test('create: respects explicit sortOrder', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x', type: 'string', sortOrder: 42 });
  assert.equal(item.sortOrder, 42);
});

test('create: stores tags and updates tag index', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x', type: 'string', tags: ['alpha', 'beta'] });
  assert.deepEqual(item.tags, ['alpha', 'beta']);
  assert.ok((await ds.byTag('alpha')).includes(item.id));
  assert.ok((await ds.byTag('beta')).includes(item.id));
});

test('create: sets typeId only for object type', async () => {
  const ds = tmpDs();
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const obj = await ds.create({ type: 'object', typeId: tid });
  assert.equal(obj.typeId, tid);
  assert.ok((await ds.byType(tid)).includes(obj.id));
  const str = await ds.create({ type: 'string', typeId: tid });
  assert.equal(str.typeId, null);
});

test('create: records [[uuid]] backlinks', async () => {
  const ds = tmpDs();
  const target = await ds.create({ value: 'target' });
  const linker = await ds.create({ value: `See [[${target.id}]] for details` });
  const backlinks = await ds.backlinks(target.id);
  assert.ok(backlinks.includes(linker.id));
});

test('create: writes history entry with changeType create', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'test' });
  const hist = await ds.history(item.id);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].changeType, 'create');
  assert.equal(hist[0].id, item.id);
});

// ─── get ──────────────────────────────────────────────────────────────────────

test('get: returns item for valid UUID', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'hello' });
  const fetched = await ds.get(item.id);
  assert.equal(fetched.id, item.id);
  assert.equal(fetched.value, 'hello');
});

test('get: returns null for unknown UUID', async () => {
  const ds = tmpDs();
  assert.equal(await ds.get('ffffffff-ffff-ffff-ffff-ffffffffffff'), null);
});

// ─── alias ────────────────────────────────────────────────────────────────────

test('setAlias / resolveAlias: round-trip', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  await ds.setAlias('my-alias', item.id);
  assert.equal(await ds.resolveAlias('my-alias'), item.id);
});

test('resolveAlias: returns null for unknown alias', async () => {
  const ds = tmpDs();
  assert.equal(await ds.resolveAlias('nope'), null);
});

test('resolve: handles UUID directly', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  assert.equal((await ds.resolve(item.id))?.id, item.id);
});

test('resolve: handles alias', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  await ds.setAlias('myalias', item.id);
  assert.equal((await ds.resolve('myalias'))?.id, item.id);
});

test('resolve: returns null for neither', async () => {
  const ds = tmpDs();
  assert.equal(await ds.resolve('nonexistent-alias'), null);
});

test('listAliases: returns all aliases sorted', async () => {
  const ds = tmpDs();
  const a = await ds.create({ value: 'a' });
  const b = await ds.create({ value: 'b' });
  await ds.setAlias('zzz', a.id);
  await ds.setAlias('aaa', b.id);
  const list = await ds.listAliases();
  assert.equal(list[0].alias, 'aaa');
  assert.equal(list[1].alias, 'zzz');
});

test('removeAlias: alias is no longer resolvable', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  await ds.setAlias('gone', item.id);
  await ds.removeAlias('gone');
  assert.equal(await ds.resolveAlias('gone'), null);
});

// ─── update ───────────────────────────────────────────────────────────────────

test('update: changes value and bumps modifiedAt', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'old' });
  const before = item.modifiedAt;
  const updated = await ds.update(item.id, { value: 'new' });
  assert.equal(updated.value, 'new');
  assert.ok(updated.modifiedAt >= before);
});

test('update: snapshots before modifying (update entry in history)', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'v1' });
  await ds.update(item.id, { value: 'v2' });
  const hist = await ds.history(item.id);
  // create + update
  assert.equal(hist.length, 2);
  assert.equal(hist[1].changeType, 'update');
  // snapshot captured the old value
  assert.equal(hist[1].value, 'v1');
});

test('update: reconciles backlinks when value changes', async () => {
  const ds = tmpDs();
  const t1 = await ds.create({ value: 'target1' });
  const t2 = await ds.create({ value: 'target2' });
  const src = await ds.create({ value: `[[${t1.id}]]` });
  assert.ok((await ds.backlinks(t1.id)).includes(src.id));
  await ds.update(src.id, { value: `[[${t2.id}]]` });
  assert.ok(!(await ds.backlinks(t1.id)).includes(src.id), 'old backlink not removed');
  assert.ok((await ds.backlinks(t2.id)).includes(src.id));
});

test('update: reconciles tags', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x', tags: ['old'] });
  await ds.update(item.id, { tags: ['new'] });
  assert.ok(!(await ds.byTag('old')).includes(item.id));
  assert.ok((await ds.byTag('new')).includes(item.id));
});

test('update: changes parent', async () => {
  const ds = tmpDs();
  const p1 = await ds.create({ value: 'parent1' });
  const p2 = await ds.create({ value: 'parent2' });
  const child = await ds.create({ value: 'child', parentId: p1.id });
  const updated = await ds.update(child.id, { parentId: p2.id });
  assert.equal(updated.parentId, p2.id);
});

test('update: changes confidence', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  const updated = await ds.update(item.id, { confidence: 'locked' });
  assert.equal(updated.confidence, 'locked');
});

test('update: removes old type from type index, adds new one', async () => {
  const ds = tmpDs();
  const tid1 = 'aaaaaaaa-bbbb-cccc-dddd-000000000001';
  const tid2 = 'aaaaaaaa-bbbb-cccc-dddd-000000000002';
  const item = await ds.create({ type: 'object', typeId: tid1 });
  assert.ok((await ds.byType(tid1)).includes(item.id));
  await ds.update(item.id, { type: 'object', typeId: tid2 });
  assert.ok(!(await ds.byType(tid1)).includes(item.id));
  assert.ok((await ds.byType(tid2)).includes(item.id));
});

// ─── delete ───────────────────────────────────────────────────────────────────

test('delete: item no longer readable after deletion', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'bye' });
  await ds.delete(item.id);
  assert.equal(await ds.get(item.id), null);
});

test('delete: snapshots with changeType delete before removing', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'ephemeral' });
  await ds.delete(item.id);
  const histDir = ds._adapter._historyDir(item.id);
  const files = fs.readdirSync(histDir).filter(n => n.endsWith('.json'));
  const snapshots = files.map(f => JSON.parse(fs.readFileSync(path.join(histDir, f), 'utf8')));
  const del = snapshots.find(s => s.changeType === 'delete');
  assert.ok(del, 'no delete snapshot found');
  assert.equal(del.value, 'ephemeral');
});

test('delete: cleans up tag index entries', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x', tags: ['mytag'] });
  assert.ok((await ds.byTag('mytag')).includes(item.id));
  await ds.delete(item.id);
  assert.ok(!(await ds.byTag('mytag')).includes(item.id));
});

test('delete: cleans up type index entries', async () => {
  const ds = tmpDs();
  const tid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const item = await ds.create({ type: 'object', typeId: tid });
  assert.ok((await ds.byType(tid)).includes(item.id));
  await ds.delete(item.id);
  assert.ok(!(await ds.byType(tid)).includes(item.id));
});

test('delete: returns warnings when item has backlinks', async () => {
  const ds = tmpDs();
  const target = await ds.create({ value: 'target' });
  await ds.create({ value: `[[${target.id}]]` });
  const { warnings } = await ds.delete(target.id);
  assert.ok(warnings.some(w => w.includes('backlink') || w.includes('link')));
});

test('delete: returns warnings when item has inbound relationships', async () => {
  const ds = tmpDs();
  const a = await ds.create({ value: 'a' });
  const b = await ds.create({ value: 'b' });
  await ds.relate(a.id, 'depends-on', b.id);
  const { warnings } = await ds.delete(b.id);
  assert.ok(warnings.some(w => w.includes('relationship')));
});

test('delete: returns empty warnings when no references', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'isolated' });
  const { warnings } = await ds.delete(item.id);
  assert.equal(warnings.length, 0);
});

// ─── annotations ──────────────────────────────────────────────────────────────

test('annotate: creates annotation file', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  const ann = await ds.annotate(item.id, { content: 'my note' });
  assert.match(ann.id, UUID_RE);
  assert.equal(ann.targetId, item.id);
  assert.equal(ann.content, 'my note');
  assert.equal(ann.parentAnnotationId, null);
});

test('annotations: returns both annotations sorted deterministically', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  const a1 = await ds.annotate(item.id, { content: 'first' });
  const a2 = await ds.annotate(item.id, { content: 'second' });
  const list = await ds.annotations(item.id);
  assert.equal(list.length, 2);
  const ids = list.map(a => a.id);
  assert.ok(ids.includes(a1.id));
  assert.ok(ids.includes(a2.id));
  // Verify sort is stable: same result on repeated call
  const list2 = await ds.annotations(item.id);
  assert.deepEqual(list.map(a => a.id), list2.map(a => a.id));
});

test('annotate: supports threaded reply', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  const parent = await ds.annotate(item.id, { content: 'parent' });
  const reply = await ds.annotate(item.id, { content: 'reply', parentAnnotationId: parent.id });
  assert.equal(reply.parentAnnotationId, parent.id);
});

test('annotations: returns empty array when none exist', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  assert.deepEqual(await ds.annotations(item.id), []);
});

// ─── relationships ────────────────────────────────────────────────────────────

test('relate: creates outbound entry on source', async () => {
  const ds = tmpDs();
  const a = await ds.create({ value: 'a' });
  const b = await ds.create({ value: 'b' });
  const rel = await ds.relate(a.id, 'depends-on', b.id, { note: 'because' });
  const rels = await ds.relationships(a.id);
  assert.equal(rels.outbound.length, 1);
  assert.equal(rels.outbound[0].targetId, b.id);
  assert.equal(rels.outbound[0].type, 'depends-on');
  assert.equal(rels.outbound[0].note, 'because');
});

test('relate: creates inbound entry on target', async () => {
  const ds = tmpDs();
  const a = await ds.create({ value: 'a' });
  const b = await ds.create({ value: 'b' });
  await ds.relate(a.id, 'enables', b.id);
  const rels = await ds.relationships(b.id);
  assert.equal(rels.inbound.length, 1);
  assert.equal(rels.inbound[0].sourceId, a.id);
  assert.equal(rels.inbound[0].type, 'enables');
});

test('relate: both entries share the same relationship ID', async () => {
  const ds = tmpDs();
  const a = await ds.create({ value: 'a' });
  const b = await ds.create({ value: 'b' });
  const rel = await ds.relate(a.id, 'blocks', b.id);
  const srcRels = await ds.relationships(a.id);
  const tgtRels = await ds.relationships(b.id);
  assert.equal(srcRels.outbound[0].id, rel.id);
  assert.equal(tgtRels.inbound[0].id, rel.id);
});

test('relationships: returns empty outbound/inbound when none exist', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  const rels = await ds.relationships(item.id);
  assert.deepEqual(rels.outbound, []);
  assert.deepEqual(rels.inbound, []);
});

// ─── backlinks ────────────────────────────────────────────────────────────────

test('backlinks: returns empty array when no links', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x' });
  assert.deepEqual(await ds.backlinks(item.id), []);
});

test('backlinks: multiple inbound links tracked', async () => {
  const ds = tmpDs();
  const target = await ds.create({ value: 'target' });
  const a = await ds.create({ value: `[[${target.id}]]` });
  const b = await ds.create({ value: `link: [[${target.id}]] text` });
  const links = await ds.backlinks(target.id);
  assert.ok(links.includes(a.id));
  assert.ok(links.includes(b.id));
});

// ─── history ──────────────────────────────────────────────────────────────────

test('history: returns empty array for item with no history dir', async () => {
  const ds = tmpDs();
  assert.deepEqual(await ds.history('ffffffff-ffff-ffff-ffff-ffffffffffff'), []);
});

test('history: create → update → delete produces 3 snapshots with correct changeTypes', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'v1' });
  await ds.update(item.id, { value: 'v2' });
  await ds.delete(item.id);
  const entries = await ds.history(item.id);
  assert.equal(entries.length, 3);
  const types = new Set(entries.map(e => e.changeType));
  assert.ok(types.has('create'));
  assert.ok(types.has('update'));
  assert.ok(types.has('delete'));
});

// ─── byTag ────────────────────────────────────────────────────────────────────

test('byTag: returns empty array when tag unused', async () => {
  const ds = tmpDs();
  assert.deepEqual(await ds.byTag('nope'), []);
});

test('byTag: returns correct item IDs', async () => {
  const ds = tmpDs();
  const a = await ds.create({ value: 'a', tags: ['important'] });
  await ds.create({ value: 'b' });
  const tagged = await ds.byTag('important');
  assert.ok(tagged.includes(a.id));
  assert.equal(tagged.length, 1);
});

// ─── tree ─────────────────────────────────────────────────────────────────────

test('tree: returns all items depth-first sorted by sortOrder', async () => {
  const ds = tmpDs();
  const root = await ds.create({ value: 'root' });
  const c2 = await ds.create({ value: 'c2', parentId: root.id });
  const c1 = await ds.create({ value: 'c1', parentId: root.id, sortOrder: 0 });
  await ds.update(c2.id, { sortOrder: 1 });
  const nodes = await ds.tree(root.id);
  const values = nodes.map(n => n.item.value);
  assert.equal(values[0], 'root');
  assert.equal(values[1], 'c1');
  assert.equal(values[2], 'c2');
});

test('tree: respects maxDepth', async () => {
  const ds = tmpDs();
  const root = await ds.create({ value: 'root' });
  const child = await ds.create({ value: 'child', parentId: root.id });
  await ds.create({ value: 'grandchild', parentId: child.id });
  const nodes = await ds.tree(root.id, 1);
  assert.equal(nodes.length, 2); // root + child, no grandchild
});

test('tree: roots at specific ID when given', async () => {
  const ds = tmpDs();
  const root = await ds.create({ value: 'root' });
  await ds.create({ value: 'other-root' });
  const child = await ds.create({ value: 'child', parentId: root.id });
  const nodes = await ds.tree(root.id);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].item.id, root.id);
  assert.equal(nodes[1].item.id, child.id);
});

// ─── loadAll ──────────────────────────────────────────────────────────────────

test('loadAll: returns all items from sample datastore', async () => {
  const ds = Datastore.open(SAMPLE);
  const items = await ds.loadAll();
  assert.equal(items.length, 40);
});

// ─── rebuildIndexes ───────────────────────────────────────────────────────────

test('rebuildIndexes: repopulates tag index', async () => {
  const ds = tmpDs();
  const item = await ds.create({ value: 'x', tags: ['mytag'] });
  // Corrupt the tag index
  const tagFile = path.join(ds._adapter._shardDir('tags', 'mytag'), 'items.json');
  fs.writeFileSync(tagFile, '{"items":[]}');
  await ds.rebuildIndexes();
  assert.ok((await ds.byTag('mytag')).includes(item.id));
});

test('rebuildIndexes: repopulates backlinks index', async () => {
  const ds = tmpDs();
  const target = await ds.create({ value: 'target' });
  const src = await ds.create({ value: `[[${target.id}]]` });
  // Corrupt backlinks
  const hex = target.id.replace(/-/g, '');
  const linksFile = path.join(ds.k, 'links', hex.slice(0, 2), hex.slice(2, 4), target.id, 'backlinks.json');
  fs.writeFileSync(linksFile, '{"backlinks":[]}');
  await ds.rebuildIndexes();
  assert.ok((await ds.backlinks(target.id)).includes(src.id));
});

test('rebuildIndexes: returns item count', async () => {
  const ds = Datastore.open(SAMPLE);
  const count = await ds.rebuildIndexes();
  assert.equal(count, 40);
});

// ─── Sample datastore (read-only integration) ─────────────────────────────────

test('sample: root item readable by UUID', async () => {
  const ds = Datastore.open(SAMPLE);
  const item = await ds.get(ROOT_ID);
  assert.equal(item.value, 'Base Work Process');
  assert.equal(item.parentId, (await ds.getDataRoot()).id);
  assert.equal(item.type, 'text');
});

test('sample: alias base-work-process resolves to root UUID', async () => {
  const ds = Datastore.open(SAMPLE);
  const id = await ds.resolveAlias('base-work-process');
  assert.equal(id, ROOT_ID);
});

test('sample: tree produces 35 nodes from root', async () => {
  const ds = Datastore.open(SAMPLE);
  const nodes = await ds.tree(ROOT_ID);
  assert.equal(nodes.length, 35);
});

test('sample: children of root are sorted correctly (Clarify first, Principles last)', async () => {
  const ds = Datastore.open(SAMPLE);
  const rootChildren = await ds.children(ROOT_ID);
  assert.equal(rootChildren[0].value, 'Clarify');
  assert.equal(rootChildren[rootChildren.length - 1].value, 'Principles');
});

test('sample: clarify children in order', async () => {
  const ds = Datastore.open(SAMPLE);
  const kids = await ds.children(CLARIFY_ID);
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
  const ds = Datastore.open(SAMPLE);
  const out = cli(ds, 'get', ROOT_ID);
  assert.ok(out.includes(ROOT_ID));
  assert.ok(out.includes('Base Work Process'));
});

test('cli: get by alias resolves correctly', () => {
  const ds = Datastore.open(SAMPLE);
  const out = cli(ds, 'get', 'base-work-process');
  assert.ok(out.includes(ROOT_ID));
});

test('cli: get --json outputs valid JSON', () => {
  const ds = Datastore.open(SAMPLE);
  const out = cli(ds, 'get', ROOT_ID, '--json');
  const parsed = JSON.parse(out);
  assert.equal(parsed.id, ROOT_ID);
});

test('cli: get unknown ID exits non-zero', () => {
  const ds = Datastore.open(SAMPLE);
  const err = cliErr(ds, 'get', 'ffffffff-ffff-ffff-ffff-ffffffffffff');
  assert.ok(err.includes('Not found'));
});

test('cli: tree output is indented tree starting with root', () => {
  const ds = Datastore.open(SAMPLE);
  const out = cli(ds, 'tree', ROOT_ID, '--depth', '1');
  const lines = out.trim().split('\n');
  assert.equal(lines[0], 'Base Work Process');
  assert.ok(lines[1].startsWith('  '));
});

test('cli: tree --ids prefixes each line with UUID', () => {
  const ds = Datastore.open(SAMPLE);
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

test('cli: create with --tag stores tag and tag index', async () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'tagged', '--tag', 'alpha', '--tag', 'beta');
  const match = out.match(/Created: ([0-9a-f-]{36})/);
  const id = match[1];
  const item = await ds.get(id);
  assert.ok(item.tags.includes('alpha'));
  assert.ok(item.tags.includes('beta'));
  assert.ok((await ds.byTag('alpha')).includes(id));
});

test('cli: update changes value', async () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'old value');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'update', id, '--value', 'new value');
  const item = await ds.get(id);
  assert.equal(item.value, 'new value');
});

test('cli: update --add-tag adds tags without removing existing', async () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'x', '--tag', 'existing');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'update', id, '--add-tag', 'new-tag');
  const item = await ds.get(id);
  assert.ok(item.tags.includes('existing'));
  assert.ok(item.tags.includes('new-tag'));
});

test('cli: update --remove-tag removes tag', async () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'x', '--tag', 'remove-me', '--tag', 'keep');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'update', id, '--remove-tag', 'remove-me');
  const item = await ds.get(id);
  assert.ok(!item.tags.includes('remove-me'));
  assert.ok(item.tags.includes('keep'));
});

test('cli: update --confidence sets confidence', async () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'x');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'update', id, '--confidence', 'decided');
  assert.equal((await ds.get(id)).confidence, 'decided');
});

test('cli: delete --force removes item without prompt', async () => {
  const ds = tmpDs();
  const out = cli(ds, 'create', '--value', 'to delete');
  const id = out.match(/Created: ([0-9a-f-]{36})/)[1];
  cli(ds, 'delete', id, '--force');
  assert.equal(await ds.get(id), null);
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
  const ds = Datastore.open(SAMPLE);
  const out = cli(ds, 'export', ROOT_ID, '--depth', '1');
  const lines = out.trim().split('\n');
  assert.equal(lines[0], 'Base Work Process');
  assert.ok(lines[1].startsWith('  '));
});

test('cli: export --ids prefixes every line with UUID', () => {
  const ds = Datastore.open(SAMPLE);
  const out = cli(ds, 'export', ROOT_ID, '--depth', '1', '--ids');
  for (const line of out.trim().split('\n')) {
    assert.match(line.split(' ')[0], UUID_RE);
    assert.ok(line.includes(' | '));
  }
});

test('cli: export --output writes to file', () => {
  const ds = Datastore.open(SAMPLE);
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
  const ds = Datastore.open(SAMPLE);
  const out = cli(ds, 'rebuild-indexes');
  assert.ok(out.includes('40'));
});

// ─── doctor (integrity checks) ────────────────────────────────────────────────

test('cli: doctor reports clean store and exits zero', async () => {
  const ds = tmpDs();
  const { metadata } = await ds.createType('widget');
  await ds.create({ type: 'object', typeId: metadata.id, objectData: { a: 1 } });
  const out = cli(ds, 'doctor');
  assert.match(out, /No integrity problems/);
});

test('cli: doctor flags orphan-type-id and exits non-zero', async () => {
  const ds = tmpDs();
  await ds.create({ type: 'object', typeId: 'deadbeef-0000-4000-8000-000000000000', objectData: {} });
  const out = cliErr(ds, 'doctor'); // exits 1 → cliErr captures stdout
  assert.match(out, /orphan-type-id/);
  assert.match(out, /ERROR/);
  assert.match(out, /no type definition/);
});

test('cli: doctor --json emits the findings array', async () => {
  const ds = tmpDs();
  const orphan = await ds.create({ type: 'object', typeId: 'deadbeef-0000-4000-8000-000000000000', objectData: {} });
  const out = cliErr(ds, 'doctor', '--json'); // exits 1
  const findings = JSON.parse(out);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'orphan-type-id');
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].nodeId, orphan.id);
  assert.equal(findings[0].typeId, 'deadbeef-0000-4000-8000-000000000000');
});

test('cli: doctor --check restricts to a subset', async () => {
  const ds = tmpDs();
  await ds.create({ type: 'object', typeId: 'deadbeef-0000-4000-8000-000000000000', objectData: {} });
  // Restricting to a not-yet-implemented check skips orphan-type-id → clean, exit 0.
  const out = cli(ds, 'doctor', '--check', 'type-index-drift');
  assert.match(out, /No integrity problems/);
});

test('cli: doctor --check orphan-type-id selects the check and finds the orphan', async () => {
  const ds = tmpDs();
  await ds.create({ type: 'object', typeId: 'deadbeef-0000-4000-8000-000000000000', objectData: {} });
  // Explicitly naming the real check must wire through and detect (exit 1).
  const out = cliErr(ds, 'doctor', '--check', 'orphan-type-id');
  assert.match(out, /orphan-type-id/);
  assert.match(out, /no type definition/);
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
