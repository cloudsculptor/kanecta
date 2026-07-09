import { createHash } from 'crypto';
import { describe, expect, test } from 'vitest';
import {
  validateType, validateItem, validateMetadata, validateFunction,
  type ValidationResult,
} from './index.ts';

// ─── helpers ──────────────────────────────────────────────────────────────────

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

/** Assert the result is invalid and contains a finding with the given rule. */
function expectRule(res: ValidationResult, rule: string, path?: string) {
  expect(res.valid).toBe(false);
  const match = res.errors.find((e) => e.rule === rule && (path === undefined || e.path === path));
  expect(match, `expected a "${rule}"${path ? ` at "${path}"` : ''} error; got ${JSON.stringify(res.errors)}`).toBeTruthy();
}
function expectValid(res: ValidationResult) {
  expect(res.errors).toEqual([]);
  expect(res.valid).toBe(true);
}

/** Mirror of the validator's internal contract-hash for the immutable path. */
function contractHash(typeJson: any): string {
  const contract = {
    jsonSchema: typeJson.jsonSchema ?? null,
    sqlSchema: typeJson.sqlSchema ?? null,
    primaryField: typeJson.meta?.primaryField ?? null,
  };
  const canonical = JSON.stringify(contract, Object.keys(contract).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/** A minimal, fully-valid type.json. */
function goodType(overrides: any = {}): any {
  return {
    meta: { description: 'a thing', ...overrides.meta },
    jsonSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { name: { type: 'string', 'x-id': UUID } },
      ...overrides.jsonSchema,
    },
    sqlSchema: overrides.sqlSchema ?? ['CREATE TABLE obj_thing (item_id UUID PRIMARY KEY)'],
    ...('metaReplace' in overrides ? { meta: overrides.metaReplace } : {}),
  };
}

/** A minimal, fully-valid metadata.json. */
function goodMeta(overrides: any = {}): any {
  return {
    id: UUID, parentId: UUID2, value: 'hello', type: 'note', owner: 'a@b.com',
    license: UUID, createdAt: '2026-07-08T00:00:00Z', modifiedAt: '2026-07-08T00:00:00Z',
    ...overrides,
  };
}

// ─── validateType ─────────────────────────────────────────────────────────────

describe('validateType', () => {
  test('a minimal well-formed type is valid', () => {
    expectValid(validateType(goodType()));
  });

  test.each([null, undefined, 42, 'x', [], true])('non-object input %s → type', (input) => {
    expectRule(validateType(input as any), 'type', '');
  });

  test.each(['meta', 'jsonSchema'])('missing %s → required', (field) => {
    const t = goodType();
    delete t[field];
    expectRule(validateType(t), 'required', field);
  });

  test('missing sqlSchema is valid (it is derived from jsonSchema, not required)', () => {
    const t = goodType();
    delete t.sqlSchema;
    expectValid(validateType(t));
  });

  test('missing meta.description → required', () => {
    expectRule(validateType(goodType({ metaReplace: {} })), 'required', 'meta.description');
  });

  test.each(['sync', 'supersededBy', 'implements', 'extends'])('meta.%s not an array → type', (f) => {
    expectRule(validateType(goodType({ metaReplace: { description: 'd', [f]: 'nope' } })), 'type', `meta.${f}`);
  });

  test.each(['sync', 'supersededBy', 'implements', 'extends'])('meta.%s with a bad UUID → format:uuid', (f) => {
    expectRule(validateType(goodType({ metaReplace: { description: 'd', [f]: ['not-a-uuid'] } })), 'format:uuid');
  });

  test('meta UUID arrays with valid UUIDs pass', () => {
    expectValid(validateType(goodType({ metaReplace: { description: 'd', sync: [UUID], extends: [UUID2] } })));
  });

  test('meta.immutable non-boolean → type', () => {
    expectRule(validateType(goodType({ metaReplace: { description: 'd', immutable: 'yes' } })), 'type', 'meta.immutable');
  });

  test('meta.hash non-string → type', () => {
    expectRule(validateType(goodType({ metaReplace: { description: 'd', hash: 123 } })), 'type', 'meta.hash');
  });

  test('meta.functions not an array → type', () => {
    expectRule(validateType(goodType({ metaReplace: { description: 'd', functions: 'x' } })), 'type', 'meta.functions');
  });

  test('meta.functions with a bad UUID → format:uuid', () => {
    expectRule(validateType(goodType({ metaReplace: { description: 'd', functions: ['bad'] } })), 'format:uuid');
  });

  test('immutable=true without hash → kanecta:immutable-requires-hash', () => {
    expectRule(validateType(goodType({ metaReplace: { description: 'd', immutable: true } })),
      'kanecta:immutable-requires-hash', 'meta.hash');
  });

  test('immutable=true with wrong hash → kanecta:hash-mismatch', () => {
    expectRule(validateType(goodType({ metaReplace: { description: 'd', immutable: true, hash: 'deadbeef' } })),
      'kanecta:hash-mismatch');
  });

  test('immutable=true with the correct contract hash is valid', () => {
    const t = goodType({ metaReplace: { description: 'd', primaryField: 'name', immutable: true } });
    t.meta.hash = contractHash(t);
    expectValid(validateType(t));
  });

  test('jsonSchema.$schema wrong → const', () => {
    expectRule(validateType(goodType({ jsonSchema: { $schema: 'http://example.com', type: 'object', properties: { name: { type: 'string', 'x-id': UUID } } } })), 'const', 'jsonSchema.$schema');
  });

  test('jsonSchema.type not object → const', () => {
    expectRule(validateType(goodType({ jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'array', properties: {} } })), 'const', 'jsonSchema.type');
  });

  test('jsonSchema.properties not an object → required', () => {
    expectRule(validateType(goodType({ jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: 'x' } })), 'required', 'jsonSchema.properties');
  });

  test('property definition not an object → type', () => {
    expectRule(validateType(goodType({ jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { name: 'x' } } })), 'type');
  });

  test('property missing x-id → kanecta:x-id-required', () => {
    expectRule(validateType(goodType({ jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { name: { type: 'string' } } } })), 'kanecta:x-id-required');
  });

  test('property x-id not a UUID → format:uuid', () => {
    expectRule(validateType(goodType({ jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { name: { type: 'string', 'x-id': 'nope' } } } })), 'format:uuid');
  });

  test('property using $ref → kanecta:no-ref', () => {
    expectRule(validateType(goodType({ jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { name: { $ref: '#/x', 'x-id': UUID } } } })), 'kanecta:no-ref');
  });

  test('property type object → kanecta:flat', () => {
    expectRule(validateType(goodType({ jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { name: { type: 'object', 'x-id': UUID } } } })), 'kanecta:flat');
  });

  test('array-of-objects → kanecta:flat', () => {
    expectRule(validateType(goodType({ jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { tags: { type: 'array', items: { type: 'object' }, 'x-id': UUID } } } })), 'kanecta:flat');
  });

  test('array items with $ref → kanecta:no-ref', () => {
    expectRule(validateType(goodType({ jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { tags: { type: 'array', items: { $ref: '#/x' }, 'x-id': UUID } } } })), 'kanecta:no-ref');
  });

  test('sqlSchema not an array → required', () => {
    expectRule(validateType(goodType({ sqlSchema: 'CREATE TABLE x' })), 'required', 'sqlSchema');
  });

  test('sqlSchema empty array → required', () => {
    expectRule(validateType(goodType({ sqlSchema: [] })), 'required', 'sqlSchema');
  });

  test('sqlSchema entry not a string → type', () => {
    expectRule(validateType(goodType({ sqlSchema: [123] })), 'type', 'sqlSchema[0]');
  });

  test('a valid array-of-primitives property passes', () => {
    expectValid(validateType(goodType({ jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { tags: { type: 'array', items: { type: 'string' }, 'x-id': UUID } } } })));
  });
});

