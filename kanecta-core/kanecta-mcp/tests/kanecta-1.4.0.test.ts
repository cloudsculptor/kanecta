'use strict';

/**
 * Tests for kanecta-mcp 1.4.0 features:
 *  - kanecta_soft_delete / kanecta_restore
 *  - kanecta_get_time / kanecta_set_time / kanecta_delete_time
 *  - kanecta_query: includeDeleted, excludeExpired, expiredOnly
 *  - kanecta_update_item: expiresAt, connectorId, materialized, cachedAt
 *  - kanecta_capture: 'decision' type removed
 *  - TOOLS schema: new fields present, stale 'decision' enum absent
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { Datastore } = require('@kanecta/lib');

let tmpRoot;
let ds;
let dispatch;
let TOOLS;

beforeEach(() => {
  jest.resetModules();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-1.4.0-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  require('./helpers').singleConfig(tmpRoot);
  ({ dispatch, TOOLS } = require('../src/index'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  require('./helpers').clearConfigEnv();
  jest.restoreAllMocks();
});

// ─── Tool schema integrity ─────────────────────────────────────────────────────

describe('TOOLS schema: 1.4.0 fields', () => {
  test('kanecta_capture type enum no longer contains "decision"', () => {
    const tool = TOOLS.find(t => t.name === 'kanecta_capture');
    const typeEnum = tool.inputSchema.properties.type.enum;
    expect(typeEnum).not.toContain('decision');
    expect(typeEnum).toContain('text');
    expect(typeEnum).toContain('string');
  });

  test('kanecta_update_item schema includes expiresAt', () => {
    const tool = TOOLS.find(t => t.name === 'kanecta_update_item');
    expect(tool.inputSchema.properties).toHaveProperty('expiresAt');
  });

  test('kanecta_update_item schema includes connectorId', () => {
    const tool = TOOLS.find(t => t.name === 'kanecta_update_item');
    expect(tool.inputSchema.properties).toHaveProperty('connectorId');
  });

  test('kanecta_update_item schema includes materialized', () => {
    const tool = TOOLS.find(t => t.name === 'kanecta_update_item');
    expect(tool.inputSchema.properties).toHaveProperty('materialized');
  });

  test('kanecta_update_item schema includes cachedAt', () => {
    const tool = TOOLS.find(t => t.name === 'kanecta_update_item');
    expect(tool.inputSchema.properties).toHaveProperty('cachedAt');
  });

  test('kanecta_query schema includes includeDeleted', () => {
    const tool = TOOLS.find(t => t.name === 'kanecta_query');
    expect(tool.inputSchema.properties).toHaveProperty('includeDeleted');
  });

  test('kanecta_query schema includes excludeExpired', () => {
    const tool = TOOLS.find(t => t.name === 'kanecta_query');
    expect(tool.inputSchema.properties).toHaveProperty('excludeExpired');
  });

  test('kanecta_query schema includes expiredOnly', () => {
    const tool = TOOLS.find(t => t.name === 'kanecta_query');
    expect(tool.inputSchema.properties).toHaveProperty('expiredOnly');
  });

  test('kanecta_soft_delete tool is registered', () => {
    expect(TOOLS.find(t => t.name === 'kanecta_soft_delete')).toBeDefined();
  });

  test('kanecta_restore tool is registered', () => {
    expect(TOOLS.find(t => t.name === 'kanecta_restore')).toBeDefined();
  });

  test('kanecta_get_time tool is registered', () => {
    expect(TOOLS.find(t => t.name === 'kanecta_get_time')).toBeDefined();
  });

  test('kanecta_set_time tool is registered', () => {
    expect(TOOLS.find(t => t.name === 'kanecta_set_time')).toBeDefined();
  });

  test('kanecta_delete_time tool is registered', () => {
    expect(TOOLS.find(t => t.name === 'kanecta_delete_time')).toBeDefined();
  });
});

// ─── kanecta_soft_delete ──────────────────────────────────────────────────────

describe('kanecta_soft_delete', () => {
  test('sets deletedAt on the item', async () => {
    const item = await ds.create({ value: 'to-delete', type: 'string' });
    const result = await dispatch('kanecta_soft_delete', { id: item.id });
    expect(result.deletedAt).toBeTruthy();
    expect(new Date(result.deletedAt).toISOString()).toBe(result.deletedAt);
  });

  test('item is retrievable after soft-delete (data not destroyed)', async () => {
    const item = await ds.create({ value: 'still-here', type: 'string' });
    await dispatch('kanecta_soft_delete', { id: item.id });
    const fetched = await ds.get(item.id);
    expect(fetched).not.toBeNull();
    expect(fetched.value).toBe('still-here');
  });

  test('soft-deleted item disappears from kanecta_query by default', async () => {
    await ds.create({ value: 'live', type: 'string' });
    const deleted = await ds.create({ value: 'gone', type: 'string' });
    await dispatch('kanecta_soft_delete', { id: deleted.id });

    const result = await dispatch('kanecta_query', { type: 'string' });
    const values = result.items.map(i => i.value);
    expect(values).toContain('live');
    expect(values).not.toContain('gone');
  });

  test('soft-deleted item appears when includeDeleted:true', async () => {
    const item = await ds.create({ value: 'gone', type: 'string' });
    await dispatch('kanecta_soft_delete', { id: item.id });

    const result = await dispatch('kanecta_query', { type: 'string', includeDeleted: true });
    const values = result.items.map(i => i.value);
    expect(values).toContain('gone');
  });

  test('returns error for unknown id', async () => {
    const result = await dispatch('kanecta_soft_delete', { id: 'ffffffff-ffff-4fff-bfff-ffffffffffff' });
    expect(result.error).toMatch(/Not found/);
  });

  test('updates modifiedAt on soft-delete', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    const before = item.modifiedAt;
    await new Promise(r => setTimeout(r, 10));
    const result = await dispatch('kanecta_soft_delete', { id: item.id });
    expect(result.modifiedAt >= before).toBe(true);
  });
});

// ─── kanecta_restore ──────────────────────────────────────────────────────────

describe('kanecta_restore', () => {
  test('clears deletedAt after soft-delete', async () => {
    const item = await ds.create({ value: 'recoverable', type: 'string' });
    await dispatch('kanecta_soft_delete', { id: item.id });
    const result = await dispatch('kanecta_restore', { id: item.id });
    expect(result.deletedAt).toBeNull();
  });

  test('restored item re-appears in default queries', async () => {
    const item = await ds.create({ value: 'revived', type: 'string' });
    await dispatch('kanecta_soft_delete', { id: item.id });
    await dispatch('kanecta_restore', { id: item.id });

    const result = await dispatch('kanecta_query', { type: 'string' });
    expect(result.items.map(i => i.value)).toContain('revived');
  });

  test('restoring a non-deleted item is a no-op (does not error)', async () => {
    const item = await ds.create({ value: 'fine', type: 'string' });
    const result = await dispatch('kanecta_restore', { id: item.id });
    expect(result.error).toBeUndefined();
    expect(result.deletedAt).toBeNull();
  });

  test('returns error for unknown id', async () => {
    const result = await dispatch('kanecta_restore', { id: 'ffffffff-ffff-4fff-bfff-ffffffffffff' });
    expect(result.error).toMatch(/Not found/);
  });

  test('soft-delete → restore → soft-delete cycle preserves data', async () => {
    const item = await ds.create({ value: 'cycle', type: 'string' });
    await dispatch('kanecta_soft_delete', { id: item.id });
    await dispatch('kanecta_restore', { id: item.id });
    const final = await dispatch('kanecta_soft_delete', { id: item.id });
    expect(final.value).toBe('cycle');
    expect(final.deletedAt).toBeTruthy();
  });
});

// ─── kanecta_query: includeDeleted / expiredOnly / excludeExpired ─────────────

describe('kanecta_query: soft-delete filters', () => {
  test('includeDeleted:false (default) excludes soft-deleted items', async () => {
    await ds.create({ value: 'live' });
    const dead = await ds.create({ value: 'dead' });
    await ds.softDelete(dead.id);

    const res = await dispatch('kanecta_query', {});
    expect(res.items.map(i => i.value)).not.toContain('dead');
    expect(res.items.map(i => i.value)).toContain('live');
  });

  test('includeDeleted:true returns both live and soft-deleted items', async () => {
    await ds.create({ value: 'live' });
    const dead = await ds.create({ value: 'dead' });
    await ds.softDelete(dead.id);

    const res = await dispatch('kanecta_query', { includeDeleted: true });
    const values = res.items.map(i => i.value);
    expect(values).toContain('live');
    expect(values).toContain('dead');
  });
});

describe('kanecta_query: expiresAt filters', () => {
  test('expiredOnly returns only items with expiresAt in the past', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const stale = await ds.create({ value: 'stale', type: 'string' });
    const fresh = await ds.create({ value: 'fresh', type: 'string' });
    const noExpiry = await ds.create({ value: 'permanent', type: 'string' });
    await ds.update(stale.id, { expiresAt: past });
    await ds.update(fresh.id, { expiresAt: future });

    const res = await dispatch('kanecta_query', { expiredOnly: true });
    const values = res.items.map(i => i.value);
    expect(values).toContain('stale');
    expect(values).not.toContain('fresh');
    expect(values).not.toContain('permanent');
  });

  test('excludeExpired omits items with expiresAt in the past', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const stale = await ds.create({ value: 'stale', type: 'string' });
    const fresh = await ds.create({ value: 'fresh', type: 'string' });
    const noExpiry = await ds.create({ value: 'permanent', type: 'string' });
    await ds.update(stale.id, { expiresAt: past });
    await ds.update(fresh.id, { expiresAt: future });

    const res = await dispatch('kanecta_query', { excludeExpired: true });
    const values = res.items.map(i => i.value);
    expect(values).not.toContain('stale');
    expect(values).toContain('fresh');
    expect(values).toContain('permanent');
  });

  test('without any expiry filter, expired items appear in default query', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const item = await ds.create({ value: 'expired', type: 'string' });
    await ds.update(item.id, { expiresAt: past });

    const res = await dispatch('kanecta_query', { type: 'string' });
    expect(res.items.map(i => i.value)).toContain('expired');
  });

  test('expiredOnly:true returns zero items when none are expired', async () => {
    await ds.create({ value: 'a', type: 'string' });
    const res = await dispatch('kanecta_query', { expiredOnly: true });
    expect(res.items).toHaveLength(0);
  });
});

// ─── kanecta_update_item: new 1.4.0 meta fields ───────────────────────────────

describe('kanecta_update_item: 1.4.0 meta fields', () => {
  test('sets expiresAt via update', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    const ts = new Date(Date.now() + 86400_000).toISOString();
    const res = await dispatch('kanecta_update_item', { id: item.id, expiresAt: ts });
    expect(res.expiresAt).toBe(ts);
  });

  test('clears expiresAt by setting null', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    const ts = new Date(Date.now() + 86400_000).toISOString();
    await dispatch('kanecta_update_item', { id: item.id, expiresAt: ts });
    const res = await dispatch('kanecta_update_item', { id: item.id, expiresAt: null });
    expect(res.expiresAt).toBeNull();
  });

  test('sets connectorId via update', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    const connId = '7c4e9a21-83bf-4d6a-b501-2e8f0c3d9a47';
    const res = await dispatch('kanecta_update_item', { id: item.id, connectorId: connId });
    expect(res.connectorId).toBe(connId);
  });

  test('sets materialized:false (stub) via update', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    const res = await dispatch('kanecta_update_item', { id: item.id, materialized: false });
    expect(res.materialized).toBe(false);
  });

  test('sets cachedAt via update', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    const now = new Date().toISOString();
    const res = await dispatch('kanecta_update_item', { id: item.id, cachedAt: now });
    expect(res.cachedAt).toBe(now);
  });

  test('multiple 1.4.0 meta fields can be set in one update call', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    const ts = new Date(Date.now() + 3600_000).toISOString();
    const connId = '7c4e9a21-83bf-4d6a-b501-2e8f0c3d9a47';
    const now = new Date().toISOString();
    const res = await dispatch('kanecta_update_item', {
      id: item.id,
      expiresAt: ts,
      connectorId: connId,
      materialized: false,
      cachedAt: now,
    });
    expect(res.expiresAt).toBe(ts);
    expect(res.connectorId).toBe(connId);
    expect(res.materialized).toBe(false);
    expect(res.cachedAt).toBe(now);
  });
});

// ─── kanecta_get_time ─────────────────────────────────────────────────────────

describe('kanecta_get_time', () => {
  test('returns null time for item with no time.json', async () => {
    const item = await ds.create({ value: 'notemporal', type: 'string' });
    const res = await dispatch('kanecta_get_time', { id: item.id });
    expect(res.time).toBeNull();
    expect(res.id).toBe(item.id);
  });

  test('returns time data after kanecta_set_time', async () => {
    const item = await ds.create({ value: 'temporal', type: 'string' });
    const timeData = {
      main: { startAt: '2026-07-01T09:00:00Z', endAt: null, recurrenceRule: null, recurrenceExceptions: [], completedAt: null },
    };
    await dispatch('kanecta_set_time', { id: item.id, time: timeData });

    const res = await dispatch('kanecta_get_time', { id: item.id });
    expect(res.time).toMatchObject(timeData);
  });

  test('returns error for unknown item', async () => {
    const res = await dispatch('kanecta_get_time', { id: 'ffffffff-ffff-4fff-bfff-ffffffffffff' });
    expect(res.error).toMatch(/Not found/);
  });
});

// ─── kanecta_set_time ─────────────────────────────────────────────────────────

describe('kanecta_set_time', () => {
  test('writes a single temporal context (main)', async () => {
    const item = await ds.create({ value: 'ev', type: 'string' });
    const timeData = {
      main: { startAt: '2026-08-01T10:00:00Z', endAt: '2026-08-01T11:00:00Z', recurrenceRule: null, recurrenceExceptions: [], completedAt: null },
    };
    const res = await dispatch('kanecta_set_time', { id: item.id, time: timeData });
    expect(res.time).toMatchObject(timeData);
    expect(res.id).toBe(item.id);
  });

  test('writes multiple temporal contexts (main, review, renewal)', async () => {
    const item = await ds.create({ value: 'multi', type: 'string' });
    const timeData = {
      main:    { startAt: '2026-07-01T00:00:00Z', endAt: null, recurrenceRule: null, recurrenceExceptions: [], completedAt: null },
      review:  { startAt: null, endAt: null, recurrenceRule: 'FREQ=QUARTERLY', recurrenceExceptions: [], completedAt: null },
      renewal: { startAt: null, endAt: '2027-06-01T00:00:00Z', recurrenceRule: null, recurrenceExceptions: [], completedAt: null },
    };
    const res = await dispatch('kanecta_set_time', { id: item.id, time: timeData });
    expect(Object.keys(res.time)).toEqual(['main', 'review', 'renewal']);
  });

  test('overwrites previous time data on second write', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    const first = { main: { startAt: '2026-01-01T00:00:00Z', endAt: null, recurrenceRule: null, recurrenceExceptions: [], completedAt: null } };
    const second = { review: { startAt: null, endAt: null, recurrenceRule: 'FREQ=MONTHLY', recurrenceExceptions: [], completedAt: null } };
    await dispatch('kanecta_set_time', { id: item.id, time: first });
    await dispatch('kanecta_set_time', { id: item.id, time: second });

    const fetched = await dispatch('kanecta_get_time', { id: item.id });
    expect(fetched.time).not.toHaveProperty('main');
    expect(fetched.time).toHaveProperty('review');
  });

  test('returns error for unknown item', async () => {
    const res = await dispatch('kanecta_set_time', {
      id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
      time: { main: { startAt: '2026-07-01T00:00:00Z', endAt: null, recurrenceRule: null, recurrenceExceptions: [], completedAt: null } },
    });
    expect(res.error).toMatch(/Not found/);
  });

  test('returns error when time is not an object', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    const res = await dispatch('kanecta_set_time', { id: item.id, time: 'not-an-object' });
    expect(res.error).toBeDefined();
  });
});

// ─── kanecta_delete_time ──────────────────────────────────────────────────────

describe('kanecta_delete_time', () => {
  test('removes time.json so subsequent get returns null', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    await dispatch('kanecta_set_time', {
      id: item.id,
      time: { main: { startAt: '2026-07-01T00:00:00Z', endAt: null, recurrenceRule: null, recurrenceExceptions: [], completedAt: null } },
    });
    await dispatch('kanecta_delete_time', { id: item.id });

    const res = await dispatch('kanecta_get_time', { id: item.id });
    expect(res.time).toBeNull();
  });

  test('deleting non-existent time.json is not an error', async () => {
    const item = await ds.create({ value: 'x', type: 'string' });
    const res = await dispatch('kanecta_delete_time', { id: item.id });
    expect(res.error).toBeUndefined();
    expect(res.deleted).toBe(true);
  });

  test('returns error for unknown item', async () => {
    const res = await dispatch('kanecta_delete_time', { id: 'ffffffff-ffff-4fff-bfff-ffffffffffff' });
    expect(res.error).toMatch(/Not found/);
  });
});
