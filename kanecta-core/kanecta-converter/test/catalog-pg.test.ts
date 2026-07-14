// Tests for the Postgres catalog reader.
//
// Two layers, mirroring the module split:
//   * PURE — buildSourceTables over fixture rows (no database): proves the
//     row-shape → SourceTable[] assembly, including composite keys, per-column
//     FKs, multi-column/partial/expression indexes, and deterministic ordering.
//   * INTEGRATION (gated on KANECTA_TEST_PG_URL) — creates a throwaway schema with
//     a couple of real tables, runs readPgCatalog against it, then feeds the result
//     straight into introspect to prove catalog → SourceTable → type item end to end.

import { test } from 'node:test';
import assert from 'node:assert';
import { buildSourceTables, readPgCatalog, introspect, compareSchemas } from '../src/index.ts';
import type { CatalogRows } from '../src/index.ts';

// ─── Pure mapper ───────────────────────────────────────────────────────────────

test('buildSourceTables assembles columns, PK, FKs and indexes in order', () => {
  const rows: CatalogRows = {
    columns: [
      { table_name: 'threads', column_name: 'id', sql_type: 'uuid', nullable: false, column_default: 'gen_random_uuid()' },
      { table_name: 'threads', column_name: 'name', sql_type: 'text', nullable: false, column_default: null },
      { table_name: 'threads', column_name: 'author_id', sql_type: 'uuid', nullable: true, column_default: null },
      { table_name: 'authors', column_name: 'id', sql_type: 'uuid', nullable: false, column_default: null },
    ],
    primaryKeys: [
      { table_name: 'threads', column_name: 'id' },
      { table_name: 'authors', column_name: 'id' },
    ],
    foreignKeys: [
      { table_name: 'threads', column_name: 'author_id', ref_table: 'authors', ref_column: 'id' },
    ],
    indexes: [
      { table_name: 'threads', index_name: 'threads_name_idx', unique: false, column_name: 'name', where_pred: null },
    ],
  };

  const tables = buildSourceTables(rows);
  // Sorted by name → authors before threads.
  assert.deepEqual(tables.map((t) => t.name), ['authors', 'threads']);

  const threads = tables.find((t) => t.name === 'threads')!;
  assert.deepEqual(threads.columns.map((c) => c.name), ['id', 'name', 'author_id']);
  assert.equal(threads.columns[0].default, 'gen_random_uuid()');
  assert.equal(threads.columns[1].nullable, false);
  assert.deepEqual(threads.primaryKey, ['id']);
  assert.deepEqual(threads.foreignKeys, [{ column: 'author_id', references: { table: 'authors', column: 'id' } }]);
  assert.deepEqual(threads.indexes, [{ name: 'threads_name_idx', columns: ['name'] }]);
});

test('buildSourceTables preserves composite PK order and groups compound indexes', () => {
  const rows: CatalogRows = {
    columns: [
      { table_name: 'memberships', column_name: 'org_id', sql_type: 'uuid', nullable: false, column_default: null },
      { table_name: 'memberships', column_name: 'user_id', sql_type: 'uuid', nullable: false, column_default: null },
      { table_name: 'memberships', column_name: 'role', sql_type: 'text', nullable: true, column_default: null },
    ],
    primaryKeys: [
      { table_name: 'memberships', column_name: 'org_id' },
      { table_name: 'memberships', column_name: 'user_id' },
    ],
    foreignKeys: [],
    indexes: [
      { table_name: 'memberships', index_name: 'memberships_role_idx', unique: true, column_name: 'org_id', where_pred: 'role IS NOT NULL' },
      { table_name: 'memberships', index_name: 'memberships_role_idx', unique: true, column_name: 'role', where_pred: 'role IS NOT NULL' },
    ],
  };
  const [t] = buildSourceTables(rows);
  assert.deepEqual(t.primaryKey, ['org_id', 'user_id']);
  assert.deepEqual(t.indexes, [{ name: 'memberships_role_idx', columns: ['org_id', 'role'], unique: true, where: 'role IS NOT NULL' }]);
});

test('buildSourceTables skips expression-index members (null column)', () => {
  const rows: CatalogRows = {
    columns: [{ table_name: 't', column_name: 'a', sql_type: 'text', nullable: true, column_default: null }],
    primaryKeys: [],
    foreignKeys: [],
    indexes: [
      { table_name: 't', index_name: 'lower_a_idx', unique: false, column_name: null, where_pred: null },
    ],
  };
  const [t] = buildSourceTables(rows);
  // The all-expression index has no transcribable columns → dropped.
  assert.equal(t.indexes, undefined);
});

