/**
 * kanecta_run_query — executes a saved query item (spec §queryPayload) through
 * the shared runSavedQuery path: query-param resolution, parameter binding,
 * DB-level read-only guard, row cap. SavedQueryError surfaces as {error, code}
 * instead of throwing so MCP clients get a structured refusal.
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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-run-query-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  singleConfig(tmpRoot);
  ({ dispatch } = await import('../src/index.ts'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  clearConfigEnv();
  vi.restoreAllMocks();
});

async function seedQuery() {
  await ds.create({ type: 'text', value: 'rq-one', parentId: ROOT_ID });
  await ds.create({ type: 'text', value: 'rq-two', parentId: ROOT_ID });
  const q = await ds.create({
    type: 'query', value: 'items-by-type',
    objectData: {
      language: 'sql',
      expression: `SELECT value FROM items WHERE type = {{params.t}} AND value LIKE 'rq-%' ORDER BY value`,
      description: 'rq test query',
    },
  });
  await ds.create({
    type: 'query-param', value: 't', parentId: q.id,
    objectData: { name: 't', type: 'string', defaultValue: 'text' },
  });
  return q;
}

test('runs a saved query via defaultValue and via caller params', async () => {
  const q = await seedQuery();

  const byDefault = await dispatch('kanecta_run_query', { id: q.id });
  expect(byDefault.rows.map((r) => r.value)).toEqual(['rq-one', 'rq-two']);
  expect(byDefault.rowCount).toBe(2);
  expect(byDefault.truncated).toBe(false);
  expect(byDefault.description).toBe('rq test query');

  const byCaller = await dispatch('kanecta_run_query', { id: q.id, params: { t: 'url' } });
  expect(byCaller.rows).toEqual([]);
});

test('respects rowLimit and reports truncation', async () => {
  const q = await seedQuery();
  const res = await dispatch('kanecta_run_query', { id: q.id, rowLimit: 1 });
  expect(res.rowCount).toBe(1);
  expect(res.truncated).toBe(true);
});

test('surfaces SavedQueryError as {error, code} rather than throwing', async () => {
  const plain = await ds.create({ type: 'text', value: 'not a query', parentId: ROOT_ID });

  const notFound = await dispatch('kanecta_run_query', { id: '00000000-0000-0000-0000-00000000dead' });
  expect(notFound.code).toBe('not-found');

  const notAQuery = await dispatch('kanecta_run_query', { id: plain.id });
  expect(notAQuery.code).toBe('not-a-query');

  const q = await seedQuery();
  const badParam = await dispatch('kanecta_run_query', { id: q.id, params: { typo: 1 } });
  expect(badParam.code).toBe('bad-param');

  const broken = await ds.create({
    type: 'query', value: 'broken',
    objectData: { language: 'sql', expression: 'SELECT * FROM no_such_table' },
  });
  const sqlError = await dispatch('kanecta_run_query', { id: broken.id });
  expect(sqlError.code).toBe('sql-error');
});
