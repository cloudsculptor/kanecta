/**
 * Regression test for the 1.4.0 list-types bug: kanecta_list_types (and the
 * sibling get/update type-schema tools) must read type definitions from the
 * 1.4.0 types node via the datastore, NOT the dead `.kanecta/types` directory
 * layout — which no longer exists on a 1.4.0 datastore and returned an empty list.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { Datastore } from '@kanecta/lib';
import { vi } from 'vitest';
import { singleConfig, clearConfigEnv } from './helpers.ts';

let tmpRoot;
let ds;
let dispatch;

beforeEach(async () => {
  vi.resetModules();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-list-types-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  singleConfig(tmpRoot);
  ({ dispatch } = await import('../src/index.ts'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  clearConfigEnv();
  vi.restoreAllMocks();
});

describe('kanecta_list_types on a 1.4.0 datastore', () => {
  test('returns custom types created on the datastore', async () => {
    await dispatch('kanecta_create_type', { value: 'gadget', icon: 'Extension' });
    const res = await dispatch('kanecta_list_types', {});
    expect(res.error).toBeUndefined();
    expect(Array.isArray(res.types)).toBe(true);
    const names = res.types.map((t: any) => t.value);
    expect(names).toContain('gadget');
  });

  test('each type carries id, value and icon', async () => {
    await dispatch('kanecta_create_type', { value: 'gizmo', icon: 'Star' });
    const res = await dispatch('kanecta_list_types', {});
    const gizmo = res.types.find((t: any) => t.value === 'gizmo');
    expect(gizmo).toBeTruthy();
    expect(gizmo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(gizmo.icon).toBe('Star');
  });

  test('types are returned sorted by value', async () => {
    await dispatch('kanecta_create_type', { value: 'zebra', icon: 'Pets' });
    await dispatch('kanecta_create_type', { value: 'alpha', icon: 'Abc' });
    const res = await dispatch('kanecta_list_types', {});
    const names = res.types.map((t: any) => t.value);
    expect(names.indexOf('alpha')).toBeLessThan(names.indexOf('zebra'));
  });
});

describe('kanecta_get_type_schema / kanecta_update_type_schema read the types node', () => {
  test('get_type_schema returns the created type definition', async () => {
    const created = await dispatch('kanecta_create_type', { value: 'sprocket', icon: 'Settings' });
    const res = await dispatch('kanecta_get_type_schema', { id: created.id });
    expect(res.error).toBeUndefined();
    expect(res.meta).toBeTruthy();
    expect(res.jsonSchema).toBeTruthy();
  });

  test('get_type_schema reports not-found for an unknown UUID', async () => {
    const res = await dispatch('kanecta_get_type_schema', {
      id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
    });
    expect(res.error).toMatch(/not found/i);
  });
});
