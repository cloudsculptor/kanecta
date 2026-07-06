'use strict';

import os from 'os';
import path from 'path';
import fs from 'fs';

import { SqliteFsAdapter } from '../../kanecta-storage-adapters/kanecta-sqlite-fs/src/adapter.ts';
import { ConnectorEngine } from '../src/connectorEngine.ts';

// ─── Setup ─────────────────────────────────────────────────────────────────────

let tmp;
let adapter;

function freshAdapter() {
  tmp     = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-ce-'));
  adapter = SqliteFsAdapter.init(tmp, 'test@example.com');
  return adapter;
}

// Create a connector item + write its payload.
function mkConnector(payload = {}) {
  const item = adapter.create({ type: 'connector', value: 'Test Connector' });
  const full = {
    system: 'test-system',
    baseUrl: 'https://api.example.com',
    authType: 'apiKey',
    authConfigRef: null,
    fetch: { type: 'function', id: 'f0000000-0000-0000-0000-000000000001' },
    refreshPolicy: 'on-demand',
    ...payload,
  };
  adapter.writeObjectJson(item.id, full);
  return item;
}

// Create a stub item referencing a connector.
function mkStub(connectorId, externalId = 'ext-1') {
  const item = adapter.create({ type: 'object', value: 'Stub Item' });
  adapter.update(item.id, {
    connectorId,
    materialized: false,
    sourceSystem: 'test-system',
    sourceExternalId: externalId,
  });
  return adapter.get(item.id);
}

// A no-op runOperation that returns a fixed payload.
function makeRunOp(returnPayload = { name: 'Fetched Item', status: 'ok' }) {
  const calls = [];
  const fn = async (opRef, params) => {
    calls.push({ opRef, params });
    return returnPayload;
  };
  fn.calls = calls;
  return fn;
}

beforeEach(() => freshAdapter());

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('ConnectorEngine constructor', () => {
  it('stores adapter and runOperation', () => {
    const runOp  = makeRunOp();
    const engine = new ConnectorEngine(adapter, runOp);
    expect(engine._adapter).toBe(adapter);
    expect(engine._runOperation).toBe(runOp);
  });
});

// ─── _resolveAuth ─────────────────────────────────────────────────────────────

describe('_resolveAuth', () => {
  let engine;
  beforeEach(() => { engine = new ConnectorEngine(adapter, makeRunOp()); });

  it('returns null when authConfigRef is absent', () => {
    expect(engine._resolveAuth({})).toBeNull();
  });

  it('returns null when authConfigRef is null', () => {
    expect(engine._resolveAuth({ authConfigRef: null })).toBeNull();
  });

  it('resolves $VAR_NAME from process.env', () => {
    process.env._TEST_TOKEN = 'secret-value';
    try {
      expect(engine._resolveAuth({ authConfigRef: '$_TEST_TOKEN' })).toBe('secret-value');
    } finally {
      delete process.env._TEST_TOKEN;
    }
  });

  it('returns null for missing $VAR_NAME', () => {
    delete process.env._MISSING_VAR;
    expect(engine._resolveAuth({ authConfigRef: '$_MISSING_VAR' })).toBeNull();
  });

  it('throws for $SECRET: references', () => {
    expect(() => engine._resolveAuth({ authConfigRef: '$SECRET:vault/my-token' }))
      .toThrow('Secret manager references not yet supported');
  });

  it('passes through a literal string', () => {
    expect(engine._resolveAuth({ authConfigRef: 'literal-token' })).toBe('literal-token');
  });
});

// ─── _validateOperation ───────────────────────────────────────────────────────

