'use strict';

/**
 * Tests for multi-datastore support:
 *  - A `datastore` argument on any tool selects a named store from the KANECTA_DATASTORES registry.
 *  - Omitting `datastore` preserves the original single-datastore behavior EXACTLY (back-compat).
 *  - The selector is stripped from args so it never leaks into a tool handler (e.g. a where-clause).
 *  - Registry parsing/validation and the injected schema property.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { Datastore } = require('@kanecta/lib');

let storeA;
let storeB;
let storeDefault;
let dsA;
let dsB;
let dsDefault;
let mod;

/** Create a typed object item with objectData in a given datastore. */
async function seed(ds, value, objectData) {
  const item = await ds.create({ value, type: 'object' });
  await ds.writeObjectJson(item.id, objectData);
  return item;
}

beforeEach(() => {
  jest.resetModules();
  delete process.env.KANECTA_DATASTORE;
  delete process.env.KANECTA_DATASTORES;
  delete process.env.KANECTA_WORKSPACE;

  storeA = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-mds-a-'));
  storeB = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-mds-b-'));
  storeDefault = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-mds-def-'));
  dsA = Datastore.init(storeA, 'a@example.com');
  dsB = Datastore.init(storeB, 'b@example.com');
  dsDefault = Datastore.init(storeDefault, 'def@example.com');

  mod = require('../src/index');
});

afterEach(() => {
  for (const p of [storeA, storeB, storeDefault]) {
    fs.rmSync(p, { recursive: true, force: true });
  }
  delete process.env.KANECTA_DATASTORE;
  delete process.env.KANECTA_DATASTORES;
  delete process.env.KANECTA_WORKSPACE;
  jest.restoreAllMocks();
});

// ─── Back-compat: omitting `datastore` is unchanged ──────────────────────────────

describe('back-compat — datastore omitted', () => {
  test('with KANECTA_DATASTORE set and no datastore arg, query targets that store', async () => {
    await seed(dsDefault, 'only-in-default', { severity: 'P1', status: 'open' });
    process.env.KANECTA_DATASTORE = storeDefault;

    const res = await mod.dispatch('kanecta_query', { type: 'object' });
    expect(res.items.map((i) => i.value)).toEqual(['only-in-default']);
  });

  test('a registry being configured does NOT change the omitted-arg path', async () => {
    // Default store and registry stores all have data; with no selector we must hit KANECTA_DATASTORE.
    await seed(dsDefault, 'from-default', { status: 'open' });
    await seed(dsA, 'from-a', { status: 'open' });
    process.env.KANECTA_DATASTORE = storeDefault;
    process.env.KANECTA_DATASTORES = JSON.stringify({ a: storeA, b: storeB });

    const res = await mod.dispatch('kanecta_query', { type: 'object' });
    expect(res.items.map((i) => i.value)).toEqual(['from-default']);
  });
});

// ─── Per-call selection via the registry ─────────────────────────────────────────

describe('per-call datastore selection', () => {
  beforeEach(async () => {
    await seed(dsA, 'item-a', { severity: 'P1', status: 'open' });
    await seed(dsB, 'item-b', { severity: 'P2', status: 'open' });
    process.env.KANECTA_DATASTORES = JSON.stringify({ a: storeA, b: storeB });
  });

  test('datastore:"a" returns store A items', async () => {
    const res = await mod.dispatch('kanecta_query', { type: 'object', datastore: 'a' });
    expect(res.items.map((i) => i.value)).toEqual(['item-a']);
  });

  test('datastore:"b" returns store B items', async () => {
    const res = await mod.dispatch('kanecta_query', { type: 'object', datastore: 'b' });
    expect(res.items.map((i) => i.value)).toEqual(['item-b']);
  });

  test('selection works without any KANECTA_DATASTORE / workspace configured', async () => {
    // No default store at all — selection must stand on its own.
    expect(process.env.KANECTA_DATASTORE).toBeUndefined();
    const res = await mod.dispatch('kanecta_query', { type: 'object', datastore: 'a' });
    expect(res.items).toHaveLength(1);
  });

  test('a "~" prefix in a registry path is expanded to the home dir', async () => {
    // Re-point "a" at a home-relative path that maps back to storeA via a symlink under $HOME.
    const linkName = `.kanecta-mds-test-${path.basename(storeA)}`;
    const linkPath = path.join(os.homedir(), linkName);
    fs.symlinkSync(storeA, linkPath);
    try {
      process.env.KANECTA_DATASTORES = JSON.stringify({ a: `~/${linkName}` });
      const res = await mod.dispatch('kanecta_query', { type: 'object', datastore: 'a' });
      expect(res.items.map((i) => i.value)).toEqual(['item-a']);
    } finally {
      fs.unlinkSync(linkPath); // remove the symlink itself, not its target
    }
  });
});

