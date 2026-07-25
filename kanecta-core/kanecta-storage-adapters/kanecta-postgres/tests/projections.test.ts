// Projection rebuild — integration tests against a real Postgres instance.
//
// Spec §"CQRS projections": obj_/perf_ relations are strictly derived — always
// rebuildable. These tests blow away each derived structure and assert that
// rebuildProjections() regenerates it identically to organic maintenance. The
// one sanctioned asymmetry: on this adapter the obj_ row IS the payload store,
// so a dropped obj_ table comes back EMPTY with a warning, not with its rows.
//
// Same harness as adapter.test.ts: a per-run schema so nothing real is touched.

import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PostgresAdapter, ROOT_ID } from '../src/adapter';

const CONNECTION_STRING =
  process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const OWNER = 'test@example.com';

const SCHEMA = `kanecta_test_${crypto.randomBytes(4).toString('hex')}`;

let adminPool;
let pool;
let adapter;

function makeTypeSchema(tableName, title) {
  return {
    meta: { icon: '', description: 'a test type', details: '', keywords: '', tags: '', skills: { claude: '' } },
    jsonSchema: {
      '$schema': 'http://json-schema.org/draft-07/schema#', '$id': '',
      title, type: 'object', properties: {
        label:    { type: 'string', 'x-id': '66666666-6666-4666-8666-000000000001' },
        friendId: { type: 'string', format: 'uuid', 'x-id': '66666666-6666-4666-8666-000000000002' },
      },
      required: [], additionalProperties: false,
    },
    sqlSchema: [
      `CREATE TABLE "${tableName}" (
         item_id UUID NOT NULL, "label" TEXT, "friend_id" UUID,
         CONSTRAINT "pk_${tableName}" PRIMARY KEY (item_id),
         CONSTRAINT "fk_${tableName}_item" FOREIGN KEY (item_id) REFERENCES items(id)
       )`,
    ],
  };
}

const byName = (report, name) => report.structures.find((s) => s.name === name);

