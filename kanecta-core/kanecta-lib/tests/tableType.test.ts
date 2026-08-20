'use strict';

// The `table` built-in type (spec §tablePayload): a configured tabular
// presentation of a saved query. Verifies the seed registers, instances
// project (typeId resolved, payload round-trips including the opaque-JSON
// defaultFilters/queryParams columns), and table-column children carry the
// per-column overrides.

import os from 'os';
import path from 'path';
import fs from 'fs';
import { Datastore } from '../src/index.ts';

const TABLE_TYPE_ID = '3f4550c2-de4e-4662-8b17-593a36fcd74e';
const TABLE_COLUMN_TYPE_ID = '0d27fbff-2ad1-4c3d-b3c1-4ae91b519f3a';

function tmpDs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-table-type-test-'));
  return Datastore.init(root, 'test@example.com');
}

test('table + table-column instances project and round-trip their payloads', async () => {
  const ds = tmpDs();
  const q = await ds.create({
    type: 'query', value: 'all-text',
    objectData: { language: 'sql', expression: `SELECT id, value FROM items WHERE type = 'text'` },
  });

  const t = await ds.create({
    type: 'table', value: 'text-table',
    objectData: {
      queryId: q.id,
      queryParams: null,
      defaultSortField: 'value',
      defaultSortDirection: 'asc',
      defaultFilters: { value: { filterType: 'text', type: 'contains', filter: 'a' } },
      pageSize: 25,
      rowLimit: null,
      description: null,
    },
  });
  expect(t.typeId).toBe(TABLE_TYPE_ID);

  const payload = await ds.readObjectJson(t.id);
  expect(payload.queryId).toBe(q.id);
  expect(payload.defaultSortField).toBe('value');
  expect(payload.defaultFilters).toEqual({ value: { filterType: 'text', type: 'contains', filter: 'a' } });
  expect(payload.pageSize).toBe(25);

  const col = await ds.create({
    type: 'table-column', value: 'value', parentId: t.id,
    objectData: { field: 'value', label: 'Item value', width: 240, hidden: false },
  });
  expect(col.typeId).toBe(TABLE_COLUMN_TYPE_ID);
  expect(col.parentId).toBe(t.id);

  const colPayload = await ds.readObjectJson(col.id);
  expect(colPayload).toMatchObject({ field: 'value', label: 'Item value', width: 240 });

  const kids = await ds.children(t.id);
  expect(kids.filter((k: any) => k.type === 'table-column')).toHaveLength(1);
  fs.rmSync(ds.root, { recursive: true });
});

test('a table payload missing queryId is rejected', async () => {
  const ds = tmpDs();
  await expect(
    ds.create({ type: 'table', value: 'no-query', objectData: { pageSize: 10 } }),
  ).rejects.toThrow(/queryId/);
  fs.rmSync(ds.root, { recursive: true });
});
