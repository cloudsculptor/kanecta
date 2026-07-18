// item_archive — soft delete as a physical row move (spec §item_archive
// draft). Integration tests against a real Postgres (per-run schema, same
// pattern as adapter.test.ts). The drift test here is the enforcement
// mechanism for the spec's PRIMARY constraint: `items` and `item_archive`
// have EXACTLY the same schema — a future items migration that forgets to
// alter item_archive in the same step fails this suite, not silently drifts.

import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PostgresAdapter } from '../src/adapter';

const CONNECTION_STRING =
  process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const OWNER = 'test@example.com';
const SCHEMA = `kanecta_arch_${crypto.randomBytes(4).toString('hex')}`;

let adminPool: any;
let pool: any;
let adapter: any;

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

const typeSchema = (name: string) => ({
  meta: { description: `${name} archive test type` },
  jsonSchema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { name: { type: 'string', 'x-id': crypto.randomUUID() } },
    required: [],
    additionalProperties: false,
  },
});

const inLive = async (id: string) =>
  (await pool.query('SELECT 1 FROM items WHERE id = $1', [id])).rows.length > 0;
const inArchive = async (id: string) =>
  (await pool.query('SELECT 1 FROM item_archive WHERE id = $1', [id])).rows.length > 0;

describe('schema identity (THE drift gate)', () => {
  test('items and item_archive have exactly the same columns, order, types, defaults, nullability', async () => {
    // Ordinal VALUES may differ (columns dropped from items by old migrations
    // leave attnum gaps that LIKE does not reproduce); the ORDER — asserted by
    // the array ordering below — plus name/type/default/nullability must not.
    const cols = async (table: string) => (await pool.query(
      `SELECT column_name, data_type, coalesce(column_default, '') AS dflt, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [SCHEMA, table],
    )).rows;
    const live = await cols('items');
    const arch = await cols('item_archive');
    expect(live.length).toBeGreaterThan(0);
    expect(arch).toEqual(live);
  });

  test('item_archive_payload exists as the archive payload section', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'item_archive_payload' ORDER BY ordinal_position`,
      [SCHEMA],
    );
    expect(rows.map((r: any) => r.column_name)).toEqual(['item_id', 'payload']);
  });
});

describe('softDelete = physical row move', () => {
  test('the row leaves items and lands verbatim in item_archive with deletedAt stamped', async () => {
    const item = await adapter.create({ value: 'doomed' });
    const res = await adapter.softDelete(item.id);
    expect(res.deletedAt).toBeTruthy();
    expect(await inLive(item.id)).toBe(false);
    expect(await inArchive(item.id)).toBe(true);
  });

  test('is idempotent on an already-archived item', async () => {
    const item = await adapter.create({ value: 'twice' });
    const first = await adapter.softDelete(item.id);
    const second = await adapter.softDelete(item.id);
    expect(second.deletedAt).toEqual(first.deletedAt);
    expect(await inArchive(item.id)).toBe(true);
  });

  test('does not cascade: children stay live under an archived parent', async () => {
    const parent = await adapter.create({ value: 'folder' });
    const child  = await adapter.create({ value: 'kept', parentId: parent.id });
    await adapter.softDelete(parent.id);
    expect(await inLive(child.id)).toBe(true);
    expect((await adapter.get(child.id)).deletedAt).toBeNull();
  });

  test('an object payload is captured and keeps serving via readObjectJson', async () => {
    const { metadata: t } = await adapter.createType('ArchThingPg', { schema: typeSchema('ArchThingPg') });
    const item = await adapter.create({
      value: 'typed', type: 'object', typeId: t.id, objectData: { name: 'payload-1' },
    });
    await adapter.softDelete(item.id);
    const { rows } = await pool.query('SELECT payload FROM item_archive_payload WHERE item_id = $1', [item.id]);
    expect(rows[0].payload).toMatchObject({ name: 'payload-1' });
    expect(await adapter.readObjectJson(item.id, t.id)).toMatchObject({ name: 'payload-1' });
  });

  test('a relationship endpoint can be archived (relation survives — no FK in the way)', async () => {
    const a = await adapter.create({ value: 'endpoint-a' });
    const b = await adapter.create({ value: 'endpoint-b' });
    await adapter.relate(a.id, 'relates-to', b.id);
    const res = await adapter.softDelete(b.id);
    expect(res.deletedAt).toBeTruthy();
    expect(await inArchive(b.id)).toBe(true);
  });
});

describe('point reads vs set reads', () => {
  test('get(id) resolves the archive transparently', async () => {
    const item = await adapter.create({ value: 'findable' });
    await adapter.softDelete(item.id);
    const got = await adapter.get(item.id);
    expect(got).toBeTruthy();
    expect(got.deletedAt).toBeTruthy();
    expect(got.value).toBe('findable');
  });

  test('query()/loadAll()/children() exclude archived items by construction', async () => {
    const item = await adapter.create({ value: 'excluded' });
    await adapter.softDelete(item.id);
    expect((await adapter.query({ limit: 0 })).some((i: any) => i.id === item.id)).toBe(false);
    expect((await adapter.loadAll()).some((i: any) => i.id === item.id)).toBe(false);
    expect((await adapter.children(item.parentId)).some((i: any) => i.id === item.id)).toBe(false);
  });

  test('query({ includeDeleted: true }) and loadAll({ includeDeleted: true }) union the archive', async () => {
    const item = await adapter.create({ value: 'in-union' });
    await adapter.softDelete(item.id);
    const q = await adapter.query({ includeDeleted: true, limit: 0 });
    expect(q.find((i: any) => i.id === item.id)?.deletedAt).toBeTruthy();
    const all = await adapter.loadAll({ includeDeleted: true });
    expect(all.some((i: any) => i.id === item.id)).toBe(true);
  });

  test('update() refuses archived items and flag-style deletedAt changes', async () => {
    const item = await adapter.create({ value: 'frozen' });
    await adapter.softDelete(item.id);
    await expect(adapter.update(item.id, { value: 'nope' })).rejects.toThrow(/archived/);
    const live = await adapter.create({ value: 'live' });
    await expect(adapter.update(live.id, { deletedAt: new Date().toISOString() }))
      .rejects.toThrow(/softDelete/);
  });
});

describe('restore = move back', () => {
  test('round-trips a typed object: projection row, payload and backlinks repopulate', async () => {
    const target = await adapter.create({ value: 'link-target' });
    const { metadata: t } = await adapter.createType('PhoenixPg', { schema: typeSchema('PhoenixPg') });
    const item = await adapter.create({
      value: `phoenix [[${target.id}]]`, type: 'object', typeId: t.id, objectData: { name: 'p1' },
    });
    await adapter.softDelete(item.id);
    const res = await adapter.restore(item.id);
    expect(res.deletedAt).toBeNull();
    expect(await inLive(item.id)).toBe(true);
    expect(await inArchive(item.id)).toBe(false);
    expect(await adapter.readObjectJson(item.id, t.id)).toMatchObject({ name: 'p1' });
    const { rows: bl } = await pool.query(
      'SELECT 1 FROM perf_backlinks WHERE source_id = $1 AND target_id = $2', [item.id, target.id],
    );
    expect(bl.length).toBe(1);
    expect((await adapter.query({ type: 'PhoenixPg', limit: 0 })).some((i: any) => i.id === item.id)).toBe(true);
  });

  test('keeps the obj_ table while the LAST instance sits in the archive', async () => {
    const { metadata: t } = await adapter.createType('LastOnePg', { schema: typeSchema('LastOnePg') });
    const item = await adapter.create({ value: 'only', type: 'object', typeId: t.id, objectData: { name: 'solo' } });
    const table = `obj_${t.id.replace(/-/g, '_')}`;
    await adapter.softDelete(item.id);
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [SCHEMA, table],
    );
    expect(rows.length).toBe(1);
    await adapter.restore(item.id);
    const { rows: proj } = await pool.query(`SELECT 1 FROM "${SCHEMA}"."${table}" WHERE item_id = $1`, [item.id]);
    expect(proj.length).toBe(1);
  });
});

