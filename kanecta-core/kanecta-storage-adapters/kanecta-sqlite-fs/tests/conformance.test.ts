'use strict';

// Four-table-law conformance for the SQLite index (spec §cqrs-projections) —
// the sqlite-fs counterpart of @kanecta/postgres tests/conformance.test.ts.
// The law applies to every SQL adapter equally; the SQLite adapter is not
// exempt. These tests are the strict gate: a fresh index.db (and one that has
// seen real writes, projections, and a legacy-era upgrade) must classify with
// ZERO violations, and the retired bespoke tables must stay gone.

import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { SqliteFsAdapter } from '../src/adapter';
import { classifyTable, checkConformance } from '../src/conformance';

function tmpAdapter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-conf-'));
  return SqliteFsAdapter.init(root, 'test@example.com');
}
function cleanup(a: any) { fs.rmSync(a.root, { recursive: true, force: true }); }

const tableNames = (a: any): string[] =>
  a._openDb().prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()
    .map((r: any) => r.name);

describe('classifyTable', () => {
  test('classifies every legitimate kind', () => {
    expect(classifyTable('items')).toBe('items');
    expect(classifyTable('items_meta')).toBe('items');
    expect(classifyTable('items_search')).toBe('items');
    expect(classifyTable('items_time')).toBe('items');
    expect(classifyTable('items_payload')).toBe('items');
    expect(classifyTable('item_history')).toBe('item_history');
    expect(classifyTable('activity')).toBe('activity');
    expect(classifyTable('obj_aaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee')).toBe('obj');
    expect(classifyTable('obj_aaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee_tags')).toBe('obj');
    expect(classifyTable('perf_backlinks')).toBe('perf');
    expect(classifyTable('perf_tags')).toBe('perf');
    expect(classifyTable('sqlite_sequence')).toBe('sqlite');
  });

  test('the retired bespoke tables are violations', () => {
    for (const legacy of ['history', 'backlinks', 'item_tags', 'type_defs',
                          'aliases', 'relationships', 'rel_types', 'types', 'config']) {
      expect(classifyTable(legacy)).toBe('violation');
    }
  });
});

describe('the strict gate: a live index.db conforms', () => {
  test('fresh datastore + real writes + projections → zero violations', () => {
    const a = tmpAdapter();
    // exercise the surfaces that create tables: typed objects (obj_ projection),
    // tags + [[links]] (perf tables), delete (item_history), sidecars.
    const { metadata: t } = a.createType('ConfThing', { icon: 'Category' });
    const x = a.create({ value: 'x', type: 'object', typeId: t.id, objectData: { name: 'one' } });
    const y = a.create({ value: `see [[${x.id}]]`, tags: ['conf'] });
    a.putFile(x.id, 'blob.bin', Buffer.from('bytes'));
    a.delete(y.id);

    const report = checkConformance(tableNames(a));
    expect(report.violations).toEqual([]);
    expect(report.conformant).toBe(true);
    expect(report.counts.items).toBe(5);           // spine + 4 sections
    expect(report.counts.obj).toBeGreaterThan(0);  // ConfThing (+ built-ins)
    expect(report.counts.perf).toBeGreaterThan(0);
    cleanup(a);
  });

  test('regression: each retired table stays gone', () => {
    const a = tmpAdapter();
    const names = new Set(tableNames(a));
    for (const legacy of ['history', 'backlinks', 'item_tags', 'type_defs']) {
      expect(names.has(legacy)).toBe(false);
    }
    // and both exempt logs exist under their lawful names
    expect(names.has('item_history')).toBe(true);
    expect(names.has('activity')).toBe(true);
    cleanup(a);
  });

  test('a legacy-era index.db is upgraded on open: wiped and rebuilt conformant', () => {
    const a = tmpAdapter();
    const kept = a.create({ value: 'survives the index upgrade' });
    const dbPath = path.join(a._branchRoot(), 'index.db');
    // Regress the index to the legacy era: close, then plant a bespoke table.
    a._db.close(); a._db = null;
    const raw = new Database(dbPath);
    raw.exec(`CREATE TABLE history (seq INTEGER PRIMARY KEY, item_id TEXT)`);
    raw.exec(`CREATE TABLE type_defs (id TEXT PRIMARY KEY)`);
    raw.close();

    // Reopen: the adapter must detect the legacy tables, discard the derived
    // index, and rebuild from the filesystem — data intact, tables lawful.
    const report = checkConformance(tableNames(a));
    expect(report.violations).toEqual([]);
    expect(a.get(kept.id).value).toBe('survives the index upgrade');
    cleanup(a);
  });
});
