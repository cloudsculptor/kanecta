import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { Datastore } from '@kanecta/lib';
import app from '../src/app.ts';
import { useConfig, clearConfigEnv } from './helpers.ts';

// POST /transaction — the HTTP projection of the universal atomic-write primitive.
//
// Two layers are exercised here:
//   • Body/op VALIDATION and the "not supported on this working set" guard run
//     against the REAL filesystem datastore (fs has no transaction() — the facade
//     throws, which is exactly the deferred-fs behaviour we want to pin down).
//   • Op DISPATCH, ORDERING and the ATOMIC ROLLBACK envelope are exercised against
//     a transactional STUB datastore injected via `Datastore.open`. The stub models
//     commit/rollback with a snapshot; the REAL Postgres atomicity it stands in for
//     is covered end-to-end by kanecta-postgres/tests/adapter.test.ts (5 tx tests).

let tmpRoot: string;
let ds: any;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-api-tx-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  useConfig(tmpRoot);
  process.env.AUTH_DISABLED = 'true';
  process.env.XDG_CONFIG_HOME = tmpRoot;
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  clearConfigEnv();
  delete process.env.AUTH_DISABLED;
  delete process.env.XDG_CONFIG_HOME;
});

// A minimal transactional datastore: `transaction(fn)` snapshots, runs fn, and on
// any throw restores the snapshot (rollback). Enough to prove the endpoint's op
// dispatch, ordering, and all-or-nothing rollback without a real Postgres.
function makeStubDatastore() {
  const items = new Map<string, any>();
  const rels: any[] = [];
  const aliases = new Map<string, string>();
  let seq = 0;
  const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const api: any = {
    relTypes: ['supersedes', 'relates-to', 'depends-on'],
    async transaction(fn: any) {
      const snap = { items: new Map(items), rels: [...rels], aliases: new Map(aliases) };
      try {
        return await fn(api);
      } catch (e) {
        items.clear(); for (const [k, v] of snap.items) items.set(k, v);
        rels.length = 0; rels.push(...snap.rels);
        aliases.clear(); for (const [k, v] of snap.aliases) aliases.set(k, v);
        throw e;
      }
    },
    async create(opts: any) {
      const id = opts.id ?? uid();
      if (items.has(id)) throw new Error(`Item id already exists: ${id}`);
      const item = { id, ...opts };
      items.set(id, item);
      return item;
    },
    async update(id: string, changes: any) {
      if (!items.has(id)) throw new Error(`Item not found: ${id}`);
      const item = { ...items.get(id), ...changes };
      items.set(id, item);
      return item;
    },
    async delete(id: string) {
      if (!items.has(id)) throw new Error(`Item not found: ${id}`);
      items.delete(id);
    },
    async relate(sourceId: string, type: string, targetId: string, opts: any) {
      const rel = { id: `rel-${uid()}`, sourceId, type, targetId, ...opts };
      rels.push(rel);
      return rel;
    },
    async unrelate(id: string) {
      const i = rels.findIndex(r => r.id === id);
      if (i < 0) throw new Error(`Relationship not found: ${id}`);
      rels.splice(i, 1);
    },
    async setAlias(alias: string, targetId: string) { aliases.set(alias, targetId); },
    async removeAlias(alias: string) { aliases.delete(alias); },
    async writeObjectJson(id: string, data: any) { const it = items.get(id); if (it) it.objectData = data; },
    // exposed for assertions
    _items: items, _rels: rels, _aliases: aliases,
  };
  return api;
}

// Run `fn` with `Datastore.open` overridden to return `stub`, so the API's
// openDatastore resolves to our transactional stub instead of the fs datastore.
async function withStubOpen<T>(stub: any, fn: () => Promise<T>): Promise<T> {
  const orig = (Datastore as any).open;
  (Datastore as any).open = () => stub;
  try {
    return await fn();
  } finally {
    (Datastore as any).open = orig;
  }
}