// ─── The selector is stripped before handlers ────────────────────────────────────

describe('datastore selector is stripped from tool args', () => {
  test('datastore does not become a where-clause predicate', async () => {
    // The object has no "datastore" field; if the selector leaked into `where`, the query
    // would match nothing. It must be removed before reaching the handler.
    await seed(dsA, 'item-a', { kind: 'finding' });
    process.env.KANECTA_DATASTORES = JSON.stringify({ a: storeA });

    const res = await mod.dispatch('kanecta_query', {
      type: 'object',
      where: { kind: 'finding' },
      datastore: 'a',
    });
    expect(res.items.map((i) => i.value)).toEqual(['item-a']);
  });

  test('datastore is not persisted as objectData on add_item', async () => {
    process.env.KANECTA_DATASTORES = JSON.stringify({ a: storeA });
    const created = await mod.dispatch('kanecta_add_item', {
      value: 'new-node',
      type: 'string',
      datastore: 'a',
    });
    expect(created.value).toBe('new-node');
    // Round-trip: the node exists in store A and carries no datastore field.
    const fetched = await mod.dispatch('kanecta_get', { ref: created.id, datastore: 'a' });
    expect(fetched.datastore).toBeUndefined();
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────────

describe('error handling', () => {
  // A bad selector rejects from openDs; the MCP tools/call wrapper turns that into an
  // isError tool result, so end users still get a clean message.
  test('unknown datastore name errors with the list of known names', async () => {
    process.env.KANECTA_DATASTORES = JSON.stringify({ a: storeA, b: storeB });
    await expect(
      mod.dispatch('kanecta_query', { type: 'object', datastore: 'nope' })
    ).rejects.toThrow(/Unknown datastore 'nope'[\s\S]*a, b/);
  });

  test('selector given but no registry configured errors clearly', async () => {
    await expect(
      mod.dispatch('kanecta_query', { type: 'object', datastore: 'a' })
    ).rejects.toThrow(/none configured/);
  });

  test('invalid KANECTA_DATASTORES JSON throws on read', () => {
    process.env.KANECTA_DATASTORES = '{not json';
    expect(() => mod.readDatastoreRegistry()).toThrow(/must be valid JSON/);
  });

  test('KANECTA_DATASTORES that is a JSON array is rejected', () => {
    process.env.KANECTA_DATASTORES = JSON.stringify(['/data/a']);
    expect(() => mod.readDatastoreRegistry()).toThrow(/map .* names to paths|JSON object/);
  });

  test('readDatastoreRegistry returns null when unset', () => {
    expect(mod.readDatastoreRegistry()).toBeNull();
  });
});

// ─── Schema injection ────────────────────────────────────────────────────────────

describe('schema', () => {
  test('every object-input tool exposes an optional datastore property', () => {
    const objectTools = mod.TOOLS.filter(
      (t) => t.inputSchema && t.inputSchema.type === 'object'
    );
    expect(objectTools.length).toBeGreaterThan(0);
    for (const t of objectTools) {
      expect(t.inputSchema.properties.datastore).toBeDefined();
      expect(t.inputSchema.properties.datastore.type).toBe('string');
    }
  });

  test('datastore is never marked required', () => {
    for (const t of mod.TOOLS) {
      const req = t.inputSchema?.required || [];
      expect(req).not.toContain('datastore');
    }
  });
});