let typeId;
let objTable;
let itemA;
let itemB;
let linker;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: CONNECTION_STRING });
  await adminPool.query(`CREATE SCHEMA "${SCHEMA}"`);
  pool    = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path="${SCHEMA}"` });
  adapter = await PostgresAdapter.init(pool, OWNER);

  // A user type with a UUID payload field, two instances (one referencing the
  // other), an inline [[uuid]] link, an alias and a relationship — enough to
  // exercise every reference_type family the rebuild recomputes.
  typeId   = crypto.randomUUID();
  objTable = `obj_${typeId.replace(/-/g, '_')}`;
  await adapter.createType('ProjWidget', { schema: makeTypeSchema(objTable, 'ProjWidget'), id: typeId });
  itemA = await adapter.create({ type: 'object', typeId, value: 'proj-a', objectData: { label: 'a' } });
  itemB = await adapter.create({ type: 'object', typeId, value: 'proj-b', objectData: { label: 'b', friendId: itemA.id } });
  linker = await adapter.create({ value: `see [[${itemA.id}]]` });
  await adapter.setAlias('proj-widget-a', itemA.id);
  await adapter.relate(itemA.id, 'depends-on', itemB.id, { note: 'proj test' });
}, 60_000);

afterAll(async () => {
  try { await adapter?.dropGraphProjection?.(); } catch { /* ignore */ }
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await adminPool.end();
  }
});

describe('describeProjectedRelation', () => {
  test('returns the column shape of an obj_ table', async () => {
    const cols = await adapter.describeProjectedRelation(objTable);
    const names = cols.map((c) => c.name);
    expect(names).toContain('item_id');
    expect(names).toContain('label');
    expect(names).toContain('friend_id');
    expect(cols.find((c) => c.name === 'friend_id').dataType).toBe('uuid');
  });

  test('returns [] for a table that does not exist', async () => {
    expect(await adapter.describeProjectedRelation('obj_nope')).toEqual([]);
  });
});

describe('rebuildProjections — full run', () => {
  test('reports every structure and ok=true on a healthy store', async () => {
    const report = await adapter.rebuildProjections();
    expect(report.storage).toBe('postgres');
    expect(report.ok).toBe(true);
    for (const name of ['obj-tables', 'perf_backlinks', 'perf_references', 'perf_search', 'embedding-queue', 'children', 'paths', 'graph'])
      expect(byName(report, name)).toBeTruthy();
    expect(byName(report, 'obj-tables').status).toBe('verified');
    // no provider configured in this harness → queue skipped, AGE optional
    expect(['skipped', 'rebuilt']).toContain(byName(report, 'embedding-queue').status);
  });

  test('only: limits the rebuild to the named structures', async () => {
    const report = await adapter.rebuildProjections({ only: ['perf_backlinks'] });
    expect(report.structures).toHaveLength(1);
    expect(report.structures[0].name).toBe('perf_backlinks');
  });
});

describe('rebuildProjections — perf_backlinks', () => {
  test('regenerates a blown-away backlink index', async () => {
    await pool.query('DELETE FROM perf_backlinks');
    const { rows: empty } = await pool.query('SELECT COUNT(*) AS n FROM perf_backlinks');
    expect(Number(empty[0].n)).toBe(0);

    const report = await adapter.rebuildProjections({ only: ['perf_backlinks'] });
    expect(byName(report, 'perf_backlinks').status).toBe('rebuilt');

    const { rows } = await pool.query(
      'SELECT source_id FROM perf_backlinks WHERE target_id = $1', [itemA.id],
    );
    expect(rows.map((r) => r.source_id)).toContain(linker.id);
  });
});

describe('rebuildProjections — perf_references', () => {
  test('recomputes parent, inline-link, payload-field and relationship refs', async () => {
    await pool.query('DELETE FROM perf_references');
    const report = await adapter.rebuildProjections({ only: ['perf_references'] });
    expect(byName(report, 'perf_references').status).toBe('rebuilt');
    expect(byName(report, 'perf_references').rows).toBeGreaterThan(0);

    const { rows } = await pool.query(
      'SELECT source_item_id, reference_type, field_name FROM perf_references WHERE target_item_id = $1',
      [itemA.id],
    );
    const kinds = rows.map((r) => r.reference_type);
    expect(kinds).toContain('inline-link');                     // [[uuid]] in linker.value
    expect(kinds).toContain('payload-field');                   // itemB.friendId (uuid column)
    expect(kinds).toContain('relationship-source');             // relate(itemA → itemB)
    const payloadRef = rows.find((r) => r.reference_type === 'payload-field' && r.field_name === 'friend_id');
    expect(payloadRef.source_item_id).toBe(itemB.id);

    const { rows: parents } = await pool.query(
      `SELECT COUNT(*) AS n FROM perf_references WHERE reference_type = 'parent'`,
    );
    expect(Number(parents[0].n)).toBeGreaterThan(0);
  });
});

describe('rebuildProjections — perf_search', () => {
  test('regenerates tsvectors identical to trigger-maintained ones', async () => {
    const { rows: [before] } = await pool.query(
      'SELECT item_tsv::text AS t, object_tsv::text AS o FROM perf_search WHERE item_id = $1', [itemB.id],
    );
    await pool.query('DELETE FROM perf_search');
    const report = await adapter.rebuildProjections({ only: ['perf_search'] });
    expect(byName(report, 'perf_search').status).toBe('rebuilt');
    const { rows: [after] } = await pool.query(
      'SELECT item_tsv::text AS t, object_tsv::text AS o FROM perf_search WHERE item_id = $1', [itemB.id],
    );
    expect(after.t).toBe(before.t);
    expect(after.o).toBe(before.o);
  });
});

describe('rebuildProjections — children cache + paths', () => {
  test('recomputes a corrupted children[] cache from parent_id', async () => {
    await pool.query(`UPDATE items SET children = '{}' WHERE id = $1`, [ROOT_ID]);
    const report = await adapter.rebuildProjections({ only: ['children'] });
    expect(byName(report, 'children').status).toBe('rebuilt');
    const { rows: [root] } = await pool.query('SELECT children FROM items WHERE id = $1', [ROOT_ID]);
    const { rows: kids } = await pool.query(
      'SELECT id FROM items WHERE parent_id = $1 AND id <> parent_id', [ROOT_ID],
    );
    expect(new Set(root.children)).toEqual(new Set(kids.map((k) => k.id)));
  });

  test('recomputes a nulled materialized path', async () => {
    await pool.query('UPDATE items SET path = NULL WHERE id = $1', [itemA.id]);
    const report = await adapter.rebuildProjections({ only: ['paths'] });
    expect(byName(report, 'paths').status).toBe('rebuilt');
    const { rows: [a] } = await pool.query('SELECT path FROM items WHERE id = $1', [itemA.id]);
    expect(a.path).toContain(itemA.id);
  });
});

describe('rebuildProjections — obj-tables reconcile', () => {
  test('recreates a missing obj_ table EMPTY and reports the warning', async () => {
    // A second type whose only table we drop behind the adapter's back.
    const lostTypeId = crypto.randomUUID();
    const lostTable  = `obj_${lostTypeId.replace(/-/g, '_')}`;
    await adapter.createType('ProjLost', { schema: makeTypeSchema(lostTable, 'ProjLost'), id: lostTypeId });
    await adapter.create({ type: 'object', typeId: lostTypeId, value: 'lost-1', objectData: { label: 'x' } });
    await pool.query(`DROP TABLE "${lostTable}"`);

    const report = await adapter.rebuildProjections({ only: ['obj-tables'] });
    const objs = byName(report, 'obj-tables');
    expect(objs.status).toBe('warning');
    expect(objs.created.map((c) => c.table)).toContain(lostTable);
    expect(objs.detail).toMatch(/payload store/);

    // The relation is back (empty — its rows were the payload store).
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = $1`, [lostTable],
    );
    expect(Number(rows[0].n)).toBe(1);
    const { rows: empty } = await pool.query(`SELECT COUNT(*) AS n FROM "${lostTable}"`);
    expect(Number(empty[0].n)).toBe(0);
  });

  test('drops an orphan obj_ table whose type has no instances', async () => {
    const ghost = `obj_${crypto.randomUUID().replace(/-/g, '_')}`;
    await pool.query(`CREATE TABLE "${ghost}" (item_id UUID PRIMARY KEY)`);
    const report = await adapter.rebuildProjections({ only: ['obj-tables'] });
    expect(byName(report, 'obj-tables').dropped).toContain(ghost);
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = $1`, [ghost],
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});

// ─── createType placement (bug found by the integrity run 2026-07-21) ─────────
// createType used to write the type item SELF-PARENTED (parent_id = id), which
// root-singleton / no-parentid-cycles flag as corruption and rebuildPaths can
// never reach. The rule: type items live under the well-known types node with
// the seeder's path convention.

describe('createType placement', () => {
  test('a created type item is parented under the types node with the seeder path', async () => {
    const id = crypto.randomUUID();
    const tableName = `obj_${id.replace(/-/g, '_')}`;
    await adapter.createType('PlacementChk', { schema: makeTypeSchema(tableName, 'PlacementChk'), id });
    const { rows: [row] } = await pool.query('SELECT parent_id, path FROM items WHERE id = $1', [id]);
    expect(row.parent_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(row.path).toBe(`00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111/${id}`);
  });
});
