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
import { buildSourceTables, readPgCatalog, introspect } from '../src/index.ts';
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
    await pool.query(`CREATE TABLE ${schema}.authors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL)`);
    await pool.query(`
      CREATE TABLE ${schema}.threads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        author_id uuid REFERENCES ${schema}.authors(id),
        created_at timestamptz,
        sort_order integer
      )`);
    await pool.query(`CREATE UNIQUE INDEX threads_name_uq ON ${schema}.threads (sort_order, name)`);

    const tables = await readPgCatalog(pool, { schema });
    assert.deepEqual(tables.map((t) => t.name), ['authors', 'threads']);

    const threads = tables.find((t) => t.name === 'threads')!;
    assert.deepEqual(threads.primaryKey, ['id']);
    assert.equal(threads.columns.find((c) => c.name === 'id')!.sqlType, 'uuid');
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