test('buildSourceTables drops a MIXED column+expression index (no fabricated narrower constraint)', () => {
  // Mirrors push_subscriptions' UNIQUE (user_id, (subscription->>'endpoint')): the
  // expression member is not transcribable, so keeping only user_id would fabricate
  // a UNIQUE (user_id) that wrongly forbids two subscriptions per user. Drop it whole.
  const rows: CatalogRows = {
    columns: [
      { table_name: 'subs', column_name: 'id', sql_type: 'integer', nullable: false, column_default: null },
      { table_name: 'subs', column_name: 'user_id', sql_type: 'uuid', nullable: false, column_default: null },
      { table_name: 'subs', column_name: 'data', sql_type: 'jsonb', nullable: false, column_default: null },
    ],
    primaryKeys: [{ table_name: 'subs', column_name: 'id' }],
    foreignKeys: [],
    indexes: [
      { table_name: 'subs', index_name: 'subs_user_endpoint', unique: true, column_name: 'user_id', where_pred: null },
      { table_name: 'subs', index_name: 'subs_user_endpoint', unique: true, column_name: null, where_pred: null },
    ],
  };
  const [t] = buildSourceTables(rows);
  assert.equal(t.indexes, undefined, 'the mixed unique index must not survive as UNIQUE (user_id)');
});

test('buildSourceTables attaches enum labels; introspect emits an enum constraint (faithful)', () => {
  const rows: CatalogRows = {
    columns: [
      { table_name: 'events', column_name: 'id', sql_type: 'uuid', nullable: false, column_default: 'gen_random_uuid()' },
      { table_name: 'events', column_name: 'status', sql_type: 'event_status', nullable: false, column_default: "'pending'::event_status" },
    ],
    primaryKeys: [{ table_name: 'events', column_name: 'id' }],
    foreignKeys: [],
    indexes: [],
    enums: [
      { table_name: 'events', column_name: 'status', label: 'pending' },
      { table_name: 'events', column_name: 'status', label: 'approved' },
      { table_name: 'events', column_name: 'status', label: 'rejected' },
    ],
  };
  const [events] = buildSourceTables(rows);
  assert.deepEqual(events.columns.find((c) => c.name === 'status')!.enumValues, ['pending', 'approved', 'rejected']);

  const { typeItem, report } = introspect(events);
  assert.deepEqual(typeItem.payload.jsonSchema.properties.status.enum, ['pending', 'approved', 'rejected']);
  assert.equal(typeItem.payload.jsonSchema.properties.status.type, 'string');
  assert.ok(report.seams.some((s) => s.kind === 'enum-to-constraint'));

  // The enum column is a known-nuance (enum → text + constraint), not a divergence.
  const fidelity = compareSchemas(events, typeItem);
  assert.equal(fidelity.verdict, 'faithful');
  assert.ok(fidelity.columns.some((c) => c.source === 'status' && c.status === 'known-nuance'));
});

// ─── Live integration (gated) ──────────────────────────────────────────────────

const PG_URL = process.env.KANECTA_TEST_PG_URL;

test('readPgCatalog reads a real schema and feeds introspect', { skip: !PG_URL }, async () => {
  // `pg` is a runtime-only import (see test/vendor.d.ts) — not a converter dep.
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: PG_URL });
  const schema = 'kanecta_converter_catalog_test';
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TYPE ${schema}.thread_status AS ENUM ('open', 'archived')`);
    await pool.query(`CREATE TABLE ${schema}.authors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL)`);
    await pool.query(`
      CREATE TABLE ${schema}.threads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        author_id uuid REFERENCES ${schema}.authors(id),
        status ${schema}.thread_status NOT NULL DEFAULT 'open',
        created_at timestamptz,
        sort_order integer
      )`);
    await pool.query(`CREATE UNIQUE INDEX threads_name_uq ON ${schema}.threads (sort_order, name)`);

    const tables = await readPgCatalog(pool, { schema });
    assert.deepEqual(tables.map((t) => t.name), ['authors', 'threads']);

    const threads = tables.find((t) => t.name === 'threads')!;
    assert.deepEqual(threads.primaryKey, ['id']);
    assert.equal(threads.columns.find((c) => c.name === 'id')!.sqlType, 'uuid');
    assert.deepEqual(threads.columns.find((c) => c.name === 'status')!.enumValues, ['open', 'archived']);
    assert.match(threads.columns.find((c) => c.name === 'created_at')!.sqlType, /timestamp/);
    assert.deepEqual(threads.foreignKeys, [{ column: 'author_id', references: { table: 'authors', column: 'id' } }]);
    assert.ok(threads.indexes!.some((i) => i.unique && i.columns.join(',') === 'sort_order,name'));

    // catalog → SourceTable → type item: the FK resolves and the type projects.
    const { report } = introspect(threads, { typeIdForTable: (t) => (t === 'authors' ? 'AUTHOR-TYPE-UUID' : undefined) });
    assert.ok(report.references.some((r) => r.field === 'authorId' && r.resolved));
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end();
  }
});
