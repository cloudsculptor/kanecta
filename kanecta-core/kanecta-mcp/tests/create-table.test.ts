/**
 * kanecta_create_table — validating composite create for table items (spec
 * §tablePayload). One call resolves or creates the query, dry-runs the SQL
 * before anything permanent exists, warns on field references the result set
 * cannot satisfy, scaffolds Title Case columns when none are given, and rolls
 * back everything it created when the dry run fails.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { Datastore, ROOT_ID } from '@kanecta/lib';
import { vi } from 'vitest';
import { singleConfig, clearConfigEnv } from './helpers.ts';

let tmpRoot;
let ds;
let dispatch;

beforeEach(async () => {
  vi.resetModules();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-create-table-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  singleConfig(tmpRoot);
  ({ dispatch } = await import('../src/index.ts'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  clearConfigEnv();
  vi.restoreAllMocks();
});

const SQL = `SELECT id, value FROM items WHERE type = 'text' AND value LIKE 'ct-%' ORDER BY value`;

test('creates query + table in one call and auto-scaffolds Title Case columns', async () => {
  await ds.create({ type: 'text', value: 'ct-alpha', parentId: ROOT_ID });

  const res = await dispatch('kanecta_create_table', {
    value: 'texts table',
    query: { expression: SQL },
    pageSize: 25,
  });

  expect(res.error).toBeUndefined();
  expect(res.query.value).toBe('texts table query');
  expect(res.resultColumns).toEqual(['id', 'value']);
  // No columns supplied -> one table-column child per result column, Title Case label.
  expect(res.columns.map((c) => c.field)).toEqual(['id', 'value']);

  const payload = await ds.readObjectJson(res.table.id);
  expect(payload.queryId).toBe(res.queryId);
  expect(payload.pageSize).toBe(25);

  const kids = (await ds.children(res.table.id)).filter((k) => k.type === 'table-column');
  expect(kids).toHaveLength(2);
  const labels = [];
  for (const kid of kids) labels.push((await ds.readObjectJson(kid.id)).label);
  expect(labels.sort()).toEqual(['Id', 'Value']);

  // The created stack renders end-to-end through the run path.
  const run = await dispatch('kanecta_run_query', { id: res.queryId });
  expect(run.rows.map((r) => r.value)).toEqual(['ct-alpha']);
});

test('references an existing query, applies explicit columns, warns on ghost fields', async () => {
  const q = await ds.create({
    type: 'query', value: 'existing',
    objectData: { language: 'sql', expression: SQL },
  });

  const res = await dispatch('kanecta_create_table', {
    value: 'with overrides',
    queryId: q.id,
    columns: [
      { field: 'value', label: 'Item value', width: 240 },
      { field: 'ghost', label: 'Not real' },
    ],
    defaultSortField: 'nope',
  });

  expect(res.error).toBeUndefined();
  expect(res.query).toBeUndefined(); // nothing new created for the query
  expect(res.queryId).toBe(q.id);
  expect(res.columns.map((c) => c.field)).toEqual(['value', 'ghost']);
  expect(res.warnings.join(' ')).toMatch(/ghost/);
  expect(res.warnings.join(' ')).toMatch(/nope/);
});

test('rolls back an inline query when the SQL is broken, and rejects bad references', async () => {
  const countItems = async () =>
    (await ds.runReadOnlySql('SELECT COUNT(*) AS c FROM items', {})).rows[0].c;
  const before = await countItems();

  const broken = await dispatch('kanecta_create_table', {
    value: 'doomed',
    query: { expression: 'SELECT * FROM no_such_table' },
  });
  expect(broken.code).toBe('sql-error');
  expect(broken.rolledBack).toBe(true);
  expect(await countItems()).toBe(before); // nothing left behind

  const notAQuery = await ds.create({ type: 'text', value: 'plain', parentId: ROOT_ID });
  const badRef = await dispatch('kanecta_create_table', { value: 't', queryId: notAQuery.id });
  expect(badRef.code).toBe('not-a-query');

  const both = await dispatch('kanecta_create_table', {
    value: 't', queryId: notAQuery.id, query: { expression: SQL },
  });
  expect(both.code).toBe('bad-request');

  const neither = await dispatch('kanecta_create_table', { value: 't' });
  expect(neither.code).toBe('bad-request');
});

test('required params without values skip the dry run with a warning but still create', async () => {
  const res = await dispatch('kanecta_create_table', {
    value: 'param table',
    query: {
      expression: `SELECT value FROM items WHERE type = {{params.t}}`,
      params: [{ name: 't', type: 'string' }], // no defaultValue, none supplied
    },
  });

  expect(res.error).toBeUndefined();
  expect(res.resultColumns).toBeUndefined();
  expect(res.warnings.join(' ')).toMatch(/dry run skipped/i);
  expect(res.columns).toEqual([]); // nothing to scaffold from
  expect((await ds.readObjectJson(res.table.id)).queryId).toBe(res.queryId);
});
