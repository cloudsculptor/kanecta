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
import { buildSchemaModel, PgDataSource, Executor, type Selection } from '../../src/graphql/index.ts';
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

    // Minimal real schema: items (FK target) + relationships, then each type's
    // obj table straight from the compiler.
    await pool.query(`CREATE TABLE items (id UUID PRIMARY KEY, parent_id UUID, type_id UUID, deleted_at TIMESTAMPTZ)`);
    await pool.query(`CREATE TABLE relationships (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_id UUID, target_id UUID, type TEXT)`);
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
    await pool.query(`INSERT INTO relationships (source_id, target_id, type) VALUES ($1,$2,'attaches')`, [M1, F1]);

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

  it('applies the authz read gate against real rows', async () => {
    const denied = new Set([M2]);
    const rows = await exec.resolveList('ChMessage', {}, { id: true }, { authorize: (id) => !denied.has(id) });
    expect(rows.map((r) => r.id)).toEqual([M1]);
  });
});
