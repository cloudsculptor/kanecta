/**
 * kanecta_update_type_schema — validated with the spec's canonical validateType.
 * Regression guard: the previous hand-rolled validator read a `type` core-file
 * spec that @kanecta/specification never exported, so EVERY call threw a
 * TypeError before validating anything — the tool was unusable.
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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanecta-update-type-test-'));
  ds = Datastore.init(tmpRoot, 'test@example.com');
  singleConfig(tmpRoot);
  ({ dispatch } = await import('../src/index.ts'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  clearConfigEnv();
  vi.restoreAllMocks();
});

test('round-trip: create a type, add an x-id\'d property, update succeeds', async () => {
  const created = await dispatch('kanecta_create_type', { value: 'widget', icon: 'Widgets' });
  const schema = await dispatch('kanecta_get_type_schema', { id: created.id });
  expect(schema.error).toBeUndefined();

  schema.jsonSchema.properties.name = {
    'x-id': 'f6a3d3f8-4a63-4f6e-9f3f-0f6f6b8b1a01',
    type: 'string',
    description: 'Display name',
  };
  const updated = await dispatch('kanecta_update_type_schema', { id: created.id, schema });
  expect(updated.error).toBeUndefined();

  const back = await dispatch('kanecta_get_type_schema', { id: created.id });
  expect(back.jsonSchema.properties.name['x-id']).toBe('f6a3d3f8-4a63-4f6e-9f3f-0f6f6b8b1a01');
});

test('rejects invalid schemas with the spec rules instead of throwing', async () => {
  const created = await dispatch('kanecta_create_type', { value: 'gadget', icon: 'Extension' });
  const schema = await dispatch('kanecta_get_type_schema', { id: created.id });

  const noJsonSchema = await dispatch('kanecta_update_type_schema', {
    id: created.id, schema: { meta: schema.meta },
  });
  expect(noJsonSchema.error).toMatch(/jsonSchema/);

  const wrongDraft = await dispatch('kanecta_update_type_schema', {
    id: created.id,
    schema: { ...schema, jsonSchema: { ...schema.jsonSchema, $schema: 'http://json-schema.org/draft-04/schema#' } },
  });
  expect(wrongDraft.error).toMatch(/draft-07/);

  // The spec's business rules now apply too: every property needs an x-id.
  const noXid = await dispatch('kanecta_update_type_schema', {
    id: created.id,
    schema: {
      ...schema,
      jsonSchema: { ...schema.jsonSchema, properties: { name: { type: 'string' } } },
    },
  });
  expect(noXid.error).toMatch(/x-id/);

  // Nothing invalid was persisted.
  const back = await dispatch('kanecta_get_type_schema', { id: created.id });
  expect(back.jsonSchema.properties).toEqual({});
});
