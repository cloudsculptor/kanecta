// Integration: the WHOLE engine against real Postgres — manifest → SchemaModel,
// compiler-derived obj_<type> DDL, real rows, G1 compileSelect, and the generic
// executor via PgDataSource.
//
// Gated on KANECTA_TEST_PG_URL (set it to run; the default suite skips this so it
// stays green without a database):
//   KANECTA_TEST_PG_URL=postgres://kanecta:kanecta@localhost:45432/kanecta \
//     npx vitest run tests/graphql/pg-datasource.integration.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { deriveSqlSchema } from '@kanecta/schema-compiler';
import { buildSchemaModel, PgDataSource, Executor, compileAggregate, type Selection } from '../../src/graphql/index.ts';
import chThread from '../../manifests/community-hub/ch-thread.type.json' with { type: 'json' };
import chMessage from '../../manifests/community-hub/ch-message.type.json' with { type: 'json' };
import chFile from '../../manifests/community-hub/ch-file.type.json' with { type: 'json' };

const PG_URL = process.env.KANECTA_TEST_PG_URL;
const SCHEMA = 'gql_engine_it';
const run = PG_URL ? describe : describe.skip;

const T1 = 'aa000000-0000-4000-8000-000000000001';
const M1 = 'aa000000-0000-4000-8000-000000000002';
const M2 = 'aa000000-0000-4000-8000-000000000003';
const F1 = 'aa000000-0000-4000-8000-000000000004';
// A relationship-type item whose value is the 'attaches' slug, and the M1→F1
// relationship item that projects into obj_<relationship-type>. The built-in
// relationship type id is fixed (matches kanecta-postgres / PgDataSource).
const RELATIONSHIP_TYPE_ID = '334ea5f6-6bfa-43e5-b77f-5d811642d897';
const REL_OBJ = `obj_${RELATIONSHIP_TYPE_ID.replace(/-/g, '_')}`;
const ATTACHES_TYPE = 'aa000000-0000-4000-8000-0000000000a1'; // relationship-type item (value='attaches')
const REL1 = 'aa000000-0000-4000-8000-0000000000b1'; // the M1→F1 relationship item

const model = buildSchemaModel([chThread, chMessage, chFile]);