describe('_validateOperation', () => {
  let engine;
  beforeEach(() => { engine = new ConnectorEngine(adapter, makeRunOp()); });

  it('throws when op is falsy', () => {
    expect(() => engine._validateOperation(null, 'fetch')).toThrow('missing required operation: fetch');
  });

  it('throws when type is not function or pipeline', () => {
    expect(() => engine._validateOperation({ type: 'webhook', id: 'abc' }, 'fetch'))
      .toThrow('invalid type: "webhook"');
  });

  it('throws when type is missing', () => {
    expect(() => engine._validateOperation({ id: 'abc' }, 'fetch'))
      .toThrow('invalid type');
  });

  it('throws when id is missing', () => {
    expect(() => engine._validateOperation({ type: 'function' }, 'fetch'))
      .toThrow('missing an id');
  });

  it('accepts type function', () => {
    expect(() => engine._validateOperation({ type: 'function', id: 'uuid' }, 'fetch')).not.toThrow();
  });

  it('accepts type pipeline', () => {
    expect(() => engine._validateOperation({ type: 'pipeline', id: 'uuid' }, 'fetch')).not.toThrow();
  });
});

// ─── _loadConnector ───────────────────────────────────────────────────────────

describe('_loadConnector', () => {
  let engine;
  beforeEach(() => { engine = new ConnectorEngine(adapter, makeRunOp()); });

  it('loads the connector payload', async () => {
    const conn    = mkConnector({ system: 'jira' });
    const payload = await engine._loadConnector(conn.id);
    expect(payload.system).toBe('jira');
  });

  it('throws when connector item does not exist', async () => {
    await expect(engine._loadConnector('00000000-dead-dead-dead-000000000000'))
      .rejects.toThrow('Connector item not found');
  });

  it('throws when connector has no payload', async () => {
    const conn = adapter.create({ type: 'connector', value: 'No Payload' });
    await expect(engine._loadConnector(conn.id))
      .rejects.toThrow('Connector payload missing');
  });
});

// ─── materializeStub ─────────────────────────────────────────────────────────

describe('materializeStub', () => {
  it('fetches and writes objectData, sets materialized + cachedAt', async () => {
    const runOp = makeRunOp({ title: 'Issue 42', state: 'open' });
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector();
    const stub   = mkStub(conn.id, 'ISSUE-42');

    const result = await engine.materializeStub(stub.id);

    expect(result.materialized).toBe(true);
    expect(result.cachedAt).toBeDefined();
    expect(result.objectData).toEqual({ title: 'Issue 42', state: 'open' });

    // Check adapter state
    const updated = adapter.get(stub.id);
    expect(updated.materialized).toBe(true);
    expect(updated.cachedAt).toBeDefined();
    expect(adapter.readObjectJson(stub.id)).toEqual({ title: 'Issue 42', state: 'open' });
  });

  it('calls runOperation with correct opRef and params', async () => {
    const runOp = makeRunOp({ x: 1 });
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector({
      fetch: { type: 'function', id: 'ffffffff-0000-0000-0000-000000000001' },
      baseUrl: 'https://jira.example.com',
    });
    const stub = mkStub(conn.id, 'ENG-99');

    await engine.materializeStub(stub.id);

    expect(runOp.calls).toHaveLength(1);
    const { opRef, params } = runOp.calls[0];
    expect(opRef).toEqual({ type: 'function', id: 'ffffffff-0000-0000-0000-000000000001' });
    expect(params.connectorId).toBe(conn.id);
    expect(params.externalId).toBe('ENG-99');
    expect(params.baseUrl).toBe('https://jira.example.com');
  });

  it('resolves $ENV auth and passes it to runOperation', async () => {
    process.env._CE_TEST_KEY = 'token-xyz';
    try {
      const runOp = makeRunOp({});
      const engine = new ConnectorEngine(adapter, runOp);
      const conn   = mkConnector({ authConfigRef: '$_CE_TEST_KEY' });
      const stub   = mkStub(conn.id);

      await engine.materializeStub(stub.id);

      expect(runOp.calls[0].params.auth).toBe('token-xyz');
    } finally {
      delete process.env._CE_TEST_KEY;
    }
  });

  it('throws when item does not exist', async () => {
    const engine = new ConnectorEngine(adapter, makeRunOp());
    await expect(engine.materializeStub('00000000-dead-dead-dead-000000000001'))
      .rejects.toThrow('Item not found');
  });

  it('throws when item is already materialized', async () => {
    const engine = new ConnectorEngine(adapter, makeRunOp());
    const conn   = mkConnector();
    const item   = adapter.create({ type: 'object', value: 'Already real' });
    adapter.update(item.id, { connectorId: conn.id, materialized: true });

    await expect(engine.materializeStub(item.id))
      .rejects.toThrow('is not a stub');
  });

  it('throws when item has no connectorId', async () => {
    const engine = new ConnectorEngine(adapter, makeRunOp());
    const item   = adapter.create({ type: 'object', value: 'Orphan stub' });
    adapter.update(item.id, { materialized: false });

    await expect(engine.materializeStub(item.id))
      .rejects.toThrow('has no connectorId');
  });

  it('throws when connector has no fetch operation', async () => {
    const runOp  = makeRunOp();
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector({ fetch: undefined });
    // Overwrite payload without fetch
    adapter.writeObjectJson(conn.id, { system: 'test', refreshPolicy: 'on-demand' });
    const stub = mkStub(conn.id);

    await expect(engine.materializeStub(stub.id))
      .rejects.toThrow('missing required operation: fetch');
  });

  it('does not call runOperation when item is already materialized', async () => {
    const runOp  = makeRunOp();
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector();
    const item   = adapter.create({ type: 'object', value: 'Already real' });
    adapter.update(item.id, { connectorId: conn.id, materialized: true });

    try { await engine.materializeStub(item.id); } catch {}

    expect(runOp.calls).toHaveLength(0);
  });
});

