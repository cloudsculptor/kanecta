'use strict';

/**
 * Tests for kanecta_query enhancements:
 *  - Bug 3 fix: case-insensitive severity and status normalisation in where filters
 *  - mode="count": returns {count:N} instead of items array
 *  - mode="group_by": returns {groups:{value:count}} bucketed by any objectData field
 *  - Unchanged behaviour: normal query (no mode) still returns items array
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { Datastore } = require('@kanecta/lib');

let tmpRoot;
let ds;
let dispatch;

beforeEach(() => {
  jest.resetModules();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-query-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  process.env.KANECTA_DATASTORE = tmpRoot;
  ({ dispatch } = require('../src/index'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.KANECTA_DATASTORE;
  jest.restoreAllMocks();
});

/** Create an item with the given objectData in the temp store. */
async function seed(value, objectData) {
  const item = await ds.create({ value, type: 'object' });
  await ds.writeObjectJson(item.id, objectData);
  return item;
}

// ─── Case normalisation — severity ───────────────────────────────────────────

describe('severity normalisation in where filter', () => {
  beforeEach(async () => {
    await seed('item-p1', { severity: 'P1', status: 'open' });
    await seed('item-p2', { severity: 'P2', status: 'open' });
  });

  test('lowercase severity matches same items as uppercase', async () => {
    const lower = await dispatch('kanecta_query', { type: 'object', where: { severity: 'p1' } });
    const upper = await dispatch('kanecta_query', { type: 'object', where: { severity: 'P1' } });
    expect(lower.items).toHaveLength(upper.items.length);
    expect(lower.items.map(i => i.value)).toEqual(upper.items.map(i => i.value));
  });

  test('lowercase severity returns the correct item', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', where: { severity: 'p2' } });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].value).toBe('item-p2');
  });

  test('op-style severity predicate normalises value to uppercase', async () => {
    // where: {severity: {op: '!=', value: 'p1'}} should exclude P1 and return only P2
    const res = await dispatch('kanecta_query', { type: 'object', where: { severity: { op: '!=', value: 'p1' } } });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].value).toBe('item-p2');
  });

  test('uppercase severity continues to work (no regression)', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', where: { severity: 'P1' } });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].value).toBe('item-p1');
  });
});

// ─── Case normalisation — status ─────────────────────────────────────────────

describe('status normalisation in where filter', () => {
  beforeEach(async () => {
    await seed('item-open',  { status: 'open',  severity: 'P1' });
    await seed('item-fixed', { status: 'fixed', severity: 'P1' });
  });

  test('uppercase status matches same items as lowercase', async () => {
    const upper = await dispatch('kanecta_query', { type: 'object', where: { status: 'OPEN' } });
    const lower = await dispatch('kanecta_query', { type: 'object', where: { status: 'open' } });
    expect(upper.items).toHaveLength(lower.items.length);
    expect(upper.items.map(i => i.value)).toEqual(lower.items.map(i => i.value));
  });

  test('mixed-case status normalises to lowercase', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', where: { status: 'Fixed' } });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].value).toBe('item-fixed');
  });

  test('op-style status predicate normalises value to lowercase', async () => {
    // where: {status: {op: '!=', value: 'FIXED'}} should exclude fixed, return open
    const res = await dispatch('kanecta_query', { type: 'object', where: { status: { op: '!=', value: 'FIXED' } } });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].value).toBe('item-open');
  });

  test('lowercase status continues to work (no regression)', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', where: { status: 'open' } });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].value).toBe('item-open');
  });
});

// ─── Aggregation modes must NOT apply the default 50-item cap ─────────────────
// Regression for the count/group_by limit bug: the handler stripped `limit` (→ undefined),
// which the adapter reads as the default cap of 50 — silently under-counting any bucket > 50.
// The 2-3 item fixtures elsewhere can't catch this, so exercise it with > 50 items.
describe('aggregation modes ignore the default 50-item limit (regression)', () => {
  beforeEach(() => {
    for (let i = 0; i < 60; i++) {
      seed(`bulk-${i}`, { severity: i % 2 === 0 ? 'P1' : 'P2', status: 'open' });
    }
  });

  test('count returns all 60 matches, not 50', () => {
    const res = dispatch('kanecta_query', { type: 'object', mode: 'count' });
    expect(res.count).toBe(60);
  });

  test('group_by buckets sum to all 60 matches, not 50', () => {
    const res = dispatch('kanecta_query', { type: 'object', mode: 'group_by', group_by_field: 'severity' });
    const total = Object.values(res.groups).reduce((a, b) => a + b, 0);
    expect(total).toBe(60);
    expect(res.groups.P1).toBe(30);
    expect(res.groups.P2).toBe(30);
  });
});

// ─── mode="count" ─────────────────────────────────────────────────────────────

