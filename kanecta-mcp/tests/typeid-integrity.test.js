'use strict';

/**
 * Tests for typeId referential integrity (spec 03):
 *  - Writing an object whose typeId has no type definition warns by default
 *    (the write still succeeds) and throws under strict.
 *  - A registered typeId never warns.
 *  - Surfaced through the MCP kanecta_add_item / kanecta_update_item tools.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { Datastore } = require('@kanecta/lib');

const ORPHAN_TYPE_ID = 'deadbeef-0000-4000-8000-000000000000';

let tmpRoot;
let ds;
let dispatch;

beforeEach(() => {
  jest.resetModules();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-typeid-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  process.env.KANECTA_DATASTORE = tmpRoot;
  ({ dispatch } = require('../src/index'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.KANECTA_DATASTORE;
  jest.restoreAllMocks();
});

describe('add_item typeId referential integrity', () => {
  test('orphan typeId warns by default and still creates the item', async () => {
    const res = await dispatch('kanecta_add_item', { type: 'object', typeId: ORPHAN_TYPE_ID });
    expect(res.id).toBeTruthy();
    expect(res.warning).toMatch(new RegExp(ORPHAN_TYPE_ID));
    expect(res.warning).toMatch(/kanecta doctor/);
    // ...and it was actually written.
    expect(await ds.get(res.id)).toBeTruthy();
  });

  test('orphan typeId throws under strict and writes nothing', async () => {
    const before = (await ds.loadAll()).length;
    await expect(
      dispatch('kanecta_add_item', { type: 'object', typeId: ORPHAN_TYPE_ID, strict: true }),
    ).rejects.toThrow(/unknown typeId/);
    expect((await ds.loadAll()).length).toBe(before);
  });

  test('a registered typeId does not warn', async () => {
    const { metadata } = await ds.createType('widget');
    const res = await dispatch('kanecta_add_item', { type: 'object', typeId: metadata.id });
    expect(res.warning).toBeUndefined();
  });
});

describe('update_item typeId referential integrity', () => {
  test('changing typeId to an orphan warns by default', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    const res = await dispatch('kanecta_update_item', { id: item.id, type: 'object', typeId: ORPHAN_TYPE_ID });
    expect(res.warning).toMatch(new RegExp(ORPHAN_TYPE_ID));
  });

  test('changing typeId to an orphan under strict throws and leaves the item unchanged', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    await expect(
      dispatch('kanecta_update_item', { id: item.id, type: 'object', typeId: ORPHAN_TYPE_ID, strict: true }),
    ).rejects.toThrow(/unknown typeId/);
    const after = await ds.get(item.id);
    expect(after.type).toBe('string');
    expect(after.typeId).toBeNull();
  });
});