// ─── validateMetadata ─────────────────────────────────────────────────────────

describe('validateMetadata', () => {
  test('a minimal well-formed metadata is valid', () => {
    expectValid(validateMetadata(goodMeta()));
  });

  test.each([null, 42, 'x', []])('non-object input %s → type', (input) => {
    expectRule(validateMetadata(input as any), 'type', '');
  });

  test('missing parentId → required', () => {
    const m = goodMeta();
    delete m.parentId;
    expectRule(validateMetadata(m), 'required', 'parentId');
  });

  test.each(['id', 'value', 'type', 'owner', 'license', 'createdAt', 'modifiedAt'])('missing %s → required', (f) => {
    const m = goodMeta();
    delete m[f];
    expectRule(validateMetadata(m), 'required', f);
  });

  test.each(['id', 'license', 'typeId'])('%s not a UUID → format:uuid', (f) => {
    expectRule(validateMetadata(goodMeta({ [f]: 'nope', type: f === 'typeId' ? 'object' : 'note' })), 'format:uuid', f);
  });

  test('object without typeId → kanecta:object-requires-typeid', () => {
    expectRule(validateMetadata(goodMeta({ type: 'object' })), 'kanecta:object-requires-typeid', 'typeId');
  });

  test('object with a valid typeId is valid', () => {
    expectValid(validateMetadata(goodMeta({ type: 'object', typeId: UUID2 })));
  });

  test('unknown type → kanecta:valid-type', () => {
    expectRule(validateMetadata(goodMeta({ type: 'wibble' })), 'kanecta:valid-type', 'type');
  });

  test.each(['createdAt', 'modifiedAt'])('%s not ISO-8601 → format:date-time', (f) => {
    expectRule(validateMetadata(goodMeta({ [f]: '08-07-2026' })), 'format:date-time', f);
  });

  test.each(['cachedAt', 'subscribedAt', 'completedAt', 'dueAt'])('optional %s not ISO-8601 → format:date-time', (f) => {
    expectRule(validateMetadata(goodMeta({ [f]: 'yesterday' })), 'format:date-time', f);
  });

  test('bad visibility → enum', () => {
    expectRule(validateMetadata(goodMeta({ visibility: 'secret' })), 'enum', 'visibility');
  });

  test.each(['private', 'organisation', 'public'])('visibility %s is valid', (v) => {
    expectValid(validateMetadata(goodMeta({ visibility: v })));
  });

  test('tags not an array → type', () => {
    expectRule(validateMetadata(goodMeta({ tags: 'x' })), 'type', 'tags');
  });

  test('tag element not a string → type', () => {
    expectRule(validateMetadata(goodMeta({ tags: [1] })), 'type', 'tags[0]');
  });
});

