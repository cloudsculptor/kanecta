/**
 * Tests for per-call working-set selection:
 *  - A `workingSet` argument on any tool selects a named working set from config.json.
 *  - Omitting `workingSet` uses the active working set (defaultWorkingSet here).
 *  - A `branch` argument selects the branch for that call.
 *  - The selectors are stripped from args so they never leak into a tool handler.
 *  - The injected schema properties are present and never required.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { Datastore } from '@kanecta/lib';
import { vi } from 'vitest';
import { useConfig, clearConfigEnv } from './helpers.ts';

let storeA;
let storeB;
let storeDefault;
let mod;

/** Create a typed object item with objectData in a given datastore. */
async function seed(ds, value, objectData) {
  const item = await ds.create({ value, type: 'object' });
  await ds.writeObjectJson(item.id, objectData);
  return item;
}

beforeEach(async () => {
  vi.resetModules();
  clearConfigEnv();

  storeA = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-mds-a-'));
  storeB = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-mds-b-'));
  storeDefault = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-mds-def-'));
  Datastore.init(storeA, 'a@example.com');
  Datastore.init(storeB, 'b@example.com');
  Datastore.init(storeDefault, 'def@example.com');

  mod = await import('../src/index.ts');
});

afterEach(() => {
  for (const p of [storeA, storeB, storeDefault]) {
    fs.rmSync(p, { recursive: true, force: true });
  }
  clearConfigEnv();
  vi.restoreAllMocks();
});

function threeWorkingSets() {
  useConfig(
    {
      default: { local: storeDefault, defaultBranch: 'main' },
      a: { local: storeA, defaultBranch: 'main' },
      b: { local: storeB, defaultBranch: 'main' },
    },
    'default',
  );
}

// ─── Active working set (workingSet omitted) ─────────────────────────────────────

describe('active working set — workingSet omitted', () => {
  test('no arg targets the default working set', async () => {
    const dsDefault = Datastore.open(storeDefault);
    await seed(dsDefault, 'only-in-default', { severity: 'P1', status: 'open' });
    await seed(Datastore.open(storeA), 'from-a', { status: 'open' });
    threeWorkingSets();

    const res = await mod.dispatch('kanecta_query', { type: 'object' });
    expect(res.items.map((i) => i.value)).toEqual(['only-in-default']);
  });
});

// ─── Per-call selection via config working sets ──────────────────────────────────

describe('per-call working-set selection', () => {
  beforeEach(async () => {
    await seed(Datastore.open(storeA), 'item-a', { severity: 'P1', status: 'open' });
    await seed(Datastore.open(storeB), 'item-b', { severity: 'P2', status: 'open' });
    threeWorkingSets();
  });

  test('workingSet:"a" returns working set A items', async () => {
    const res = await mod.dispatch('kanecta_query', { type: 'object', workingSet: 'a' });
    expect(res.items.map((i) => i.value)).toEqual(['item-a']);
  });

  test('workingSet:"b" returns working set B items', async () => {
    const res = await mod.dispatch('kanecta_query', { type: 'object', workingSet: 'b' });
    expect(res.items.map((i) => i.value)).toEqual(['item-b']);
  });
});

// ─── The selectors are stripped before handlers ──────────────────────────────────

describe('selectors are stripped from tool args', () => {
  test('workingSet does not become a where-clause predicate', async () => {
    await seed(Datastore.open(storeA), 'item-a', { kind: 'finding' });
    threeWorkingSets();

    const res = await mod.dispatch('kanecta_query', {
      type: 'object',
      where: { kind: 'finding' },
      workingSet: 'a',
    });
    expect(res.items.map((i) => i.value)).toEqual(['item-a']);
  });

  test('workingSet/branch are not persisted as objectData on add_item', async () => {
    threeWorkingSets();
    const created = await mod.dispatch('kanecta_add_item', {
      value: 'new-node',
      type: 'string',
      workingSet: 'a',
      branch: 'main',
    });
    expect(created.value).toBe('new-node');
    const fetched = await mod.dispatch('kanecta_get', { ref: created.id, workingSet: 'a' });
    expect(fetched.workingSet).toBeUndefined();
    expect(fetched.branch).toBeUndefined();
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────────

describe('error handling', () => {
  test('unknown working set errors with the list of known names', async () => {
    threeWorkingSets();
    await expect(
      mod.dispatch('kanecta_query', { type: 'object', workingSet: 'nope' }),
    ).rejects.toThrow(/Working set 'nope'[\s\S]*default, a, b/);
  });
});

// ─── Schema injection ────────────────────────────────────────────────────────────

describe('schema', () => {
  test('every object-input tool exposes optional workingSet + branch properties', () => {
    const objectTools = mod.TOOLS.filter((t) => t.inputSchema && t.inputSchema.type === 'object');
    expect(objectTools.length).toBeGreaterThan(0);
    for (const t of objectTools) {
      expect(t.inputSchema.properties.workingSet?.type).toBe('string');
      expect(t.inputSchema.properties.branch?.type).toBe('string');
    }
  });

  test('workingSet/branch are never marked required', () => {
    for (const t of mod.TOOLS) {
      const req = t.inputSchema?.required || [];
      expect(req).not.toContain('workingSet');
      expect(req).not.toContain('branch');
    }
  });
});
