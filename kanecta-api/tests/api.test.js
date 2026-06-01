'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const { Datastore } = require('@kanecta/lib');
const app = require('../src/app');

const SAMPLE = path.resolve(__dirname, '../../kanecta-datastore-sample');
const ROOT_ID = 'f1a00001-b45e-4c3d-9e7f-000000000001';
const CLARIFY_ID = 'f1a00002-b45e-4c3d-9e7f-000000000001';

let tmpRoot;
let ds;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  process.env.KANECTA_DATASTORE = tmpRoot;
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.KANECTA_DATASTORE;
});

// ─── Items ────────────────────────────────────────────────────────────────────

describe('GET /items', () => {
  it('returns data_root children', async () => {
    ds.create({ value: 'root1' });
    ds.create({ value: 'root2' });
    const child = ds.create({ value: 'root1' });
    ds.create({ value: 'child', parentId: child.id });
    const res = await request(app).get('/items');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.every(i => i.parentId != null)).toBe(true);
  });

  it('returns empty array when datastore has no user items', async () => {
    const res = await request(app).get('/items');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
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
    const parent = ds.create({ value: 'parent' });
    const res = await request(app).post('/items').send({ value: 'child', parentId: parent.id });
    expect(res.status).toBe(201);
    expect(res.body.parentId).toBe(parent.id);
  });

  it('sets alias when provided', async () => {
    const res = await request(app).post('/items').send({ value: 'x', alias: 'my-alias' });
    expect(res.status).toBe(201);
    expect(ds.resolveAlias('my-alias')).toBe(res.body.id);
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
    const item = ds.create({ value: 'test' });
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
    expect(res.body.error).toBe('Invalid UUID format');
  });
});