// ─── getOrMaterialize ─────────────────────────────────────────────────────────

describe('getOrMaterialize', () => {
  it('returns null when item does not exist', async () => {
    const engine = new ConnectorEngine(adapter, makeRunOp());
    const result = await engine.getOrMaterialize('00000000-dead-dead-dead-000000000002');
    expect(result).toBeNull();
  });

  it('returns a non-stub item without calling runOperation', async () => {
    const runOp  = makeRunOp();
    const engine = new ConnectorEngine(adapter, runOp);
    const item   = adapter.create({ type: 'string', value: 'Native item' });

    const result = await engine.getOrMaterialize(item.id);
    expect(result.id).toBe(item.id);
    expect(runOp.calls).toHaveLength(0);
  });

  it('returns a materialized connector item without re-fetching', async () => {
    const runOp  = makeRunOp();
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector();
    const item   = adapter.create({ type: 'object', value: 'Already real' });
    adapter.update(item.id, { connectorId: conn.id, materialized: true, cachedAt: '2026-01-01T00:00:00Z' });

    const result = await engine.getOrMaterialize(item.id);
    expect(result.id).toBe(item.id);
    expect(runOp.calls).toHaveLength(0);
  });

  it('materializes a stub item on access', async () => {
    const runOp  = makeRunOp({ name: 'Fetched' });
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector();
    const stub   = mkStub(conn.id);

    const result = await engine.getOrMaterialize(stub.id);
    expect(result.materialized).toBe(true);
    expect(result.objectData).toEqual({ name: 'Fetched' });
    expect(runOp.calls).toHaveLength(1);
  });
});

// ─── refreshStaleItems ────────────────────────────────────────────────────────

