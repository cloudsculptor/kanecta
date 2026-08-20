'use strict';

import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  Datastore,
  ROOT_ID,
  runSavedQuery,
  SavedQueryError,
  coerceQueryParamValue,
  resolveQueryParamValues,
} from '../src/index.ts';

function tmpDs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-savedquery-test-'));
  return Datastore.init(root, 'test@example.com');
}

// ─── coerceQueryParamValue ────────────────────────────────────────────────────

test('coerces text-form values per declared type', () => {
  expect(coerceQueryParamValue('n', 'number', '42')).toBe(42);
  expect(coerceQueryParamValue('b', 'boolean', 'true')).toBe(true);
  expect(coerceQueryParamValue('s', 'string', 7)).toBe('7');
  expect(coerceQueryParamValue('u', 'uuid', 'ABCDEF01-2345-6789-ABCD-EF0123456789'))
    .toBe('abcdef01-2345-6789-abcd-ef0123456789');
  expect(coerceQueryParamValue('d', 'date', '2026-01-02')).toBe('2026-01-02T00:00:00.000Z');
  expect(coerceQueryParamValue('x', 'string', null)).toBe(null);
});

test('rejects uncoercible values with bad-param', () => {
  for (const [type, raw] of [['number', 'seven'], ['boolean', 'yep'], ['uuid', 'not-a-uuid'], ['date', 'someday']] as const) {
    try {
      coerceQueryParamValue('p', type, raw);
      throw new Error('expected throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(SavedQueryError);
      expect(err.code).toBe('bad-param');
    }
  }
});

// ─── resolveQueryParamValues ──────────────────────────────────────────────────

test('caller value wins over defaultValue; defaultValue fills gaps; missing required throws', () => {
  const defs = [
    { name: 'status', type: 'string', defaultValue: 'active' },
    { name: 'limit', type: 'number', defaultValue: null },
  ];
  expect(resolveQueryParamValues(defs, { status: 'done', limit: 5 }))
    .toEqual({ status: 'done', limit: 5 });
  expect(resolveQueryParamValues(defs, { limit: 5 }))
    .toEqual({ status: 'active', limit: 5 });
  expect(() => resolveQueryParamValues(defs, {})).toThrow(/Missing required parameter/);
});

test('unknown caller params are rejected', () => {
  expect(() => resolveQueryParamValues([], { typo: 1 })).toThrow(/Unknown parameter/);
});

// ─── runReadOnlySql (sqlite-fs adapter via the facade) ────────────────────────

test('runReadOnlySql executes a parameterised SELECT against the index DB', async () => {
  const ds = tmpDs();
  await ds.create({ type: 'text', value: 'alpha', parentId: ROOT_ID });
  await ds.create({ type: 'text', value: 'beta', parentId: ROOT_ID });
  await ds.create({ type: 'url', value: 'https://example.com', parentId: ROOT_ID });

  // Datastore.init seeds a welcome text item, hence the LIKE guard.
  const result = await ds.runReadOnlySql(
    `SELECT id, type, value FROM items WHERE type = {{params.t}} AND value IN ('alpha', 'beta') ORDER BY value`,
    { t: 'text' },
  );
  expect(result.rows.map((r: any) => r.value)).toEqual(['alpha', 'beta']);
  expect(result.rowCount).toBe(2);
  expect(result.truncated).toBe(false);
  expect(result.columns.map((c: any) => c.name)).toEqual(['id', 'type', 'value']);
  fs.rmSync(ds.root, { recursive: true });
});

test('runReadOnlySql enforces the row cap and reports truncation', async () => {
  const ds = tmpDs();
  for (let i = 0; i < 5; i++) await ds.create({ type: 'text', value: `item-${i}`, parentId: ROOT_ID });
  const result = await ds.runReadOnlySql(
    `SELECT value FROM items WHERE type = 'text'`, {}, { rowLimit: 3 },
  );
  expect(result.rowCount).toBe(3);
  expect(result.truncated).toBe(true);
  fs.rmSync(ds.root, { recursive: true });
});

test('runReadOnlySql refuses writes at the database level', async () => {
  const ds = tmpDs();
  await expect(
    ds.runReadOnlySql(`INSERT INTO items (id, type, value) VALUES ('x', 'text', 'evil')`, {}),
  ).rejects.toThrow();
  fs.rmSync(ds.root, { recursive: true });
});

// ─── runSavedQuery (end to end over a query item) ─────────────────────────────

test('runSavedQuery executes a query item with query-param children', async () => {
  const ds = tmpDs();
  await ds.create({ type: 'text', value: 'note-one', parentId: ROOT_ID });
  await ds.create({ type: 'text', value: 'note-two', parentId: ROOT_ID });

  const q = await ds.create({
    type: 'query', value: 'items-by-type',
    objectData: {
      language: 'sql',
      expression: `SELECT value FROM items WHERE type = {{params.t}} AND value LIKE 'note-%' ORDER BY value`,
      returnType: null,
      description: 'All item values of one primitive type.',
    },
  });
  await ds.create({
    type: 'query-param', value: 't', parentId: q.id,
    objectData: { name: 't', type: 'string', defaultValue: 'text' },
  });

  // defaultValue path
  const byDefault = await runSavedQuery(ds, q.id);
  expect(byDefault.rows.map((r: any) => r.value)).toEqual(['note-one', 'note-two']);
  expect(byDefault.description).toBe('All item values of one primitive type.');

  // caller-supplied path
  const byCaller = await runSavedQuery(ds, q.id, { t: 'url' });
  expect(byCaller.rows).toEqual([]);
  fs.rmSync(ds.root, { recursive: true });
});

test('runSavedQuery rejects non-query items, unknown ids, and non-sql languages', async () => {
  const ds = tmpDs();
  const plain = await ds.create({ type: 'text', value: 'not a query', parentId: ROOT_ID });

  await expect(runSavedQuery(ds, '00000000-0000-0000-0000-00000000dead'))
    .rejects.toMatchObject({ code: 'not-found' });
  await expect(runSavedQuery(ds, plain.id))
    .rejects.toMatchObject({ code: 'not-a-query' });

  const kq = await ds.create({
    type: 'query', value: 'native-dsl',
    objectData: { language: 'kanecta', expression: 'type:task' },
  });
  await expect(runSavedQuery(ds, kq.id))
    .rejects.toMatchObject({ code: 'unsupported-language' });
  fs.rmSync(ds.root, { recursive: true });
});

test('runSavedQuery surfaces database rejections as sql-error', async () => {
  const ds = tmpDs();
  const q = await ds.create({
    type: 'query', value: 'broken',
    objectData: { language: 'sql', expression: 'SELECT * FROM no_such_table' },
  });
  await expect(runSavedQuery(ds, q.id)).rejects.toMatchObject({ code: 'sql-error' });
  fs.rmSync(ds.root, { recursive: true });
});