run('engine ↔ Postgres (real)', () => {
  let admin: Pool;
  let pool: Pool;
  let ds: PgDataSource;
  let exec: Executor;

  beforeAll(async () => {
    admin = new Pool({ connectionString: PG_URL });
    await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    pool = new Pool({ connectionString: PG_URL, options: `-c search_path="${SCHEMA}"` });

    // Minimal real schema: items (FK target) + obj_<relationship-type>, then each
    // type's obj table straight from the compiler.
    await pool.query(`CREATE TABLE items (id UUID PRIMARY KEY, parent_id UUID, type_id UUID, value TEXT, deleted_at TIMESTAMPTZ)`);
    // Relationships project to obj_<relationship-type> (spec §relationshipPayload) —
    // the bespoke `relationships` table is retired. Columns mirror the pg adapter's
    // relationship projection (item_id, type_id → the relationship-type item, endpoints).
    await pool.query(`CREATE TABLE "${REL_OBJ}" (item_id UUID PRIMARY KEY, type_id UUID, source_id UUID, target_id UUID, data JSONB, confidence REAL, note TEXT)`);
    for (const t of [chThread, chMessage, chFile]) {
      for (const ddl of deriveSqlSchema((t as any).payload.jsonSchema, { typeId: t.item.id, dialect: 'postgres' })) {
        await pool.query(ddl);
      }
    }

    // Items (tree): thread T1 ⟶ message M1 ⟶ reply M2; file F1 under M1.
    await pool.query(`INSERT INTO items (id, parent_id, type_id) VALUES
      ($1, NULL, $5), ($2, $1, $6), ($3, $2, $6), ($4, $2, $7)`, [T1, M1, M2, F1, chThread.item.id, chMessage.item.id, chFile.item.id]);

    const thread = `obj_${chThread.item.id.replace(/-/g, '_')}`;
    const message = `obj_${chMessage.item.id.replace(/-/g, '_')}`;
    const file = `obj_${chFile.item.id.replace(/-/g, '_')}`;
    await pool.query(`INSERT INTO "${thread}" (item_id, name, created_by_user_id, created_at, latest_message_at, sort_order) VALUES ($1,'General','u-alice','2026-01-01T00:00:00Z','2026-01-03T00:00:00Z',1)`, [T1]);
    await pool.query(`INSERT INTO "${message}" (item_id, thread_id, user_name, content, created_at) VALUES ($1,$2,'Alice','Hello','2026-01-02T00:00:00Z')`, [M1, T1]);
    await pool.query(`INSERT INTO "${message}" (item_id, thread_id, user_name, content, created_at) VALUES ($1,$2,'Bob','Reply','2026-01-03T00:00:00Z')`, [M2, T1]);
    await pool.query(`INSERT INTO "${file}" (item_id, name, mime_type, size_bytes) VALUES ($1,'a.png','image/png',10)`, [F1]);
    // The 'attaches' relationship: its relationship-type item (value = the slug), the
    // relationship item itself, and its obj_<relationship-type> projection row (M1→F1).
    await pool.query(`INSERT INTO items (id, parent_id, type_id, value) VALUES ($1, NULL, NULL, 'attaches')`, [ATTACHES_TYPE]);
    await pool.query(`INSERT INTO items (id, parent_id, type_id) VALUES ($1, NULL, $2)`, [REL1, RELATIONSHIP_TYPE_ID]);
    await pool.query(`INSERT INTO "${REL_OBJ}" (item_id, type_id, source_id, target_id) VALUES ($1, $2, $3, $4)`, [REL1, ATTACHES_TYPE, M1, F1]);

    ds = new PgDataSource(pool, model);
    exec = new Executor(model, ds);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    }
  });

  it('resolves a thread with its top-level messages and file attachments', async () => {
    const selection: Selection = { id: true, name: true, createdByUserId: true, messages: { id: true, content: true, files: { name: true } } };
    const result = await exec.resolveById('ChThread', T1, selection);
    expect(result).toEqual({
      id: T1,
      name: 'General',
      createdByUserId: 'u-alice',
      messages: [{ id: M1, content: 'Hello', files: [{ name: 'a.png' }] }], // M2 is a reply under M1, not a thread child
    });
  });

  it('resolves replies (message-under-message) and the FK reference back to the thread', async () => {
    const result = await exec.resolveById('ChMessage', M1, { id: true, content: true, replies: { id: true, content: true }, threadId: { id: true, name: true } });
    expect(result).toEqual({
      id: M1,
      content: 'Hello',
      replies: [{ id: M2, content: 'Reply' }],
      threadId: { id: T1, name: 'General' },
    });
  });

  it('G1: compileSelect where-filters against real Postgres', async () => {
    const hit = await exec.resolveList('ChThread', { where: { name: { eq: 'General' } } }, { id: true });
    expect(hit).toEqual([{ id: T1 }]);
    const miss = await exec.resolveList('ChThread', { where: { name: { eq: 'Nope' } } }, { id: true });
    expect(miss).toEqual([]);
  });

  it('G1: compileSelect sorts and paginates against real Postgres', async () => {
    const asc = await exec.resolveList('ChMessage', { sort: [{ field: 'createdAt', direction: 'ASC' }] }, { id: true });
    expect(asc.map((r) => r.id)).toEqual([M1, M2]);
    const desc = await exec.resolveList('ChMessage', { sort: [{ field: 'createdAt', direction: 'DESC' }], limit: 1 }, { id: true });
    expect(desc.map((r) => r.id)).toEqual([M2]);
  });

  it('G2: compileAggregate group-by count runs against real Postgres', async () => {
    const message = model.types.find((t) => t.name === 'ChMessage')!;
    const { sql, params } = compileAggregate(message, { groupBy: ['threadId'], aggregates: [{ fn: 'count', alias: 'n' }] });
    const { rows } = await pool.query(sql, params as unknown[]);
    // Both M1 and M2 carry thread_id = T1 → one group of 2.
    expect(rows).toEqual([{ thread_id: T1, n: '2' }]); // pg returns bigint as string
  });

  it('applies the authz read gate against real rows', async () => {
    const denied = new Set([M2]);
    const rows = await exec.resolveList('ChMessage', {}, { id: true }, { authorize: (id) => !denied.has(id) });
    expect(rows.map((r) => r.id)).toEqual([M1]);
  });

  it('related(): reads obj_<relationship-type>, resolves the slug, and filters by direction', async () => {
    // Outgoing: M1 --attaches--> F1 (the slug is recovered via type_id → items.value).
    const out = await ds.related(M1, 'attaches', 'outgoing', 'ChFile');
    expect(out.map((r) => r.id)).toEqual([F1]);
    // Incoming: F1 <--attaches-- M1.
    const inc = await ds.related(F1, 'attaches', 'incoming', 'ChMessage');
    expect(inc.map((r) => r.id)).toEqual([M1]);
    // A slug with no matching relationship-type item resolves to nothing.
    const none = await ds.related(M1, 'mentions', 'outgoing', 'ChFile');
    expect(none).toEqual([]);
    // undefined = any type: still finds the attaches edge.
    const any = await ds.related(M1, undefined, 'outgoing', 'ChFile');
    expect(any.map((r) => r.id)).toEqual([F1]);
  });

  it('related(): a soft-deleted relationship item drops out', async () => {
    await pool.query(`UPDATE items SET deleted_at = now() WHERE id = $1`, [REL1]);
    try {
      const out = await ds.related(M1, 'attaches', 'outgoing', 'ChFile');
      expect(out).toEqual([]);
    } finally {
      await pool.query(`UPDATE items SET deleted_at = NULL WHERE id = $1`, [REL1]);
    }
  });

  it('runComputed: a declarative query-backed replyCount runs end-to-end', async () => {
    // The ch-message manifest declares replyCount computed with this backing id.
    const REPLY_COUNT_FN = '0c8a7b10-1111-4a00-8000-000000000203';
    const computed = new Map<string, any>([[REPLY_COUNT_FN, {
      kind: 'query', language: 'sql', scalar: true,
      // A reply is a message whose item.parent_id is this message (one-level tree).
      expression: `SELECT count(*)::int AS n FROM items WHERE parent_id = {{params.self}} AND type_id = '${chMessage.item.id}'`,
    }]]);
    const cds = new PgDataSource(pool, model, { computed });
    const cexec = new Executor(model, cds);
    // M1 has one reply (M2); M2 has none.
    const m1 = await cexec.resolveById('ChMessage', M1, { id: true, replyCount: true } as Selection);
    expect(m1).toEqual({ id: M1, replyCount: 1 });
    const m2 = await cexec.resolveById('ChMessage', M2, { id: true, replyCount: true } as Selection);
    expect(m2).toEqual({ id: M2, replyCount: 0 });
  });

  // A type whose obj_<type> projection has been dropped (kanecta-postgres drops it
  // when its last row is deleted) must read as EMPTY, not throw "relation does not
  // exist". Kept last: it drops the ChFile table for the rest of this describe.
  it('query/getById over a missing projection table read as empty (not error)', async () => {
    const fileTable = `obj_${chFile.item.id.replace(/-/g, '_')}`;
    await pool.query(`DROP TABLE IF EXISTS "${fileTable}"`);
    await expect(ds.query('ChFile', {})).resolves.toEqual([]);
    await expect(ds.getById('ChFile', F1)).resolves.toBeNull();
    await expect(exec.resolveList('ChFile', {}, { id: true })).resolves.toEqual([]);
  });
});
