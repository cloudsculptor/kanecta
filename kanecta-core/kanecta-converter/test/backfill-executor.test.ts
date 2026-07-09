// Tests for the backfill executor. Unit: the column-name mapping. Integration
// (gated on KANECTA_TEST_PG_URL): apply a real plan against a throwaway schema,
// assert items/obj/relationship rows, then re-apply to prove idempotency (no
// duplicate items, no duplicate edges).

import { test } from 'node:test';
import assert from 'node:assert';
import { camelToSnake, planBackfill, applyBackfillPlan } from '../src/index.ts';
import type { SourceTable } from '../src/index.ts';

test('camelToSnake mirrors the compiler column naming', () => {
  assert.equal(camelToSnake('threadId'), 'thread_id');
  assert.equal(camelToSnake('parentMessageId'), 'parent_message_id');
  assert.equal(camelToSnake('latestMessageAt'), 'latest_message_at');
  assert.equal(camelToSnake('content'), 'content');
});

const messages: SourceTable = {
  name: 'discussions_messages',
  primaryKey: ['id'],
  foreignKeys: [
    { column: 'thread_id', references: { table: 'discussions_threads', column: 'id' } },
    { column: 'parent_message_id', references: { table: 'discussions_messages', column: 'id' } },
  ],
  columns: [
    { name: 'id', sqlType: 'uuid', nullable: false },
    { name: 'thread_id', sqlType: 'uuid', nullable: false },
    { name: 'parent_message_id', sqlType: 'uuid', nullable: true },
    { name: 'content', sqlType: 'text', nullable: false },
  ],
};

const PG_URL = process.env.KANECTA_TEST_PG_URL;
const TYPE_ID = '0c8a7b10-1111-4a00-8000-000000000102';
const M1 = 'aa000000-0000-4000-8000-000000000001';
const M2 = 'aa000000-0000-4000-8000-000000000002';
const T1 = 'aa000000-0000-4000-8000-0000000000ff';

test('applyBackfillPlan writes items/obj/relationships and is idempotent', { skip: !PG_URL }, async () => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: PG_URL });
  // applyBackfillPlan takes the POOL directly — it checks out its own connection for
  // the txn. Pass opts.searchPath so its connection resolves the throwaway schema.
  const schema = 'kanecta_converter_backfill_test';
  const obj = `obj_${TYPE_ID.replace(/-/g, '_')}`;
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE ${schema}.items (
      id uuid PRIMARY KEY, parent_id uuid, value text, type varchar(50) NOT NULL, type_id uuid,
      owner varchar(255) NOT NULL, sort_order int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL, modified_at timestamptz NOT NULL,
      created_by varchar(255) NOT NULL, modified_by varchar(255) NOT NULL,
      tags text[] NOT NULL DEFAULT '{}', deleted_at timestamptz,
      source_system text, source_external_id text)`);
    await pool.query(`CREATE UNIQUE INDEX ON ${schema}.items (source_system, source_external_id)
      WHERE source_system IS NOT NULL AND source_external_id IS NOT NULL`);
    await pool.query(`CREATE TABLE ${schema}.relationships (
      id uuid PRIMARY KEY, source_id uuid NOT NULL, target_id uuid NOT NULL,
      type varchar(50) NOT NULL, created_at timestamptz NOT NULL, created_by varchar(255) NOT NULL)`);
    await pool.query(`CREATE TABLE ${schema}.${obj} (
      item_id uuid PRIMARY KEY, thread_id uuid, parent_message_id uuid, content text)`);

    const rows = [
      { id: M1, thread_id: T1, parent_message_id: null, content: 'Hello' },
      { id: M2, thread_id: T1, parent_message_id: M1, content: 'Reply' },
    ];
    const plan = planBackfill(messages, rows, {
      typeId: TYPE_ID, sourceSystem: 'community-hub',
      parentColumn: 'thread_id', relationshipTypes: { parent_message_id: 'replyTo' },
    });

    // search_path is set on this connection, so unqualified table names resolve.
    const first = await applyBackfillPlan(pool, plan, { searchPath: schema });
    assert.equal(first.items, 2);
    assert.equal(first.objects, 2);
    assert.equal(first.relationships, 1); // only M2 → M1

    // Rows landed with the idempotency key + preserved UUIDs + parent + obj data.
    const { rows: got } = await pool.query(`SELECT id, parent_id, source_external_id FROM ${schema}.items ORDER BY id`);
    assert.deepEqual(got.map((r: any) => r.id), [M1, M2]);
    assert.equal(got.find((r: any) => r.id === M1).source_external_id, `discussions_messages:${M1}`);
    assert.equal(got.find((r: any) => r.id === M2).parent_id, T1);
    const { rows: objRows } = await pool.query(`SELECT content FROM ${schema}.${obj} WHERE item_id = $1`, [M1]);
    assert.equal(objRows[0].content, 'Hello');

    // Re-apply → idempotent: still 2 items, 1 edge, 0 new edges inserted.
    const second = await applyBackfillPlan(pool, plan, { searchPath: schema });
    assert.equal(second.relationships, 0); // guarded insert added nothing
    const { rows: cnt } = await pool.query(`SELECT count(*)::int AS n FROM ${schema}.items`);
    assert.equal(cnt[0].n, 2);
    const { rows: rcnt } = await pool.query(`SELECT count(*)::int AS n FROM ${schema}.relationships`);
    assert.equal(rcnt[0].n, 1);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