describe('hard delete', () => {
  test('of an archived item = purge (archive row + payload capture gone)', async () => {
    const item = await adapter.create({ value: 'purge me' });
    await adapter.softDelete(item.id);
    await adapter.delete(item.id);
    expect(await inArchive(item.id)).toBe(false);
    expect(await adapter.get(item.id)).toBeNull();
  });

  test('purging the last archived instance drops the obj_ table', async () => {
    const { metadata: t } = await adapter.createType('PurgeTypePg', { schema: typeSchema('PurgeTypePg') });
    const item = await adapter.create({ value: 'only', type: 'object', typeId: t.id, objectData: { name: 'x' } });
    const table = `obj_${t.id.replace(/-/g, '_')}`;
    await adapter.softDelete(item.id);
    await adapter.delete(item.id);
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [SCHEMA, table],
    );
    expect(rows.length).toBe(0);
  });

  test('the deferred guard still blocks hard-deleting a live parent with live children', async () => {
    const parent = await adapter.create({ value: 'guarded parent' });
    await adapter.create({ value: 'dependent child', parentId: parent.id });
    await expect(adapter.delete(parent.id)).rejects.toThrow(/fk_items_parent|orphan/);
  });
});

describe('legacy catch-up', () => {
  test('flagged live rows (pre-archive stores) move to the archive on init/open', async () => {
    // Simulate the pre-archive world: a flagged live row with its original stamp.
    const item = await adapter.create({ value: 'legacy-flagged' });
    const stamp = new Date('2025-01-01T00:00:00.000Z');
    await pool.query('UPDATE items SET deleted_at = $1 WHERE id = $2', [stamp, item.id]);

    const moved = await adapter._migrateFlaggedRowsToArchive();
    expect(moved).toBeGreaterThanOrEqual(1);
    expect(await inLive(item.id)).toBe(false);
    expect(await inArchive(item.id)).toBe(true);
    const got = await adapter.get(item.id);
    expect(new Date(got.deletedAt).toISOString()).toBe(stamp.toISOString());
  });
});
