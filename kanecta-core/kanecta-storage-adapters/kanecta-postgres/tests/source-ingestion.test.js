'use strict';

// Idempotent external-ingestion primitives on the Postgres adapter — the peer of
// the filesystem adapter's create(source fields) + bySource(). Backs deterministic
// importers (e.g. @kanecta/transcript-import) whose upsert is
// bySource() ? update() : create(). Integration test against a real Postgres.

const crypto = require('crypto');
const { Pool } = require('pg');
const { PostgresAdapter } = require('../src/adapter');

const CONNECTION_STRING =
  process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const OWNER = 'test@example.com';
const SCHEMA = `kanecta_src_${crypto.randomBytes(4).toString('hex')}`;

let adminPool;
let pool;
let ds;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: CONNECTION_STRING });
  await adminPool.query(`CREATE SCHEMA "${SCHEMA}"`);
  pool = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path="${SCHEMA}"` });
  ds = await PostgresAdapter.init(pool, OWNER);
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await adminPool.end();
  }
});

describe('create() with a source key', () => {
  test('persists sourceSystem / sourceExternalId', async () => {
    const item = await ds.create({
      value: 'imported', type: 'note',
      sourceSystem: 'claude-code', sourceExternalId: 'evt-1',
    });
    expect(item.sourceSystem).toBe('claude-code');
    expect(item.sourceExternalId).toBe('evt-1');

    const reloaded = await ds.get(item.id);
    expect(reloaded.sourceSystem).toBe('claude-code');
    expect(reloaded.sourceExternalId).toBe('evt-1');
  });

  test('defaults the source fields to null', async () => {
    const item = await ds.create({ value: 'plain', type: 'note' });
    expect(item.sourceSystem ?? null).toBeNull();
    expect(item.sourceExternalId ?? null).toBeNull();
  });

  test('rejects a duplicate (sourceSystem, sourceExternalId) — the key is unique', async () => {
    await ds.create({ value: 'first', type: 'note', sourceSystem: 'sys', sourceExternalId: 'dup' });
    await expect(
      ds.create({ value: 'second', type: 'note', sourceSystem: 'sys', sourceExternalId: 'dup' }),
    ).rejects.toThrow();
  });

  test('allows the same externalId under a different sourceSystem', async () => {
    const a = await ds.create({ value: 'a', type: 'note', sourceSystem: 'sysA', sourceExternalId: 'x' });
    const b = await ds.create({ value: 'b', type: 'note', sourceSystem: 'sysB', sourceExternalId: 'x' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('bySource()', () => {
  test('returns the item for a known key', async () => {
    const created = await ds.create({
      value: 'sess', type: 'note',
      sourceSystem: 'claude-code', sourceExternalId: 'session-42',
    });
    const found = await ds.bySource('claude-code', 'session-42');
    expect(found).not.toBeNull();
    expect(found.id).toBe(created.id);
    expect(found.value).toBe('sess');
  });

  test('returns null for an unknown key', async () => {
    expect(await ds.bySource('claude-code', 'nope')).toBeNull();
  });

  test('returns null when either argument is missing', async () => {
    expect(await ds.bySource('claude-code', null)).toBeNull();
    expect(await ds.bySource(null, 'x')).toBeNull();
  });

  test('reflects a source key set later via update()', async () => {
    const item = await ds.create({ value: 'v', type: 'note' });
    expect(await ds.bySource('sys', 'later')).toBeNull();
    await ds.update(item.id, { sourceSystem: 'sys', sourceExternalId: 'later' });
    const found = await ds.bySource('sys', 'later');
    expect(found?.id).toBe(item.id);
  });

  test('supports the upsert pattern (create, then re-find and update in place)', async () => {
    const key = { sourceSystem: 'claude-code', sourceExternalId: 'turn-7' };
    expect(await ds.bySource(key.sourceSystem, key.sourceExternalId)).toBeNull();
    const created = await ds.create({ value: 'v1', type: 'note', ...key });
    const existing = await ds.bySource(key.sourceSystem, key.sourceExternalId);
    expect(existing.id).toBe(created.id);
    await ds.update(existing.id, { value: 'v2' });
    expect((await ds.get(created.id)).value).toBe('v2');
    expect((await ds.bySource(key.sourceSystem, key.sourceExternalId)).id).toBe(created.id);
  });
});