describe('PUT /items/:id', () => {
  it('updates item value', async () => {
    const item = ds.create({ value: 'old' });
    const res = await request(app).put(`/items/${item.id}`).send({ value: 'new' });
    expect(res.status).toBe(200);
    expect(res.body.value).toBe('new');
    expect(ds.get(item.id).value).toBe('new');
  });

  it('updates tags', async () => {
    const item = ds.create({ value: 'x', tags: ['old'] });
    const res = await request(app).put(`/items/${item.id}`).send({ tags: ['new'] });
    expect(res.status).toBe(200);
    expect(ds.byTag('old')).not.toContain(item.id);
    expect(ds.byTag('new')).toContain(item.id);
  });

  it('updates confidence', async () => {
    const item = ds.create({ value: 'x' });
    const res = await request(app).put(`/items/${item.id}`).send({ confidence: 'locked' });
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe('locked');
  });

  it('returns 400 for invalid type', async () => {
    const item = ds.create({ value: 'x' });
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
    const item = ds.create({ value: 'bye' });
    const res = await request(app).delete(`/items/${item.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(item.id);
    expect(ds.get(item.id)).toBeNull();
  });

  it('returns 409 when item has backlinks without ?force', async () => {
    const target = ds.create({ value: 'target' });
    ds.create({ value: `[[${target.id}]]` });
    const res = await request(app).delete(`/items/${target.id}`);
    expect(res.status).toBe(409);
    expect(res.body.warnings).toBeDefined();
  });

  it('deletes with backlinks when ?force=true', async () => {
    const target = ds.create({ value: 'target' });
    ds.create({ value: `[[${target.id}]]` });
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
    const parent = ds.create({ value: 'parent' });
    ds.create({ value: 'c1', parentId: parent.id, sortOrder: 0 });
    ds.create({ value: 'c2', parentId: parent.id, sortOrder: 1 });
    const res = await request(app).get(`/items/${parent.id}/children`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].value).toBe('c1');
    expect(res.body[1].value).toBe('c2');
  });

  it('returns empty array for leaf item', async () => {
    const item = ds.create({ value: 'leaf' });
    const res = await request(app).get(`/items/${item.id}/children`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /items/:id/tree', () => {
  it('returns flat list of tree nodes', async () => {
    const root = ds.create({ value: 'root' });
    ds.create({ value: 'child', parentId: root.id });
    const res = await request(app).get(`/items/${root.id}/tree`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].item.id).toBe(root.id);
    expect(res.body[0].depth).toBe(0);
    expect(res.body[1].depth).toBe(1);
  });

  it('respects ?depth', async () => {
    const root = ds.create({ value: 'root' });
    const child = ds.create({ value: 'child', parentId: root.id });
    ds.create({ value: 'grandchild', parentId: child.id });
    const res = await request(app).get(`/items/${root.id}/tree?depth=1`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

describe('GET /items/:id/annotations', () => {
  it('returns annotations', async () => {
    const item = ds.create({ value: 'x' });
    ds.annotate(item.id, { content: 'a note' });
    const res = await request(app).get(`/items/${item.id}/annotations`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].content).toBe('a note');
  });

  it('returns empty array when no annotations', async () => {
    const item = ds.create({ value: 'x' });
    const res = await request(app).get(`/items/${item.id}/annotations`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /items/:id/annotations', () => {
  it('creates an annotation', async () => {
    const item = ds.create({ value: 'x' });
    const res = await request(app)
      .post(`/items/${item.id}/annotations`)
      .send({ content: 'my note' });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe('my note');
    expect(res.body.targetId).toBe(item.id);
  });

  it('returns 400 when content is missing', async () => {
    const item = ds.create({ value: 'x' });
    const res = await request(app).post(`/items/${item.id}/annotations`).send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /items/:id/relationships', () => {
  it('returns outbound and inbound relationships', async () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    ds.relate(a.id, 'depends-on', b.id);
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
    const target = ds.create({ value: 'target' });
    const linker = ds.create({ value: `[[${target.id}]]` });
    const res = await request(app).get(`/items/${target.id}/backlinks`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(linker.id);
  });
});

describe('GET /items/:id/history', () => {
  it('returns history snapshots', async () => {
    const item = ds.create({ value: 'v1' });
    ds.update(item.id, { value: 'v2' });
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
    const root = ds.create({ value: 'root' });
    ds.create({ value: 'child', parentId: root.id });
    const res = await request(app).get('/tree');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('respects ?depth', async () => {
    const root = ds.create({ value: 'root' });
    const child = ds.create({ value: 'child', parentId: root.id });
    ds.create({ value: 'grandchild', parentId: child.id });
    const res = await request(app).get('/tree?depth=1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('returns empty array for empty datastore', async () => {
    const res = await request(app).get('/tree');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── Aliases ──────────────────────────────────────────────────────────────────

describe('GET /aliases', () => {
  it('returns all aliases sorted', async () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    ds.setAlias('zzz', a.id);
    ds.setAlias('aaa', b.id);
    const res = await request(app).get('/aliases');
    expect(res.status).toBe(200);
    expect(res.body[0].alias).toBe('aaa');
    expect(res.body[1].alias).toBe('zzz');
  });
});

describe('GET /aliases/:alias', () => {
  it('resolves alias to targetId', async () => {
    const item = ds.create({ value: 'x' });
    ds.setAlias('my-alias', item.id);
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
    const item = ds.create({ value: 'x' });
    const res = await request(app).post('/aliases').send({ alias: 'new-alias', targetId: item.id });
    expect(res.status).toBe(201);
    expect(ds.resolveAlias('new-alias')).toBe(item.id);
  });

  it('returns 400 when alias is missing', async () => {
    const item = ds.create({ value: 'x' });
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
    const item = ds.create({ value: 'x' });
    ds.setAlias('gone', item.id);
    const res = await request(app).delete('/aliases/gone');
    expect(res.status).toBe(200);
    expect(ds.resolveAlias('gone')).toBeNull();
  });

  it('returns 404 for unknown alias', async () => {
    const res = await request(app).delete('/aliases/nope');
    expect(res.status).toBe(404);
  });
});

// ─── Relationships ────────────────────────────────────────────────────────────

describe('POST /relationships', () => {
  it('creates a relationship', async () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
    const res = await request(app).post('/relationships').send({
      sourceId: a.id, type: 'depends-on', targetId: b.id, note: 'reason',
    });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('depends-on');
    expect(res.body.note).toBe('reason');
  });

  it('returns 400 for invalid type', async () => {
    const a = ds.create({ value: 'a' });
    const b = ds.create({ value: 'b' });
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
    const a = ds.create({ value: 'a', tags: ['featured'] });
    ds.create({ value: 'b' });
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
    ds.create({ value: 'a' });
    ds.create({ value: 'b' });
    const res = await request(app).post('/rebuild-indexes');
    expect(res.status).toBe(200);
    expect(res.body.rebuilt).toBe(true);
    expect(res.body.itemCount).toBeGreaterThanOrEqual(2); // includes well-known root nodes
  });
});

// ─── Sample datastore (read-only integration) ─────────────────────────────────

describe('sample datastore', () => {
  beforeEach(() => {
    process.env.KANECTA_DATASTORE = SAMPLE;
  });

  afterEach(() => {
    process.env.KANECTA_DATASTORE = tmpRoot;
  });

  it('GET /items returns data_root children', async () => {
    const res = await request(app).get('/items');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every(i => i.parentId != null)).toBe(true);
  });

  it('GET /items/:id returns known item', async () => {
    const res = await request(app).get(`/items/${ROOT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.value).toBe('Base Work Process');
  });

  it('GET /items/:id/children returns Clarify as first child', async () => {
    const res = await request(app).get(`/items/${ROOT_ID}/children`);
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe(CLARIFY_ID);
  });

  it('GET /items/:id/tree returns all 35 nodes from root', async () => {
    const res = await request(app).get(`/items/${ROOT_ID}/tree`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(35);
  });

  it('GET /aliases/base-work-process resolves to root UUID', async () => {
    const res = await request(app).get('/aliases/base-work-process');
    expect(res.status).toBe(200);
    expect(res.body.targetId).toBe(ROOT_ID);
  });

  it('GET /tree returns 35 nodes total', async () => {
    const res = await request(app).get('/tree');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(35);
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
    ds.create({ value: 'Find Me Here' });
    ds.create({ value: 'Other node' });
    
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

    const item = ds.create({
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

    const item = ds.create({
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

    const item = ds.create({
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

    const r1 = ds.create({ value: 'r1' });
    const r2 = ds.create({ value: 'r2' });

    const item1 = ds.create({
      parentId: r1.id,
      type: 'object',
      typeId,
      value: 'item1',
      objectData: { description: 'this matches target text' }
    });

    ds.create({
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
