// Activity log (spec §activityPayload) — integration tests against a real
// Postgres. The second append-only exempt log: item_history tracks what
// CHANGED; activity tracks what HAPPENED. Same setup pattern as adapter.test.ts
// (per-run schema so the kanecta database is never touched).

import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PostgresAdapter } from '../src/adapter';

const CONNECTION_STRING =
  process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const OWNER = 'test@example.com';
const SCHEMA = `kanecta_act_${crypto.randomBytes(4).toString('hex')}`;

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

describe('activity log', () => {
  test('on by default (rootPayload.activity defaults EXTERNAL): records and reads events', async () => {
    const item = await adapter.create({ value: 'watched' });
    const e1 = await adapter.recordActivity({ eventType: 'item.viewed', actor: 'alice@acme.com', targetId: item.id });
    const e2 = await adapter.recordActivity({
      eventType: 'search.performed', actor: 'alice@acme.com',
      data: { query: 'drill press maintenance', resultCount: 12 },
    });
    expect(e1).toMatchObject({ eventType: 'item.viewed', actor: 'alice@acme.com', targetId: item.id, data: null });
    expect(e1.id).toBeTruthy();
    expect(e1.occurredAt).toBeTruthy();
    // workspace-level event: null targetId, structured data round-trips (jsonb)
    expect(e2.targetId).toBeNull();
    expect(e2.data).toEqual({ query: 'drill press maintenance', resultCount: 12 });

    expect((await adapter.activityFor(item.id)).map(e => e.id)).toEqual([e1.id]);
    const types = (await adapter.listActivity()).map(e => e.eventType);
    expect(types).toContain('item.viewed');
    expect(types).toContain('search.performed');
    expect((await adapter.listActivity({ eventType: 'item.viewed' })).map(e => e.id)).toEqual([e1.id]);
  });

  test("gated: rootPayload.activity 'NONE' makes recording a no-op returning null", async () => {
    const saved = adapter.config.activity;
    adapter.config.activity = 'NONE';
    try {
      expect(await adapter.recordActivity({ eventType: 'item.viewed', actor: 'alice@acme.com' })).toBeNull();
    } finally {
      adapter.config.activity = saved;
    }
  });

  test('eventType and actor are required', async () => {
    await expect(adapter.recordActivity({ actor: 'a@b.c' })).rejects.toThrow(/eventType/);
    await expect(adapter.recordActivity({ eventType: 'item.viewed' })).rejects.toThrow(/actor/);
  });

  test('events survive deletion of the target item (no FK; append-only)', async () => {
    const item = await adapter.create({ value: 'short-lived' });
    const e = await adapter.recordActivity({ eventType: 'item.viewed', actor: 'bob@acme.com', targetId: item.id });
    await adapter.delete(item.id, OWNER);
    expect((await adapter.activityFor(item.id)).map(x => x.id)).toEqual([e.id]);
  });

  test('conformance: activity classifies as an exempt log, not a violation', async () => {
    const { classifyTable } = await import('../src/conformance');
    expect(classifyTable('activity')).toBe('activity');
  });
});