// ─── validateItem ─────────────────────────────────────────────────────────────

const stringType = { jsonSchema: { properties: { name: { type: 'string' } }, required: ['name'] } };

describe('validateItem', () => {
  test('valid data passes', () => {
    expectValid(validateItem({ name: 'hi' }, stringType));
  });

  test.each([null, 42, 'x', []])('non-object data %s → type', (input) => {
    expectRule(validateItem(input as any, stringType), 'type', '');
  });

  test('typeJson without a jsonSchema object → required', () => {
    expectRule(validateItem({}, {} as any), 'required', '');
  });

  test('missing required field → required', () => {
    expectRule(validateItem({}, stringType), 'required', 'name');
  });

  test('null value for optional field is skipped', () => {
    expectValid(validateItem({ name: 'x', note: null }, { jsonSchema: { properties: { name: { type: 'string' }, note: { type: 'string' } }, required: ['name'] } }));
  });

  test('wrong string type → type', () => {
    expectRule(validateItem({ name: 42 }, stringType), 'type', 'name');
  });

  test('string format:uuid invalid → format:uuid; valid passes', () => {
    const t = { jsonSchema: { properties: { ref: { type: 'string', format: 'uuid' } } } };
    expectRule(validateItem({ ref: 'nope' }, t), 'format:uuid', 'ref');
    expectValid(validateItem({ ref: UUID }, t));
  });

  test('string format:date-time invalid → format:date-time; valid passes', () => {
    const t = { jsonSchema: { properties: { at: { type: 'string', format: 'date-time' } } } };
    expectRule(validateItem({ at: 'nope' }, t), 'format:date-time', 'at');
    expectValid(validateItem({ at: '2026-07-08T00:00:00Z' }, t));
  });

  test('string format:date invalid → format:date; valid passes', () => {
    const t = { jsonSchema: { properties: { d: { type: 'string', format: 'date' } } } };
    expectRule(validateItem({ d: '2026/07/08' }, t), 'format:date', 'd');
    expectValid(validateItem({ d: '2026-07-08' }, t));
  });

  test('number/integer/boolean type checks', () => {
    expectRule(validateItem({ n: 'x' }, { jsonSchema: { properties: { n: { type: 'number' } } } }), 'type', 'n');
    expectRule(validateItem({ n: 1.5 }, { jsonSchema: { properties: { n: { type: 'integer' } } } }), 'type', 'n');
    expectRule(validateItem({ b: 'x' }, { jsonSchema: { properties: { b: { type: 'boolean' } } } }), 'type', 'b');
    expectValid(validateItem({ n: 3, i: 4, b: true }, { jsonSchema: { properties: { n: { type: 'number' }, i: { type: 'integer' }, b: { type: 'boolean' } } } }));
  });

  test('array not an array → type', () => {
    expectRule(validateItem({ xs: 'x' }, { jsonSchema: { properties: { xs: { type: 'array' } } } }), 'type', 'xs');
  });

  test('array item type checks (string/uuid, number, integer, boolean)', () => {
    expectRule(validateItem({ xs: [1] }, { jsonSchema: { properties: { xs: { type: 'array', items: { type: 'string' } } } } }), 'type', 'xs[0]');
    expectRule(validateItem({ xs: ['bad'] }, { jsonSchema: { properties: { xs: { type: 'array', items: { type: 'string', format: 'uuid' } } } } }), 'format:uuid', 'xs[0]');
    expectRule(validateItem({ xs: ['x'] }, { jsonSchema: { properties: { xs: { type: 'array', items: { type: 'number' } } } } }), 'type', 'xs[0]');
    expectRule(validateItem({ xs: [1.5] }, { jsonSchema: { properties: { xs: { type: 'array', items: { type: 'integer' } } } } }), 'type', 'xs[0]');
    expectRule(validateItem({ xs: ['x'] }, { jsonSchema: { properties: { xs: { type: 'array', items: { type: 'boolean' } } } } }), 'type', 'xs[0]');
    expectValid(validateItem({ xs: [UUID, UUID2] }, { jsonSchema: { properties: { xs: { type: 'array', items: { type: 'string', format: 'uuid' } } } } }));
  });

  test('enum violation → enum; valid enum passes', () => {
    const t = { jsonSchema: { properties: { s: { type: 'string', enum: ['a', 'b'] } } } };
    expectRule(validateItem({ s: 'c' }, t), 'enum', 's');
    expectValid(validateItem({ s: 'a' }, t));
  });

  test('const violation → const; matching const passes', () => {
    const t = { jsonSchema: { properties: { k: { type: 'string', const: 'fixed' } } } };
    expectRule(validateItem({ k: 'other' }, t), 'const', 'k');
    expectValid(validateItem({ k: 'fixed' }, t));
  });
});

