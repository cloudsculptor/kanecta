// Four-table-law conformance guardrail (spec §cqrs-projections).
//
// Unit: the pure classifier. Integration (gated): apply the full migration set to a
// throwaway schema, enumerate its tables, and REPORT the backlog of non-conforming
// tables — the uniform-projection modernisation removes them one by one. It is
// deliberately non-strict for now (it asserts `items` exists and logs the backlog);
// flip the marked assertion to `expect(report.conformant).toBe(true)` once the epic
// completes, and this becomes the gate that prevents the drift ever recurring.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTable, checkConformance } from '../src/conformance.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('classifyTable', () => {
  it('accepts only the four legitimate kinds', () => {
    expect(classifyTable('items')).toBe('items');
    expect(classifyTable('item_history')).toBe('item_history');
    expect(classifyTable('activity')).toBe('activity');
    expect(classifyTable('obj_0c8a7b10_1111_4a00_8000_000000000102')).toBe('obj');
    expect(classifyTable('obj_0c8a7b10_1111_4a00_8000_000000000102_tags')).toBe('obj'); // array child
    expect(classifyTable('perf_search')).toBe('perf');
  });
  it('flags everything else as a violation', () => {
    for (const t of ['types', 'documents', 'functions', 'item_grants', 'aliases', 'config', 'schema_version', 'history'])
      expect(classifyTable(t)).toBe('violation');
  });
});

describe('checkConformance', () => {
  it('is conformant only when every table is a legitimate kind', () => {
    expect(checkConformance(['items', 'item_history', 'activity', 'perf_search', 'obj_0c8a7b10_1111_4a00_8000_000000000102']).conformant).toBe(true);
    const bad = checkConformance(['items', 'documents', 'types']);
    expect(bad.conformant).toBe(false);
    expect(bad.violations).toEqual(['documents', 'types']);
  });
});

const PG_URL = process.env.KANECTA_TEST_PG_URL;

describe.skipIf(!PG_URL)('live schema conformance (the modernisation backlog)', () => {
  it('reports non-conforming tables in a freshly-migrated schema', async () => {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: PG_URL });
    const schema = 'kanecta_conformance_check';
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.query(`CREATE SCHEMA ${schema}`);
      // Apply every migration in order on one connection so search_path persists.
      const client = await pool.connect();
      try {
        await client.query(`SET search_path = ${schema}`);
        const dir = path.join(__dirname, '..', 'migrations');
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
          await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        }
      } finally {
        client.release();
      }
      const { rows } = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`, [schema],
      );
      const tables = rows.map((r: any) => r.tablename);
      const report = checkConformance(tables);
      // eslint-disable-next-line no-console
      console.log(
        `\n[four-table-law] ${tables.length - report.violations.length}/${tables.length} tables conform. ` +
        `Backlog (${report.violations.length}):\n  ${report.violations.join('\n  ')}\n`,
      );
      expect(tables).toContain('items');
      // Regression guard: every bespoke table retired by the uniform-projection
      // epic must stay gone. rel_types + relationships were the last two cut
      // (Part 3, migrations 039/040); types/config/aliases/annotations/licences/
      // functions/documents/item_grants/files/schema_version went earlier.
      for (const cut of [
        'rel_types', 'relationships', 'types', 'config', 'aliases', 'annotations',
        'licences', 'functions', 'documents', 'item_grants', 'files', 'schema_version',
      ]) {
        expect(report.violations).not.toContain(cut);
      }
      // Only the post-1.4.0 branching tables remain (separately tracked, deferred).
      expect(report.violations).toEqual(['branch_changes', 'branches']);
      // TODO(uniform-projection-modernisation): flip to the strict gate
      // (expect(report.conformant).toBe(true)) once branches/branch_changes are
      // themselves projected — the last of the backlog.
      expect(report).toBeTruthy();
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
      await pool.end();
    }
  });
});
