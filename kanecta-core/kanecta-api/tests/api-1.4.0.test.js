'use strict';

/**
 * Tests for kanecta-api 1.4.0 features:
 *  - POST /items/:id/soft-delete
 *  - POST /items/:id/restore
 *  - GET/PUT/DELETE /items/:id/time
 *  - PUT /items/:id: expiresAt, connectorId, materialized, cachedAt
 *  - GET /search: excludes soft-deleted by default, includeDeleted param
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const request = require('supertest');
const { Datastore } = require('@kanecta/lib');
const app = require('../src/app');

let tmpRoot;
let ds;

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-1.4.0-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  require('./helpers').useConfig(tmpRoot);
  process.env.AUTH_DISABLED = 'true';
  // Point XDG_CONFIG_HOME at the empty tmpRoot so readAppConfig() returns null
  // and the API falls through to filesystem mode (KANECTA_DATASTORE). Without
  // this, the real ~/.config/kanecta/config.json triggers workspace mode and
  // the test datastore is never used.
  process.env.XDG_CONFIG_HOME = tmpRoot;
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  require('./helpers').clearConfigEnv();
  delete process.env.AUTH_DISABLED;
  delete process.env.XDG_CONFIG_HOME;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createItem(opts = {}) {
  return await ds.create({ type: 'string', ...opts });
}

// ─── PUT /items/:id: 1.4.0 meta fields ───────────────────────────────────────

describe('PUT /items/:id: 1.4.0 meta fields', () => {
  it('sets expiresAt', async () => {
    const item = await createItem({ value: 'x' });
    const ts = new Date(Date.now() + 86400_000).toISOString();
    const res = await request(app).put(`/items/${item.id}`).send({ expiresAt: ts });
    expect(res.status).toBe(200);
    expect(res.body.expiresAt).toBe(ts);
  });

  it('clears expiresAt by sending null', async () => {
    const item = await createItem({ value: 'x' });
    const ts = new Date(Date.now() + 86400_000).toISOString();
    await request(app).put(`/items/${item.id}`).send({ expiresAt: ts });
    const res = await request(app).put(`/items/${item.id}`).send({ expiresAt: null });
    expect(res.status).toBe(200);
    expect(res.body.expiresAt).toBeNull();
  });

  it('sets connectorId', async () => {
    const item = await createItem({ value: 'cached' });
    const connId = '7c4e9a21-83bf-4d6a-b501-2e8f0c3d9a47';
    const res = await request(app).put(`/items/${item.id}`).send({ connectorId: connId });
    expect(res.status).toBe(200);
    expect(res.body.connectorId).toBe(connId);
  });

  it('clears connectorId by sending null', async () => {
    const item = await createItem({ value: 'x' });
    const connId = '7c4e9a21-83bf-4d6a-b501-2e8f0c3d9a47';
    await request(app).put(`/items/${item.id}`).send({ connectorId: connId });
    const res = await request(app).put(`/items/${item.id}`).send({ connectorId: null });
    expect(res.status).toBe(200);
    expect(res.body.connectorId).toBeNull();
  });

  it('sets materialized:false (stub)', async () => {
    const item = await createItem({ value: 'stub' });
    const res = await request(app).put(`/items/${item.id}`).send({ materialized: false });
    expect(res.status).toBe(200);
    expect(res.body.materialized).toBe(false);
  });

  it('sets materialized:null (native)', async () => {
    const item = await createItem({ value: 'x' });
    await request(app).put(`/items/${item.id}`).send({ materialized: false });
    const res = await request(app).put(`/items/${item.id}`).send({ materialized: null });
    expect(res.status).toBe(200);
    expect(res.body.materialized).toBeNull();
  });

  it('sets cachedAt', async () => {
    const item = await createItem({ value: 'x' });
    const now = new Date().toISOString();
    const res = await request(app).put(`/items/${item.id}`).send({ cachedAt: now });
    expect(res.status).toBe(200);
    expect(res.body.cachedAt).toBe(now);
  });

  it('can set all 1.4.0 meta fields in a single call', async () => {
    const item = await createItem({ value: 'combined' });
    const ts = new Date(Date.now() + 3600_000).toISOString();
    const connId = '7c4e9a21-83bf-4d6a-b501-2e8f0c3d9a47';
    const now = new Date().toISOString();
    const res = await request(app).put(`/items/${item.id}`).send({
      expiresAt: ts,
      connectorId: connId,
      materialized: false,
      cachedAt: now,
    });
    expect(res.status).toBe(200);
    expect(res.body.expiresAt).toBe(ts);
    expect(res.body.connectorId).toBe(connId);
    expect(res.body.materialized).toBe(false);
    expect(res.body.cachedAt).toBe(now);
  });
});

// ─── POST /items/:id/soft-delete ──────────────────────────────────────────────

describe('POST /items/:id/soft-delete', () => {
  it('returns 200 and sets deletedAt', async () => {
    const item = await createItem({ value: 'doomed' });
    const res = await request(app).post(`/items/${item.id}/soft-delete`).send({});
    expect(res.status).toBe(200);
    expect(res.body.deletedAt).toBeTruthy();
    expect(new Date(res.body.deletedAt).toISOString()).toBe(res.body.deletedAt);
  });

  it('item data is retained after soft-delete', async () => {
    const item = await createItem({ value: 'retained' });
    await request(app).post(`/items/${item.id}/soft-delete`).send({});
    const fetched = await ds.get(item.id);
    expect(fetched).not.toBeNull();
    expect(fetched.value).toBe('retained');
    expect(fetched.deletedAt).toBeTruthy();
  });

  it('item is still accessible via GET /items/:id after soft-delete', async () => {
    const item = await createItem({ value: 'still-gettable' });
    await request(app).post(`/items/${item.id}/soft-delete`).send({});
    const res = await request(app).get(`/items/${item.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deletedAt).toBeTruthy();
  });

  it('returns 404 for unknown UUID', async () => {
    const res = await request(app).post('/items/ffffffff-ffff-4fff-bfff-ffffffffffff/soft-delete').send({});
    expect(res.status).toBe(404);
  });

  it('returns 400 for malformed UUID', async () => {
    const res = await request(app).post('/items/not-a-uuid/soft-delete').send({});
    expect(res.status).toBe(400);
  });

  it('records a snapshot in item history', async () => {
    const item = await createItem({ value: 'historycheck' });
    await request(app).post(`/items/${item.id}/soft-delete`).send({});
    const history = await ds.history(item.id);
    const types = history.map(h => h.changeType);
    expect(types).toContain('soft-delete');
  });
});

// ─── POST /items/:id/restore ──────────────────────────────────────────────────

describe('POST /items/:id/restore', () => {
  it('returns 200 and clears deletedAt', async () => {
    const item = await createItem({ value: 'recoverable' });
    await request(app).post(`/items/${item.id}/soft-delete`).send({});
    const res = await request(app).post(`/items/${item.id}/restore`).send({});
    expect(res.status).toBe(200);
    expect(res.body.deletedAt).toBeNull();
  });

  it('restored item is visible in GET /items/:id/children', async () => {
    const parent = await createItem({ value: 'parent' });
    const child = await createItem({ value: 'child', parentId: parent.id });
    await request(app).post(`/items/${child.id}/soft-delete`).send({});
    await request(app).post(`/items/${child.id}/restore`).send({});
    const res = await request(app).get(`/items/${parent.id}/children`);
    expect(res.status).toBe(200);
    const values = res.body.map(i => i.value);
    expect(values).toContain('child');
  });

  it('restoring a non-deleted item does not error', async () => {
    const item = await createItem({ value: 'fine' });
    const res = await request(app).post(`/items/${item.id}/restore`).send({});
    expect(res.status).toBe(200);
    expect(res.body.deletedAt).toBeNull();
  });

  it('records a snapshot in item history', async () => {
    const item = await createItem({ value: 'historycheck' });
    await request(app).post(`/items/${item.id}/soft-delete`).send({});
    await request(app).post(`/items/${item.id}/restore`).send({});
    const history = await ds.history(item.id);
    const types = history.map(h => h.changeType);
    expect(types).toContain('restore');
  });

  it('returns 404 for unknown UUID', async () => {
    const res = await request(app).post('/items/ffffffff-ffff-4fff-bfff-ffffffffffff/restore').send({});
    expect(res.status).toBe(404);
  });

  it('returns 400 for malformed UUID', async () => {
    const res = await request(app).post('/items/not-a-uuid/restore').send({});
    expect(res.status).toBe(400);
  });
});

// ─── GET /items/:id/time ──────────────────────────────────────────────────────

describe('GET /items/:id/time', () => {
  it('returns empty object when no time.json exists', async () => {
    const item = await createItem({ value: 'no-time' });
    const res = await request(app).get(`/items/${item.id}/time`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('returns time data after PUT /items/:id/time', async () => {
    const item = await createItem({ value: 'temporal' });
    const timeData = {
      main: { startAt: '2026-07-01T09:00:00Z', endAt: null, recurrenceRule: null, recurrenceExceptions: [], completedAt: null },
    };
    await request(app).put(`/items/${item.id}/time`).send(timeData);
    const res = await request(app).get(`/items/${item.id}/time`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(timeData);
  });

  it('returns 404 for unknown UUID', async () => {
    const res = await request(app).get('/items/ffffffff-ffff-4fff-bfff-ffffffffffff/time');
    expect(res.status).toBe(404);
  });

  it('returns 400 for malformed UUID', async () => {
    const res = await request(app).get('/items/not-a-uuid/time');
    expect(res.status).toBe(400);
  });
});

// ─── PUT /items/:id/time ──────────────────────────────────────────────────────

describe('PUT /items/:id/time', () => {
  it('writes a single temporal context', async () => {
    const item = await createItem({ value: 'ev' });
    const timeData = {
      main: { startAt: '2026-08-01T10:00:00Z', endAt: '2026-08-01T11:00:00Z', recurrenceRule: null, recurrenceExceptions: [], completedAt: null },
    };
    const res = await request(app).put(`/items/${item.id}/time`).send(timeData);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const fetched = await ds.readTimeJson(item.id);
    expect(fetched).toMatchObject(timeData);
  });

  it('writes multiple temporal contexts', async () => {
    const item = await createItem({ value: 'multi' });
    const timeData = {
      main:    { startAt: '2026-07-01T00:00:00Z', endAt: null, recurrenceRule: null, recurrenceExceptions: [], completedAt: null },
      review:  { startAt: null, endAt: null, recurrenceRule: 'FREQ=QUARTERLY', recurrenceExceptions: [], completedAt: null },
      renewal: { startAt: null, endAt: '2027-06-01T00:00:00Z', recurrenceRule: null, recurrenceExceptions: [], completedAt: null },
    };
    const res = await request(app).put(`/items/${item.id}/time`).send(timeData);
    expect(res.status).toBe(200);
    const fetched = await ds.readTimeJson(item.id);
    expect(Object.keys(fetched)).toEqual(['main', 'review', 'renewal']);
  });

  it('overwrites previous time data', async () => {
    const item = await createItem({ value: 'overwrite' });
    const first = { main: { startAt: '2026-01-01T00:00:00Z', endAt: null, recurrenceRule: null, recurrenceExceptions: [], completedAt: null } };
    const second = { review: { startAt: null, endAt: null, recurrenceRule: 'FREQ=MONTHLY', recurrenceExceptions: [], completedAt: null } };
    await request(app).put(`/items/${item.id}/time`).send(first);
    await request(app).put(`/items/${item.id}/time`).send(second);
    const fetched = await ds.readTimeJson(item.id);
    expect(fetched).not.toHaveProperty('main');
    expect(fetched).toHaveProperty('review');
  });

  it('returns 400 for array body', async () => {
    const item = await createItem({ value: 'x' });
    const res = await request(app).put(`/items/${item.id}/time`).send([]);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown UUID', async () => {
    const res = await request(app)
      .put('/items/ffffffff-ffff-4fff-bfff-ffffffffffff/time')
      .send({ main: { startAt: '2026-07-01T00:00:00Z', endAt: null, recurrenceRule: null, recurrenceExceptions: [], completedAt: null } });
    expect(res.status).toBe(404);
  });

  it('returns 400 for malformed UUID', async () => {
    const res = await request(app).put('/items/not-a-uuid/time').send({});
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /items/:id/time ───────────────────────────────────────────────────

describe('DELETE /items/:id/time', () => {
  it('removes time.json so subsequent GET returns empty object', async () => {
    const item = await createItem({ value: 'removable' });
    const timeData = { main: { startAt: '2026-07-01T00:00:00Z', endAt: null, recurrenceRule: null, recurrenceExceptions: [], completedAt: null } };
    await request(app).put(`/items/${item.id}/time`).send(timeData);
    const del = await request(app).delete(`/items/${item.id}/time`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
    const get = await request(app).get(`/items/${item.id}/time`);
    expect(get.body).toEqual({});
  });

  it('deleting non-existent time.json is not an error', async () => {
    const item = await createItem({ value: 'x' });
    const res = await request(app).delete(`/items/${item.id}/time`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown UUID', async () => {
    const res = await request(app).delete('/items/ffffffff-ffff-4fff-bfff-ffffffffffff/time');
    expect(res.status).toBe(404);
  });

  it('returns 400 for malformed UUID', async () => {
    const res = await request(app).delete('/items/not-a-uuid/time');
    expect(res.status).toBe(400);
  });
});

// ─── GET /search: soft-delete awareness ──────────────────────────────────────

describe('GET /search: soft-delete filtering', () => {
  it('excludes soft-deleted items from search by default', async () => {
    await createItem({ value: 'findable' });
    const hidden = await createItem({ value: 'hidden-but-findable' });
    await ds.softDelete(hidden.id);

    const res = await request(app).get('/search?q=findable');
    expect(res.status).toBe(200);
    const values = res.body.results.map(r => r.value);
    expect(values).toContain('findable');
    expect(values).not.toContain('hidden-but-findable');
  });

  it('includes soft-deleted items when ?includeDeleted=true', async () => {
    const hidden = await createItem({ value: 'soft-deleted-item' });
    await ds.softDelete(hidden.id);

    const res = await request(app).get('/search?q=soft-deleted-item&includeDeleted=true');
    expect(res.status).toBe(200);
    const values = res.body.results.map(r => r.value);
    expect(values).toContain('soft-deleted-item');
  });

  it('count field reflects only non-deleted results by default', async () => {
    await createItem({ value: 'visible result' });
    const hidden = await createItem({ value: 'hidden result' });
    await ds.softDelete(hidden.id);

    const res = await request(app).get('/search?q=result');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});

// ─── GET /items/stats ─────────────────────────────────────────────────────────

describe('GET /items/stats', () => {
  it('returns no structured items and no typedCount for a fresh datastore', async () => {
    const res = await request(app).get('/items/stats');
    expect(res.status).toBe(200);
    expect(res.body.typedCount).toBe(0);
    expect(res.body.structured).toEqual([]);
  });

  it('counts primitive items in unstructured', async () => {
    const baseline = await request(app).get('/items/stats');
    const baseTotal = baseline.body.total;

    await createItem({ type: 'string', value: 'a' });
    await createItem({ type: 'string', value: 'b' });
    await createItem({ type: 'number', value: '42' });

    const res = await request(app).get('/items/stats');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(baseTotal + 3);
    expect(res.body.typedCount).toBe(0);

    const stringRow = res.body.unstructured.find(r => r.type === 'string');
    const numberRow = res.body.unstructured.find(r => r.type === 'number');
    expect(stringRow?.count).toBe(2);
    expect(numberRow?.count).toBe(1);
  });

  it('shows type name (not UUID) for structured objects', async () => {
    const { metadata } = await ds.createType('Widget');
    const typeId = metadata.id;
    await ds.create({ type: 'object', typeId, value: 'w1' });
    await ds.create({ type: 'object', typeId, value: 'w2' });

    const res = await request(app).get('/items/stats');
    expect(res.status).toBe(200);
    expect(res.body.typedCount).toBe(2);

    const row = res.body.structured.find(r => r.typeId === typeId);
    expect(row).toBeDefined();
    expect(row.name).toBe('Widget');
    expect(row.count).toBe(2);
  });

  it('includes icon from type schema when present', async () => {
    const { metadata } = await ds.createType('Gadget', {
      schema: {
        meta: { icon: 'star', description: 'A gadget', details: '', keywords: '', 'ai-instructions': { claude: '' } },
        jsonSchema: {
          '$schema': 'http://json-schema.org/draft-07/schema#', '$id': '',
          title: 'Gadget', type: 'object', properties: {}, required: [], additionalProperties: false,
        },
      },
    });
    await ds.create({ type: 'object', typeId: metadata.id, value: 'g1' });

    const res = await request(app).get('/items/stats');
    const row = res.body.structured.find(r => r.typeId === metadata.id);
    expect(row.icon).toBe('star');
  });

  it('falls back to typeId when no matching type_def exists', async () => {
    const orphanTypeId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await ds.create({ type: 'object', typeId: orphanTypeId, value: 'orphan' });

    const res = await request(app).get('/items/stats');
    const row = res.body.structured.find(r => r.typeId === orphanTypeId);
    expect(row).toBeDefined();
    expect(row.name).toBe(orphanTypeId);
  });

  it('excludes the reserved root node from total and unstructured', async () => {
    const res = await request(app).get('/items/stats');
    // The reserved root node is created by Datastore.init() and must never appear
    // in the stats output. (1.4.0 has no system_root/app_root/component_root/
    // data_root — those obsolete roots no longer exist.)
    const rootRow = res.body.unstructured.find(r => r.type === 'root');
    expect(rootRow).toBeUndefined();
  });
});