// ─── validateFunction ─────────────────────────────────────────────────────────

function goodFn(overrides: any = {}): any {
  return { parameters: [{ name: 'x', type: 'string' }], returnType: 'string', ...overrides };
}

describe('validateFunction', () => {
  test('a minimal well-formed function is valid', () => {
    expectValid(validateFunction(goodFn()));
  });

  test.each([null, 42, 'x', []])('non-object input %s → type', (input) => {
    expectRule(validateFunction(input as any), 'type', '');
  });

  test('parameters not an array → required', () => {
    expectRule(validateFunction(goodFn({ parameters: 'x' })), 'required', 'parameters');
  });

  test('parameter missing name → required', () => {
    expectRule(validateFunction(goodFn({ parameters: [{ type: 'string' }] })), 'required', 'parameters[0].name');
  });

  test('parameter with neither type nor typeId → required', () => {
    expectRule(validateFunction(goodFn({ parameters: [{ name: 'x' }] })), 'required', 'parameters[0]');
  });

  test('parameter with both type and typeId → exclusive', () => {
    expectRule(validateFunction(goodFn({ parameters: [{ name: 'x', type: 'string', typeId: UUID }] })), 'exclusive', 'parameters[0]');
  });

  test('parameter typeId not a UUID → format:uuid', () => {
    expectRule(validateFunction(goodFn({ parameters: [{ name: 'x', typeId: 'nope' }] })), 'format:uuid', 'parameters[0].typeId');
  });

  test('parameter type with inline object → kanecta:no-object-type', () => {
    expectRule(validateFunction(goodFn({ parameters: [{ name: 'x', type: '{ a: number }' }] })), 'kanecta:no-object-type', 'parameters[0].type');
  });

  test('no returnType/returnTypeId → required', () => {
    const fn = goodFn();
    delete fn.returnType;
    expectRule(validateFunction(fn), 'required', '');
  });

  test('both returnType and returnTypeId → exclusive', () => {
    expectRule(validateFunction(goodFn({ returnTypeId: UUID })), 'exclusive', '');
  });

  test('returnTypeId not a UUID → format:uuid', () => {
    const fn = goodFn({ returnTypeId: 'nope' });
    delete fn.returnType;
    expectRule(validateFunction(fn), 'format:uuid', 'returnTypeId');
  });

  test('returnType with inline object → kanecta:no-object-type', () => {
    const fn = goodFn({ returnType: '{ a: 1 }' });
    expectRule(validateFunction(fn), 'kanecta:no-object-type', 'returnType');
  });

  test('skill not a UUID → format:uuid', () => {
    expectRule(validateFunction(goodFn({ skill: 'nope' })), 'format:uuid', 'skill');
  });

  test.each(['async', 'ai', 'includeKanectaSdk'])('%s non-boolean → type', (f) => {
    expectRule(validateFunction(goodFn({ [f]: 'yes' })), 'type', f);
  });

  test('function using typeId/returnTypeId is valid', () => {
    expectValid(validateFunction({ parameters: [{ name: 'x', typeId: UUID }], returnTypeId: UUID2, async: true, ai: false }));
  });
});
