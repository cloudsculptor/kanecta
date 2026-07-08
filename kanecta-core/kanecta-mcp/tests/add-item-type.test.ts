/**
 * Regression test for the 1.4.0 data-entry bug: kanecta_add_item must thread the
 * item `type` (and, for typed objects, `typeId`) through to ds.create so the
 * created item is returned and stored with the correct type. `typeId` must also
 * be an accepted tool parameter — otherwise a schema-conforming MCP client cannot
 * attach a type to an object it creates.
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
let TOOLS;

beforeEach(async () => {
  vi.resetModules();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-add-item-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  singleConfig(tmpRoot);
  ({ dispatch, TOOLS } = await import('../src/index.ts'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  clearConfigEnv();
  vi.restoreAllMocks();
});

describe('kanecta_add_item threads type through to ds.create', () => {
  test('primitive type is set on the created item and returned', async () => {
    const res = await dispatch('kanecta_add_item', { value: 'a note', type: 'text' });
    expect(res.type).toBe('text');
    const stored = await ds.get(res.id);
    expect(stored.type).toBe('text');
  });

  test('default type is string when omitted', async () => {
    const res = await dispatch('kanecta_add_item', { value: 'no type given' });
    expect(res.type).toBe('string');
  });

  test('typed object preserves type=object and typeId', async () => {
    const created = await dispatch('kanecta_create_type', { value: 'widget', icon: 'Widgets' });
    const typeId = created.id;
    const res = await dispatch('kanecta_add_item', {
      value: 'a widget',
      type: 'object',
      typeId,
      objectData: { colour: 'red' },
    });
    expect(res.type).toBe('object');
    expect(res.typeId).toBe(typeId);
    const stored = await ds.get(res.id);
    expect(stored.type).toBe('object');
    expect(stored.typeId).toBe(typeId);
  });

  test('add_item tool schema exposes typeId so clients can create typed objects', () => {
    const tool = TOOLS.find((t: any) => t.name === 'kanecta_add_item');
    expect(tool.inputSchema.properties).toHaveProperty('typeId');
  });
});
