'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const { Datastore } = require('@kanecta/lib');
const app = require('../src/app');


let tmpRoot;
let ds;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  require('./helpers').useConfig(tmpRoot);
  process.env.AUTH_DISABLED = 'true';
  // Block workspace mode so the API uses KANECTA_DATASTORE (filesystem fallback).
  process.env.XDG_CONFIG_HOME = tmpRoot;
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  require('./helpers').clearConfigEnv();
  delete process.env.AUTH_DISABLED;
  delete process.env.XDG_CONFIG_HOME;
});

// ─── Items ────────────────────────────────────────────────────────────────────

describe('GET /items', () => {
  it('returns data_root children', async () => {
    await ds.create({ value: 'root1' });
    await ds.create({ value: 'root2' });
    const child = await ds.create({ value: 'child-parent' });
    await ds.create({ value: 'child', parentId: child.id });
    const res = await request(app).get('/items');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4); // 3 at data_root + seeded "Welcome to Kanecta!" item
    expect(res.body.every(i => i.parentId != null)).toBe(true);
  });

  it('returns just the seeded welcome item when datastore has no user items', async () => {
    const res = await request(app).get('/items');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].value).toBe('Welcome to Kanecta!');
  });
});

describe('POST /items', () => {
  it('creates a root item', async () => {
    const res = await request(app).post('/items').send({ value: 'hello', type: 'string' });
    expect(res.status).toBe(201);
    expect(res.body.value).toBe('hello');
    expect(res.body.type).toBe('string');
    expect(res.body.parentId).toMatch(/^[0-9a-f-]{36}$/); // defaults to data_root
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('creates a child item', async () => {
    const parent = await ds.create({ value: 'parent' });
    const res = await request(app).post('/items').send({ value: 'child', parentId: parent.id });
    expect(res.status).toBe(201);
    expect(res.body.parentId).toBe(parent.id);
  });

  it('sets alias when provided', async () => {
    const res = await request(app).post('/items').send({ value: 'x', alias: 'my-alias' });
    expect(res.status).toBe(201);
    expect(await ds.resolveAlias('my-alias')).toBe(res.body.id);
  });

  it('returns 400 for invalid type', async () => {
    const res = await request(app).post('/items').send({ type: 'nonsense' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid type/);
  });

  it('returns 400 for invalid confidence', async () => {
    const res = await request(app).post('/items').send({ confidence: 'maybe' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid confidence/);
  });

  it('returns 404 for unknown parentId', async () => {
    const res = await request(app).post('/items').send({ parentId: 'ffffffff-ffff-4fff-bfff-ffffffffffff' });
    expect(res.status).toBe(404);
  });
});

describe('GET /items/:id', () => {
  it('returns item by UUID', async () => {
    const item = await ds.create({ value: 'test' });
    const res = await request(app).get(`/items/${item.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(item.id);
    expect(res.body.value).toBe('test');
  });

  it('returns 404 for unknown UUID', async () => {
    const res = await request(app).get('/items/ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Item not found');
  });

  it('returns 400 for malformed UUID', async () => {
    const res = await request(app).get('/items/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid ID format'); // route also accepts synthetic IDs, not just UUIDs
  });
});

describe('PUT /items/:id', () => {
  it('updates item value', async () => {
    const item = await ds.create({ value: 'old' });
    const res = await request(app).put(`/items/${item.id}`).send({ value: 'new' });
    expect(res.status).toBe(200);
    expect(res.body.value).toBe('new');
    expect((await ds.get(item.id)).value).toBe('new');
  });

  it('updates tags', async () => {
    const item = await ds.create({ value: 'x', tags: ['old'] });
    const res = await request(app).put(`/items/${item.id}`).send({ tags: ['new'] });
    expect(res.status).toBe(200);
    expect(await ds.byTag('old')).not.toContain(item.id);
    expect(await ds.byTag('new')).toContain(item.id);
  });

  it('updates confidence', async () => {
    const item = await ds.create({ value: 'x' });
    const res = await request(app).put(`/items/${item.id}`).send({ confidence: 'locked' });
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe('locked');
  });

  it('returns 400 for invalid type', async () => {
    const item = await ds.create({ value: 'x' });
    const res = await request(app).put(`/items/${item.id}`).send({ type: 'bad' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown item', async () => {
    const res = await request(app).put('/items/ffffffff-ffff-4fff-bfff-ffffffffffff').send({ value: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /items/:id', () => {
  it('deletes an item', async () => {
    const item = await ds.create({ value: 'bye' });
    const res = await request(app).delete(`/items/${item.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toEqual([item.id]); // deletion returns the full removed subtree
    expect(await ds.get(item.id)).toBeNull();
  });

  it('returns 409 when item has backlinks without ?force', async () => {
    const target = await ds.create({ value: 'target' });
    await ds.create({ value: `[[${target.id}]]` });
    const res = await request(app).delete(`/items/${target.id}`);
    expect(res.status).toBe(409);
    expect(res.body.warnings).toBeDefined();
  });

  it('deletes with backlinks when ?force=true', async () => {
    const target = await ds.create({ value: 'target' });
    await ds.create({ value: `[[${target.id}]]` });
    const res = await request(app).delete(`/items/${target.id}?force=true`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown item', async () => {
    const res = await request(app).delete('/items/ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(res.status).toBe(404);
  });
});

describe('GET /items/:id/children', () => {
  it('returns sorted children', async () => {
    const parent = await ds.create({ value: 'parent' });
    await ds.create({ value: 'c1', parentId: parent.id, sortOrder: 0 });
    await ds.create({ value: 'c2', parentId: parent.id, sortOrder: 1 });
    const res = await request(app).get(`/items/${parent.id}/children`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].value).toBe('c1');
    expect(res.body[1].value).toBe('c2');
  });

  it('returns empty array for leaf item', async () => {
    const item = await ds.create({ value: 'leaf' });
    const res = await request(app).get(`/items/${item.id}/children`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /items/:id/tree', () => {
  it('returns flat list of tree nodes', async () => {
    const root = await ds.create({ value: 'root' });
    await ds.create({ value: 'child', parentId: root.id });
    const res = await request(app).get(`/items/${root.id}/tree`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].item.id).toBe(root.id);
    expect(res.body[0].depth).toBe(0);
    expect(res.body[1].depth).toBe(1);
  });

  it('respects ?depth', async () => {
    const root = await ds.create({ value: 'root' });
    const child = await ds.create({ value: 'child', parentId: root.id });
    await ds.create({ value: 'grandchild', parentId: child.id });
    const res = await request(app).get(`/items/${root.id}/tree?depth=1`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

describe('GET /items/:id/annotations', () => {
  it('returns annotations', async () => {
    const item = await ds.create({ value: 'x' });
    await ds.annotate(item.id, { content: 'a note' });
    const res = await request(app).get(`/items/${item.id}/annotations`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].content).toBe('a note');
  });

  it('returns empty array when no annotations', async () => {
    const item = await ds.create({ value: 'x' });
    const res = await request(app).get(`/items/${item.id}/annotations`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /items/:id/annotations', () => {
  it('creates an annotation', async () => {
    const item = await ds.create({ value: 'x' });
    const res = await request(app)
      .post(`/items/${item.id}/annotations`)
      .send({ content: 'my note' });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe('my note');
    expect(res.body.targetId).toBe(item.id);
  });

  it('returns 400 when content is missing', async () => {
    const item = await ds.create({ value: 'x' });
    const res = await request(app).post(`/items/${item.id}/annotations`).send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /items/:id/relationships', () => {
  it('returns outbound and inbound relationships', async () => {
    const a = await ds.create({ value: 'a' });
    const b = await ds.create({ value: 'b' });
    await ds.relate(a.id, 'depends-on', b.id);
    const resA = await request(app).get(`/items/${a.id}/relationships`);
    expect(resA.status).toBe(200);
    expect(resA.body.outbound).toHaveLength(1);
    expect(resA.body.outbound[0].type).toBe('depends-on');
    const resB = await request(app).get(`/items/${b.id}/relationships`);
    expect(resB.body.inbound).toHaveLength(1);
  });
});

describe('GET /items/:id/backlinks', () => {
  it('returns IDs of items that link here', async () => {
    const target = await ds.create({ value: 'target' });
    const linker = await ds.create({ value: `[[${target.id}]]` });
    const res = await request(app).get(`/items/${target.id}/backlinks`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(linker.id);
  });
});

describe('GET /items/:id/history', () => {
  it('returns history snapshots', async () => {
    const item = await ds.create({ value: 'v1' });
    await ds.update(item.id, { value: 'v2' });
    const res = await request(app).get(`/items/${item.id}/history`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const types = res.body.map(h => h.changeType);
    expect(types).toContain('create');
    expect(types).toContain('update');
  });
});

// ─── Tree ─────────────────────────────────────────────────────────────────────

describe('GET /tree', () => {
  it('returns full tree from all roots', async () => {
    const root = await ds.create({ value: 'root' });
    await ds.create({ value: 'child', parentId: root.id });
    const res = await request(app).get('/tree');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3); // root + child + the seeded "Welcome to Kanecta!" item
  });

  it('respects ?depth', async () => {
    const root = await ds.create({ value: 'root' });
    const child = await ds.create({ value: 'child', parentId: root.id });
    await ds.create({ value: 'grandchild', parentId: child.id });
    const res = await request(app).get('/tree?depth=1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3); // welcome item + root + child (grandchild excluded by depth)
  });

  it('returns just the seeded welcome item for an otherwise-empty datastore', async () => {
    const res = await request(app).get('/tree');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].item.value).toBe('Welcome to Kanecta!');
  });
});

// ─── Aliases ──────────────────────────────────────────────────────────────────

describe('GET /aliases', () => {
  it('returns all aliases sorted', async () => {
    const a = await ds.create({ value: 'a' });
    const b = await ds.create({ value: 'b' });
    await ds.setAlias('zzz', a.id);
    await ds.setAlias('aaa', b.id);
    const res = await request(app).get('/aliases');
    expect(res.status).toBe(200);
    expect(res.body[0].alias).toBe('aaa');
    expect(res.body[1].alias).toBe('zzz');
  });
});

describe('GET /aliases/:alias', () => {
  it('resolves alias to targetId', async () => {
    const item = await ds.create({ value: 'x' });
    await ds.setAlias('my-alias', item.id);
    const res = await request(app).get('/aliases/my-alias');
    expect(res.status).toBe(200);
    expect(res.body.targetId).toBe(item.id);
  });

  it('returns 404 for unknown alias', async () => {
    const res = await request(app).get('/aliases/nope');
    expect(res.status).toBe(404);
  });
});

describe('POST /aliases', () => {
  it('sets an alias', async () => {
    const item = await ds.create({ value: 'x' });
    const res = await request(app).post('/aliases').send({ alias: 'new-alias', targetId: item.id });
    expect(res.status).toBe(201);
    expect(await ds.resolveAlias('new-alias')).toBe(item.id);
  });

  it('returns 400 when alias is missing', async () => {
    const item = await ds.create({ value: 'x' });
    const res = await request(app).post('/aliases').send({ targetId: item.id });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown targetId', async () => {
    const res = await request(app).post('/aliases').send({ alias: 'x', targetId: 'ffffffff-ffff-4fff-bfff-ffffffffffff' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /aliases/:alias', () => {
  it('removes alias', async () => {
    const item = await ds.create({ value: 'x' });
    await ds.setAlias('gone', item.id);
    const res = await request(app).delete('/aliases/gone');
    expect(res.status).toBe(200);
    expect(await ds.resolveAlias('gone')).toBeNull();
  });

  it('returns 404 for unknown alias', async () => {
    const res = await request(app).delete('/aliases/nope');
    expect(res.status).toBe(404);
  });
});

// ─── Relationships ────────────────────────────────────────────────────────────

describe('POST /relationships', () => {
  it('creates a relationship', async () => {
    const a = await ds.create({ value: 'a' });
    const b = await ds.create({ value: 'b' });
    const res = await request(app).post('/relationships').send({
      sourceId: a.id, type: 'depends-on', targetId: b.id, note: 'reason',
    });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('depends-on');
    expect(res.body.note).toBe('reason');
  });

  it('returns 400 for invalid type', async () => {
    const a = await ds.create({ value: 'a' });
    const b = await ds.create({ value: 'b' });
    const res = await request(app).post('/relationships').send({
      sourceId: a.id, type: 'made-up', targetId: b.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid relationship type/);
  });

  it('returns 400 when required fields missing', async () => {
    const res = await request(app).post('/relationships').send({ sourceId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
  });
});

// ─── Tags ─────────────────────────────────────────────────────────────────────

describe('GET /tags/:tag', () => {
  it('returns item IDs with the tag', async () => {
    const a = await ds.create({ value: 'a', tags: ['featured'] });
    await ds.create({ value: 'b' });
    const res = await request(app).get('/tags/featured');
    expect(res.status).toBe(200);
    expect(res.body).toContain(a.id);
    expect(res.body).toHaveLength(1);
  });

  it('returns empty array for unused tag', async () => {
    const res = await request(app).get('/tags/nope');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── Rebuild indexes ──────────────────────────────────────────────────────────

describe('POST /rebuild-indexes', () => {
  it('rebuilds indexes and returns item count', async () => {
    await ds.create({ value: 'a' });
    await ds.create({ value: 'b' });
    const res = await request(app).post('/rebuild-indexes');
    expect(res.status).toBe(200);
    expect(res.body.rebuilt).toBe(true);
    expect(res.body.itemCount).toBeGreaterThanOrEqual(2); // includes well-known root nodes
  });
});

// ─── Multi-level tree integration ────────────────────────────────────────────

describe('multi-level tree integration', () => {
  let rootId;
  let child1Id;

  beforeEach(async () => {
    const root = await ds.create({ value: 'Project Alpha' });
    rootId = root.id;
    await ds.setAlias('project-alpha', rootId);
    const c1 = await ds.create({ value: 'Phase 1', parentId: rootId, sortOrder: 0 });
    child1Id = c1.id;
    const c2 = await ds.create({ value: 'Phase 2', parentId: rootId, sortOrder: 1 });
    await ds.create({ value: 'Task A', parentId: c1.id, sortOrder: 0 });
    await ds.create({ value: 'Task B', parentId: c1.id, sortOrder: 1 });
    await ds.create({ value: 'Task C', parentId: c2.id, sortOrder: 0 });
  });

  it('GET /items returns data_root children', async () => {
    const res = await request(app).get('/items');
    expect(res.status).toBe(200);
    // data_root children: Welcome item + Project Alpha
    expect(res.body.some(i => i.value === 'Project Alpha')).toBe(true);
    expect(res.body.every(i => i.parentId != null)).toBe(true);
  });

  it('GET /items/:id/children returns sorted phases', async () => {
    const res = await request(app).get(`/items/${rootId}/children`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].value).toBe('Phase 1');
    expect(res.body[1].value).toBe('Phase 2');
  });

  it('GET /items/:id/tree returns all 6 nodes (root + 5 descendants)', async () => {
    const res = await request(app).get(`/items/${rootId}/tree`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
    expect(res.body[0].item.id).toBe(rootId);
    expect(res.body[0].depth).toBe(0);
  });

  it('GET /aliases/project-alpha resolves to root UUID', async () => {
    const res = await request(app).get('/aliases/project-alpha');
    expect(res.status).toBe(200);
    expect(res.body.targetId).toBe(rootId);
  });

  it('GET /tree includes all nodes with correct depths', async () => {
    const res = await request(app).get('/tree');
    expect(res.status).toBe(200);
    const values = res.body.map(n => n.item.value);
    expect(values).toContain('Project Alpha');
    expect(values).toContain('Phase 1');
    expect(values).toContain('Task A');
    const alpha = res.body.find(n => n.item.value === 'Project Alpha');
    const taskA = res.body.find(n => n.item.value === 'Task A');
    expect(alpha.depth).toBe(0);
    expect(taskA.depth).toBe(2);
  });
});

// ─── Search ───────────────────────────────────────────────────────────────────

describe('GET /search', () => {
  it('requires q parameter', async () => {
    const res = await request(app).get('/search');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('q is required');
  });

  it('validates limit is positive integer', async () => {
    const res = await request(app).get('/search?q=test&limit=0');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('limit must be a positive integer');
  });

  it('validates rootId uuid format and existence', async () => {
    const res1 = await request(app).get('/search?q=test&rootId=bad-uuid');
    expect(res1.status).toBe(400);
    expect(res1.body.error).toBe('Invalid UUID format for rootId');

    const res2 = await request(app).get('/search?q=test&rootId=ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(res2.status).toBe(404);
    expect(res2.body.error).toContain('rootId not found');
  });

  it('searches item value case-insensitively', async () => {
    await ds.create({ value: 'Find Me Here' });
    await ds.create({ value: 'Other node' });

    const res = await request(app).get('/search?q=find');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].value).toBe('Find Me Here');
  });

  it('searches objectData fields', async () => {
    const typeId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const hex = typeId.replace(/-/g, '');
    fs.mkdirSync(path.join(ds.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId), { recursive: true });
    fs.writeFileSync(
      path.join(ds.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId, 'metadata.json'),
      JSON.stringify({ id: typeId, value: 'mycustomtype' })
    );

    const item = await ds.create({
      type: 'object',
      typeId,
      value: 'Parent node',
      objectData: { description: 'This matches swipe actions', severity: 'P1' }
    });

    const res = await request(app).get('/search?q=swipe');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].id).toBe(item.id);
  });

  it('searches objectData array fields', async () => {
    const typeId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const hex = typeId.replace(/-/g, '');
    fs.mkdirSync(path.join(ds.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId), { recursive: true });
    fs.writeFileSync(
      path.join(ds.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId, 'metadata.json'),
      JSON.stringify({ id: typeId, value: 'mycustomtype' })
    );

    const item = await ds.create({
      type: 'object',
      typeId,
      value: 'Parent node',
      objectData: { tags: ['bug', 'ui', 'frontend'] }
    });

    const res = await request(app).get('/search?q=front');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].id).toBe(item.id);
  });

  it('supports fields query parameter to restrict objectData fields', async () => {
    const typeId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const hex = typeId.replace(/-/g, '');
    fs.mkdirSync(path.join(ds.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId), { recursive: true });
    fs.writeFileSync(
      path.join(ds.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId, 'metadata.json'),
      JSON.stringify({ id: typeId, value: 'mycustomtype' })
    );

    const item = await ds.create({
      type: 'object',
      typeId,
      value: 'Parent node',
      objectData: { description: 'matches search query', severity: 'P1' }
    });

    const res1 = await request(app).get('/search?q=matches&fields=severity');
    expect(res1.status).toBe(200);
    expect(res1.body.results).toHaveLength(0);

    const res2 = await request(app).get('/search?q=matches&fields=severity,description');
    expect(res2.status).toBe(200);
    expect(res2.body.results).toHaveLength(1);
    expect(res2.body.results[0].id).toBe(item.id);
  });

  it('respects rootId subtree scoping', async () => {
    const typeId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const hex = typeId.replace(/-/g, '');
    fs.mkdirSync(path.join(ds.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId), { recursive: true });
    fs.writeFileSync(
      path.join(ds.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId, 'metadata.json'),
      JSON.stringify({ id: typeId, value: 'mycustomtype' })
    );

    const r1 = await ds.create({ value: 'r1' });
    const r2 = await ds.create({ value: 'r2' });

    const item1 = await ds.create({
      parentId: r1.id,
      type: 'object',
      typeId,
      value: 'item1',
      objectData: { description: 'this matches target text' }
    });

    await ds.create({
      parentId: r2.id,
      type: 'object',
      typeId,
      value: 'item2',
      objectData: { description: 'this also matches target text' }
    });

    const res = await request(app).get(`/search?q=target&rootId=${r1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].id).toBe(item1.id);
  });
});