describe('refreshStaleItems', () => {
  it('returns { refreshed: 0, failed: 0 } when nothing is stale', async () => {
    const engine = new ConnectorEngine(adapter, makeRunOp());
    const result = await engine.refreshStaleItems({ beforeAt: '2020-01-01T00:00:00Z' });
    expect(result).toEqual({ refreshed: 0, failed: 0 });
  });

  it('refreshes items stale before the given timestamp', async () => {
    const runOp  = makeRunOp({ updated: true });
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector();
    const item   = adapter.create({ type: 'object', value: 'Stale item' });
    adapter.update(item.id, {
      connectorId: conn.id,
      materialized: true,
      cachedAt: '2025-01-01T00:00:00Z',
      sourceExternalId: 'ext-stale',
    });

    const result = await engine.refreshStaleItems({ beforeAt: '2026-01-01T00:00:00Z' });

    expect(result).toEqual({ refreshed: 1, failed: 0 });
    expect(adapter.readObjectJson(item.id)).toEqual({ updated: true });
    const refreshed = adapter.get(item.id);
    expect(refreshed.cachedAt).not.toBe('2025-01-01T00:00:00Z');
  });

  it('does not refresh items cached after beforeAt', async () => {
    const runOp  = makeRunOp({ x: 1 });
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector();
    const item   = adapter.create({ type: 'object', value: 'Fresh item' });
    adapter.update(item.id, {
      connectorId: conn.id,
      materialized: true,
      cachedAt: '2026-06-01T00:00:00Z',
    });

    const result = await engine.refreshStaleItems({ beforeAt: '2026-01-01T00:00:00Z' });

    expect(result).toEqual({ refreshed: 0, failed: 0 });
    expect(runOp.calls).toHaveLength(0);
  });

  it('counts failed refreshes without throwing', async () => {
    const failOp = async () => { throw new Error('network error'); };
    failOp.calls = [];
    const engine = new ConnectorEngine(adapter, failOp);
    const conn   = mkConnector();
    const item   = adapter.create({ type: 'object', value: 'Will fail' });
    adapter.update(item.id, {
      connectorId: conn.id,
      materialized: true,
      cachedAt: '2025-01-01T00:00:00Z',
    });

    const result = await engine.refreshStaleItems({ beforeAt: '2026-01-01T00:00:00Z' });
    expect(result).toEqual({ refreshed: 0, failed: 1 });
  });

  it('refreshes multiple stale items', async () => {
    const runOp  = makeRunOp({ x: 1 });
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector();

    for (let i = 0; i < 3; i++) {
      const item = adapter.create({ type: 'object', value: `Stale ${i}` });
      adapter.update(item.id, {
        connectorId: conn.id,
        materialized: true,
        cachedAt: '2025-01-01T00:00:00Z',
        sourceExternalId: `ext-${i}`,
      });
    }

    const result = await engine.refreshStaleItems({ beforeAt: '2026-01-01T00:00:00Z' });
    expect(result.refreshed).toBe(3);
    expect(runOp.calls).toHaveLength(3);
  });

  it('defaults beforeAt to now when not provided', async () => {
    const runOp  = makeRunOp({});
    const engine = new ConnectorEngine(adapter, runOp);
    // Just check it doesn't throw (items cached in 2020 should be refreshed)
    const conn  = mkConnector();
    const item  = adapter.create({ type: 'object', value: 'Old item' });
    adapter.update(item.id, {
      connectorId: conn.id,
      materialized: true,
      cachedAt: '2020-01-01T00:00:00Z',
    });

    const result = await engine.refreshStaleItems();
    expect(result.refreshed).toBe(1);
  });
});

// ─── queueWriteBack ───────────────────────────────────────────────────────────