describe('mode="count"', () => {
  beforeEach(async () => {
    await seed('item-1', { severity: 'P1', status: 'open' });
    await seed('item-2', { severity: 'P2', status: 'open' });
    await seed('item-3', { severity: 'P1', status: 'fixed' });
  });

  test('returns an object with count, not an items array', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'count' });
    expect(res).toHaveProperty('count');
    expect(res).not.toHaveProperty('items');
  });

  test('count with no filter equals total item count', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'count' });
    expect(res.count).toBe(3);
  });

  test('count with severity filter returns filtered count', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'count', where: { severity: 'P1' } });
    expect(res.count).toBe(2);
  });

  test('count with status filter returns filtered count', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'count', where: { status: 'open' } });
    expect(res.count).toBe(2);
  });

  test('count with combined where filters', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'count', where: { severity: 'P1', status: 'open' } });
    expect(res.count).toBe(1);
  });

  test('count returns zero when nothing matches', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'count', where: { severity: 'P4' } });
    expect(res.count).toBe(0);
  });

  test('count ignores the limit param — returns all matches', async () => {
    // limit:1 must not cap the count at 1
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'count', limit: 1 });
    expect(res.count).toBe(3);
  });

  test('count works with lowercase severity (normalisation + count together)', async () => {
    const lower = await dispatch('kanecta_query', { type: 'object', mode: 'count', where: { severity: 'p1' } });
    const upper = await dispatch('kanecta_query', { type: 'object', mode: 'count', where: { severity: 'P1' } });
    expect(lower.count).toBe(upper.count);
    expect(lower.count).toBe(2);
  });

  test('count works with uppercase status (normalisation + count together)', async () => {
    const upper = await dispatch('kanecta_query', { type: 'object', mode: 'count', where: { status: 'OPEN' } });
    expect(upper.count).toBe(2);
  });
});

// ─── mode="group_by" ──────────────────────────────────────────────────────────

describe('mode="group_by"', () => {
  beforeEach(async () => {
    await seed('item-1', { severity: 'P1', status: 'open',        screen_id: 'gear' });
    await seed('item-2', { severity: 'P2', status: 'open',        screen_id: 'gear' });
    await seed('item-3', { severity: 'P1', status: 'fixed',       screen_id: 'activities' });
    await seed('item-4', { severity: 'P3', status: 'in_progress', screen_id: 'settings' });
    await seed('item-5', { severity: 'P2', status: 'fixed',       screen_id: 'activities' });
  });

  test('returns an object with groups, not an items array', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'group_by', group_by_field: 'severity' });
    expect(res).toHaveProperty('groups');
    expect(res).not.toHaveProperty('items');
  });

  test('group by severity produces correct bucket counts', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'group_by', group_by_field: 'severity' });
    expect(res.groups).toEqual({ P1: 2, P2: 2, P3: 1 });
  });

  test('group by status produces correct bucket counts', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'group_by', group_by_field: 'status' });
    expect(res.groups).toEqual({ open: 2, fixed: 2, in_progress: 1 });
  });

  test('group by screen_id produces correct bucket counts', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'group_by', group_by_field: 'screen_id' });
    expect(res.groups).toEqual({ gear: 2, activities: 2, settings: 1 });
  });

  test('bucket counts sum to total item count', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'group_by', group_by_field: 'severity' });
    const total = Object.values(res.groups).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(5);
  });

  test('group_by with where filter only buckets matching items', async () => {
    const res = await dispatch('kanecta_query', {
      type: 'object',
      mode: 'group_by',
      group_by_field: 'severity',
      where: { status: 'open' },
    });
    expect(res.groups).toEqual({ P1: 1, P2: 1 });
  });

  test('items missing the group_by_field go into an "unknown" bucket', async () => {
    await seed('item-no-severity', { status: 'open' }); // no severity field
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'group_by', group_by_field: 'severity' });
    expect(res.groups).toHaveProperty('unknown');
    expect(res.groups.unknown).toBe(1);
  });

  test('group_by ignores the limit param — groups all matches', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', mode: 'group_by', group_by_field: 'severity', limit: 1 });
    const total = Object.values(res.groups).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(5); // all 5 items, not capped at 1
  });

  test('missing group_by_field returns an error', async () => {
    const res = await dispatch('kanecta_query', { mode: 'group_by' });
    expect(res).toHaveProperty('error');
    expect(res.error).toMatch(/group_by_field/);
  });

  test('group_by with uppercase status filter (normalisation + group_by together)', async () => {
    const res = await dispatch('kanecta_query', {
      type: 'object',
      mode: 'group_by',
      group_by_field: 'severity',
      where: { status: 'OPEN' },
    });
    // OPEN normalises to open — should match same 2 items as lowercase
    const total = Object.values(res.groups).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(2);
    expect(res.groups).toEqual({ P1: 1, P2: 1 });
  });

  test('group_by with lowercase severity filter (normalisation + group_by together)', async () => {
    const res = await dispatch('kanecta_query', {
      type: 'object',
      mode: 'group_by',
      group_by_field: 'status',
      where: { severity: 'p1' },
    });
    // p1 normalises to P1 — should match items 1 and 3
    expect(res.groups).toEqual({ open: 1, fixed: 1 });
  });
});

// ─── Normal query unchanged ────────────────────────────────────────────────────

describe('normal query (no mode) — unchanged behaviour', () => {
  beforeEach(async () => {
    await seed('item-a', { severity: 'P1', status: 'open' });
    await seed('item-b', { severity: 'P2', status: 'fixed' });
  });

  test('returns items array, not count or groups', async () => {
    const res = await dispatch('kanecta_query', { type: 'object' });
    expect(res).toHaveProperty('items');
    expect(Array.isArray(res.items)).toBe(true);
    expect(res).not.toHaveProperty('count');
    expect(res).not.toHaveProperty('groups');
  });

  test('returns all seeded items when filtered by type', async () => {
    const res = await dispatch('kanecta_query', { type: 'object' });
    expect(res.items).toHaveLength(2);
  });

  test('where filter still works normally', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', where: { severity: 'P1' } });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].value).toBe('item-a');
  });

  test('returned items include objectData inline', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', where: { severity: 'P1' } });
    expect(res.items[0]).toHaveProperty('objectData');
    expect(res.items[0].objectData.severity).toBe('P1');
    expect(res.items[0].objectData.status).toBe('open');
  });

  test('limit param is respected in normal mode', async () => {
    const res = await dispatch('kanecta_query', { type: 'object', limit: 1 });
    expect(res.items).toHaveLength(1);
  });
});