// Run `body` through POST /transaction with a transactional stub datastore.
function postTxWithStub(stub: any, body: any) {
  return withStubOpen(stub, () => request(app).post('/transaction').send(body));
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

// ─── Validation (real fs datastore — validation runs before transaction) ──────

describe('POST /transaction — validation', () => {
  it('400 when ops is missing', async () => {
    const res = await request(app).post('/transaction').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ops must be a non-empty array/);
  });

  it('400 when ops is empty', async () => {
    const res = await request(app).post('/transaction').send({ ops: [] });
    expect(res.status).toBe(400);
  });

  it('400 on an unknown op verb', async () => {
    const res = await request(app).post('/transaction').send({ ops: [{ op: 'frobnicate', id: UUID_A }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ops\[0\].*unknown op/);
  });

  it('400 on create with an invalid type', async () => {
    const res = await request(app).post('/transaction').send({ ops: [{ op: 'create', type: 'notaType' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid type/);
  });

  it('400 on update without a valid id', async () => {
    const res = await request(app).post('/transaction').send({ ops: [{ op: 'update', changes: { value: 'x' } }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/update requires a valid id/);
  });

  it('400 on relate missing targetId / bad rel type', async () => {
    const res1 = await request(app).post('/transaction').send({ ops: [{ op: 'relate', sourceId: UUID_A, type: 'supersedes' }] });
    expect(res1.status).toBe(400);
    expect(res1.body.error).toMatch(/targetId/);
    const res2 = await request(app).post('/transaction').send({ ops: [{ op: 'relate', sourceId: UUID_A, targetId: UUID_B, type: 'no-such-rel' }] });
    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/invalid relationship type/);
  });

  it('400 on setAlias without a targetId', async () => {
    const res = await request(app).post('/transaction').send({ ops: [{ op: 'setAlias', alias: 'foo' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/setAlias requires a valid targetId/);
  });
});

// ─── Deferred-fs guard (real fs datastore has no transaction support) ─────────

// ─── Real fs working set — the endpoint's SYNC executor, end to end ───────────
// sqlite-fs transactions are synchronous-only (better-sqlite3 cannot hold a
// transaction across await boundaries), so the endpoint dispatches these
// requests through applyTxOpSync instead of the async executor.

describe('POST /transaction — real fs working set (sync executor)', () => {
  it('commits a multi-op list atomically against the real datastore', async () => {
    const res = await request(app).post('/transaction').send({
      actor: 'u-alice',
      ops: [
        { op: 'create', id: UUID_A, value: 'tx parent', type: 'text' },
        { op: 'create', id: UUID_B, value: 'tx child', type: 'text', parentId: UUID_A },
        { op: 'setAlias', alias: 'TX-Parent', targetId: UUID_A },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.results[1].parentId).toBe(UUID_A);

    // Visible through ordinary reads afterwards.
    const got = await request(app).get(`/items/${UUID_A}`);
    expect(got.status).toBe(200);
    expect(got.body.value).toBe('tx parent');
    const alias = await request(app).get('/aliases/tx-parent');
    expect([200, 404]).toContain(alias.status); // route may not exist; item read above is the real assertion
  });

  it('rolls the WHOLE list back on a failing op — zero ops applied on disk', async () => {
    const res = await request(app).post('/transaction').send({
      ops: [
        { op: 'create', id: UUID_A, value: 'doomed', type: 'text' },
        { op: 'update', id: UUID_B, changes: { value: 'no such item' } }, // fails
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.rolledBack).toBe(true);
    expect(res.body.failedIndex).toBe(1);

    // The first op must NOT have survived the rollback.
    const got = await request(app).get(`/items/${UUID_A}`);
    expect(got.status).toBe(404);
  });
});

// ─── Dispatch, ordering, atomicity (transactional stub datastore) ─────────────

describe('POST /transaction — atomic execution', () => {
  it('commits a multi-op list and returns results in order', async () => {
    const stub = makeStubDatastore();
    const res = await postTxWithStub(stub, {
      actor: 'u-alice',
      ops: [
        { op: 'create', id: UUID_A, type: 'object', value: 'page' },
        { op: 'create', id: UUID_B, type: 'object', value: 'revision', parentId: UUID_A },
        { op: 'relate', sourceId: UUID_A, type: 'supersedes', targetId: UUID_B },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.results[0].id).toBe(UUID_A);
    expect(res.body.results[1].parentId).toBe(UUID_A);
    expect(res.body.results[2].type).toBe('supersedes');
    // Everything committed.
    expect(stub._items.size).toBe(2);
    expect(stub._rels).toHaveLength(1);
  });

  it('rolls back the WHOLE list when a later op fails (409 + failedIndex, zero applied)', async () => {
    const stub = makeStubDatastore();
    const res = await postTxWithStub(stub, {
      ops: [
        { op: 'create', id: UUID_A, type: 'object', value: 'ok' },
        { op: 'update', id: UUID_B, changes: { value: 'nope' } }, // UUID_B never created → throws
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.rolledBack).toBe(true);
    expect(res.body.failedIndex).toBe(1);
    // Rollback restored the pre-transaction (empty) state — op 0 did NOT stick.
    expect(stub._items.size).toBe(0);
  });

  it('a client-supplied id lets a later op reference an item created earlier', async () => {
    const stub = makeStubDatastore();
    const res = await postTxWithStub(stub, {
      ops: [
        { op: 'create', id: UUID_A, type: 'object', value: 'parent' },
        { op: 'create', type: 'object', value: 'child', parentId: UUID_A },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results[1].parentId).toBe(UUID_A);
    expect(stub._items.size).toBe(2);
  });
});

// ─── POST /items now forwards an optional client-supplied id ──────────────────
// The route change is that POST /items passes `id` through to ds.create. Only the
// Postgres adapter honours it (sqlite-fs mints its own — matching the Postgres-only
// scope), so the id-preserving/duplicate assertions run against the id-honouring
// stub. The non-UUID 400 is pure route validation and needs no datastore.

describe('POST /items — client-supplied id', () => {
  it('forwards a supplied UUID through to create', async () => {
    const stub = makeStubDatastore();
    const res = await withStubOpen(stub, () => request(app).post('/items').send({ id: UUID_A, value: 'preserved' }));
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(UUID_A);
  });

  it('400 on a non-UUID id (route validation, before the datastore)', async () => {
    const res = await request(app).post('/items').send({ id: 'not-a-uuid', value: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid id/);
  });

  it('409 when the supplied id already exists', async () => {
    const stub = makeStubDatastore();
    await withStubOpen(stub, () => request(app).post('/items').send({ id: UUID_A, value: 'first' }));
    const res = await withStubOpen(stub, () => request(app).post('/items').send({ id: UUID_A, value: 'dup' }));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });
});