describe('queueWriteBack', () => {
  it('returns false when item has no connectorId', async () => {
    const engine = new ConnectorEngine(adapter, makeRunOp());
    const item   = adapter.create({ type: 'string', value: 'Native' });
    expect(await engine.queueWriteBack(item.id)).toBe(false);
  });

  it('returns false when connector has writeBack: false', async () => {
    const runOp  = makeRunOp();
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector({ writeBack: false });
    const item   = adapter.create({ type: 'object', value: 'Managed item' });
    adapter.update(item.id, { connectorId: conn.id, materialized: true });

    expect(await engine.queueWriteBack(item.id)).toBe(false);
    expect(runOp.calls).toHaveLength(0);
  });

  it('returns false when connector has no writeBack field', async () => {
    const runOp  = makeRunOp();
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector();  // no writeBack field
    const item   = adapter.create({ type: 'object', value: 'Managed item' });
    adapter.update(item.id, { connectorId: conn.id, materialized: true });

    expect(await engine.queueWriteBack(item.id)).toBe(false);
  });

  it('throws when writeBack is true but push operation is missing', async () => {
    const runOp  = makeRunOp();
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector({ writeBack: true });  // no push op
    const item   = adapter.create({ type: 'object', value: 'Managed item' });
    adapter.update(item.id, { connectorId: conn.id, materialized: true });

    await expect(engine.queueWriteBack(item.id))
      .rejects.toThrow('no push operation configured');
  });

  it('invokes push operation and returns true on success', async () => {
    const runOp  = makeRunOp({ ok: true });
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector({
      writeBack: true,
      push: { type: 'function', id: 'cccccccc-0000-0000-0000-000000000001' },
    });
    const item = adapter.create({ type: 'object', value: 'Managed item' });
    adapter.update(item.id, {
      connectorId: conn.id,
      materialized: true,
      sourceExternalId: 'ext-wb-1',
    });

    const result = await engine.queueWriteBack(item.id);
    expect(result).toBe(true);
    expect(runOp.calls).toHaveLength(1);
    expect(runOp.calls[0].opRef).toEqual({ type: 'function', id: 'cccccccc-0000-0000-0000-000000000001' });
    expect(runOp.calls[0].params.externalId).toBe('ext-wb-1');
  });

  it('updates cachedAt after successful write-back', async () => {
    const runOp  = makeRunOp({});
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector({
      writeBack: true,
      push: { type: 'function', id: 'cccccccc-0000-0000-0000-000000000002' },
    });
    const item = adapter.create({ type: 'object', value: 'Managed item' });
    adapter.update(item.id, {
      connectorId: conn.id,
      materialized: true,
      cachedAt: '2025-01-01T00:00:00Z',
    });

    await engine.queueWriteBack(item.id);

    const updated = adapter.get(item.id);
    expect(updated.cachedAt).not.toBe('2025-01-01T00:00:00Z');
    expect(Date.parse(updated.cachedAt)).toBeGreaterThan(Date.parse('2025-01-01T00:00:00Z'));
  });

  it('includes item in push params', async () => {
    const runOp  = makeRunOp({});
    const engine = new ConnectorEngine(adapter, runOp);
    const conn   = mkConnector({
      writeBack: true,
      push: { type: 'pipeline', id: 'pppppppp-0000-0000-0000-000000000001' },
    });
    const item = adapter.create({ type: 'object', value: 'Managed item' });
    adapter.update(item.id, { connectorId: conn.id, materialized: true });

    await engine.queueWriteBack(item.id);

    const { params } = runOp.calls[0];
    expect(params.item).toBeDefined();
    expect(params.item.id).toBe(item.id);
  });

  it('returns false when item does not exist', async () => {
    const engine = new ConnectorEngine(adapter, makeRunOp());
    const result = await engine.queueWriteBack('00000000-dead-dead-dead-000000000003');
    expect(result).toBe(false);
  });
});

// ─── listStubs ────────────────────────────────────────────────────────────────

describe('listStubs', () => {
  it('delegates to adapter.listStubs', async () => {
    const engine = new ConnectorEngine(adapter, makeRunOp());
    const conn   = mkConnector();

    const s1 = mkStub(conn.id, 'ext-a');
    const s2 = mkStub(conn.id, 'ext-b');
    const s3 = mkStub(conn.id, 'ext-c');
    adapter.update(s3.id, { materialized: true });  // materialized — should not appear

    const stubs = await engine.listStubs(conn.id);
    const ids = stubs.map(s => s.id).sort();
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);
    expect(ids).not.toContain(s3.id);
  });

  it('returns empty array when connector has no stubs', async () => {
    const engine = new ConnectorEngine(adapter, makeRunOp());
    const conn   = mkConnector();
    const stubs  = await engine.listStubs(conn.id);
    expect(stubs).toEqual([]);
  });

  it('does not return stubs from a different connector', async () => {
    const engine = new ConnectorEngine(adapter, makeRunOp());
    const conn1  = mkConnector();
    const conn2  = mkConnector({ system: 'other-system' });
    mkStub(conn1.id, 'ext-x');

    const stubs = await engine.listStubs(conn2.id);
    expect(stubs).toHaveLength(0);
  });
});
