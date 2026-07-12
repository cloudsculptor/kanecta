// Tests for the generic type-items → GraphQL engine (schema-generation half).
// Pure, no datastore: the engine is a pure function of the type items.

import { describe, it, expect } from 'vitest';
import { buildSchemaModel, emitSDL, resolverPlan, camelToSnake } from '../../src/graphql/index.ts';
import {
  allTypes,
  chThreadType,
  personType,
  ids,
} from './fixtures.ts';

describe('buildSchemaModel', () => {
  const model = buildSchemaModel(allTypes);

  it('produces one GraphQL object type per exposed type item, no errors', () => {
    expect(model.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    expect(model.types.map((t) => t.name).sort()).toEqual(['ChFile', 'ChMessage', 'ChThread', 'CommunityPerson']);
  });

  it('derives PascalCase type names from hyphenated type values', () => {
    const person = model.types.find((t) => t.typeItemId === ids.PERSON_TYPE_ID)!;
    expect(person.name).toBe('CommunityPerson');
  });

  it('maps each object to its obj_<uuid_with_underscores> table', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    expect(thread.tableName).toBe('obj_aaaaaaaa_0000_4000_8000_000000000001');
  });

  it('always exposes id: ID! backed by the item envelope', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    const id = thread.fields.find((f) => f.name === 'id')!;
    expect(id.graphqlType).toBe('ID!');
    expect(id.backing).toEqual({ kind: 'identity', field: 'id' });
  });

  it('preserves canonical camelCase field names by default (preserve strategy)', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    const names = thread.fields.map((f) => f.name);
    expect(names).toContain('createdByUserId');
    expect(names).toContain('latestMessageAt');
    // No snake_case leaks in the default (GraphQL-idiomatic) surface.
    expect(names.some((n) => n.includes('_'))).toBe(false);
  });

  it('maps camelCase API fields to snake_case DB columns by default', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    const createdBy = thread.fields.find((f) => f.name === 'createdByUserId')!;
    expect(createdBy.backing).toEqual({ kind: 'scalarColumn', column: 'created_by_user_id', list: false });
    // Single-word fields are identical in both cases.
    expect(thread.fields.find((f) => f.name === 'name')!.backing).toEqual({ kind: 'scalarColumn', column: 'name', list: false });
  });

  it('marks required scalars non-null and optionals nullable', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    expect(thread.fields.find((f) => f.name === 'name')!.graphqlType).toBe('String!');
    expect(thread.fields.find((f) => f.name === 'description')!.graphqlType).toBe('String');
  });

  it('maps date-time columns to the DateTime scalar', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    expect(thread.fields.find((f) => f.name === 'createdAt')!.graphqlType).toBe('DateTime');
    expect(model.customScalars).toContain('DateTime');
  });

  it('maps integer columns to Int', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    expect(thread.fields.find((f) => f.name === 'sortOrder')!.namedType).toBe('Int');
  });

  it('hides columns marked x-graphql.expose:false', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    expect(thread.fields.find((f) => f.name === 'archivedAt')).toBeUndefined();
    const message = model.types.find((t) => t.name === 'ChMessage')!;
    expect(message.fields.find((f) => f.name === 'deletedAt')).toBeUndefined();
  });

  it('maps a typeId FK property to a reference field targeting the object type', () => {
    const message = model.types.find((t) => t.name === 'ChMessage')!;
    const threadId = message.fields.find((f) => f.name === 'threadId')!;
    expect(threadId.graphqlType).toBe('ChThread');
    // camelCase API field → snake_case DB column.
    expect(threadId.backing).toEqual({ kind: 'reference', targetTypeName: 'ChThread', list: false, column: 'thread_id' });
  });

  it('maps array-of-primitives to a GraphQL list', () => {
    const file = model.types.find((t) => t.name === 'ChFile')!;
    expect(file.fields.find((f) => f.name === 'tags')!.graphqlType).toBe('[String!]');
  });

  it('builds containment fields from x-graphql.fields', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    const messages = thread.fields.find((f) => f.name === 'messages')!;
    expect(messages.graphqlType).toBe('[ChMessage!]!');
    expect(messages.backing).toEqual({
      kind: 'containment',
      targetTypeName: 'ChMessage',
      parentField: 'parentId',
      list: true,
      includeDeleted: false,
    });
  });

  it('builds per-viewer computed fields backed by a function item', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    const hasUnread = thread.fields.find((f) => f.name === 'hasUnread')!;
    expect(hasUnread.graphqlType).toBe('Boolean');
    expect(hasUnread.backing).toEqual({ kind: 'computed', backedBy: ids.HAS_UNREAD_FN, scope: 'perViewer', list: false });
  });

  it('builds relationship-backed reference collections', () => {
    const message = model.types.find((t) => t.name === 'ChMessage')!;
    const files = message.fields.find((f) => f.name === 'files')!;
    expect(files.graphqlType).toBe('[ChFile!]');
    expect(files.backing).toMatchObject({ kind: 'reference', targetTypeName: 'ChFile', list: true, relationshipType: 'attaches', direction: 'outgoing' });
  });

  it('derives singular and list query field names', () => {
    const thread = model.types.find((t) => t.name === 'ChThread')!;
    expect(thread.queryName).toBe('chThread');
    expect(thread.listQueryName).toBe('chThreads');
  });
});

describe('field naming strategy (auto-translation + override)', () => {
  it('preserve (default) keeps canonical camelCase', () => {
    const model = buildSchemaModel([chThreadType]);
    const thread = model.types[0];
    expect(thread.fields.map((f) => f.name)).toContain('createdByUserId');
  });

  it('snake strategy translates camelCase → snake_case wire names', () => {
    const model = buildSchemaModel([chThreadType], { fieldNaming: 'snake' });
    const thread = model.types[0];
    const names = thread.fields.map((f) => f.name);
    expect(names).toContain('created_by_user_id');
    expect(names).toContain('latest_message_at');
    // The DB column is snake_case independently of the wire name.
    const createdBy = thread.fields.find((f) => f.name === 'created_by_user_id')!;
    expect(createdBy.backing).toEqual({ kind: 'scalarColumn', column: 'created_by_user_id', list: false });
  });

  it('a per-type x-graphql.fieldNaming overrides the build default', () => {
    const snakeThread = {
      ...chThreadType,
      payload: {
        ...chThreadType.payload,
        jsonSchema: {
          ...chThreadType.payload.jsonSchema,
          'x-graphql': { ...chThreadType.payload.jsonSchema['x-graphql'], fieldNaming: 'snake' },
        },
      },
    };
    const model = buildSchemaModel([snakeThread], { fieldNaming: 'preserve' });
    expect(model.types[0].fields.map((f) => f.name)).toContain('created_by_user_id');
  });

  it('a per-field x-graphql.name override beats the strategy (Jackson @JsonProperty)', () => {
    const withOverride = {
      ...chThreadType,
      payload: {
        ...chThreadType.payload,
        jsonSchema: {
          ...chThreadType.payload.jsonSchema,
          properties: {
            ...chThreadType.payload.jsonSchema.properties,
            createdByUserId: { 'x-id': 'x4', type: 'string', 'x-graphql': { name: 'author_id' } },
          },
        },
      },
    };
    const model = buildSchemaModel([withOverride], { fieldNaming: 'snake' });
    const names = model.types[0].fields.map((f) => f.name);
    expect(names).toContain('author_id'); // explicit override wins
    expect(names).not.toContain('created_by_user_id');
  });

  it('DB columns stay snake_case regardless of the wire strategy', () => {
    // Even when the wire surface is snake_case, the column is computed from the
    // canonical name, always snake — the two are independent and the column is
    // never configurable.
    const model = buildSchemaModel([chThreadType], { fieldNaming: 'snake' });
    const f = model.types[0].fields.find((f) => f.name === 'created_by_user_id')!;
    expect(f.backing).toEqual({ kind: 'scalarColumn', column: 'created_by_user_id', list: false });
  });

  it('camelToSnake handles the domain field names', () => {
    expect(camelToSnake('createdByUserId')).toBe('created_by_user_id');
    expect(camelToSnake('isNotificationsEnabled')).toBe('is_notifications_enabled');
    expect(camelToSnake('replyCount')).toBe('reply_count');
    expect(camelToSnake('name')).toBe('name');
  });
});

describe('buildSchemaModel options', () => {
  it('exposes unannotated types by default', () => {
    const model = buildSchemaModel([personType]);
    expect(model.types.map((t) => t.name)).toEqual(['CommunityPerson']);
  });

  it('hides unannotated types when exposeUnannotated is false', () => {
    const model = buildSchemaModel([personType], { exposeUnannotated: false });
    expect(model.types).toEqual([]);
  });

  it('restricts the build with the `only` option', () => {
    const model = buildSchemaModel(allTypes, { only: ['ch-thread'] });
    expect(model.types.map((t) => t.name)).toEqual(['ChThread']);
  });

  it('flags GraphQL type-name collisions as errors', () => {
    const model = buildSchemaModel([chThreadType, chThreadDupe()]);
    expect(model.diagnostics.some((d) => d.level === 'error' && /collides/.test(d.message))).toBe(true);
  });
});

function chThreadDupe() {
  // A second type item that forces the name "ChThread".
  return {
    item: { id: 'cccccccc-0000-4000-8000-000000000001', parentId: '11111111-1111-1111-1111-111111111111', type: 'type', typeId: null, value: 'ch-thread-dupe', sortOrder: null },
    meta: { specVersion: '1.4.0', owner: 'kanecta', visibility: 'public' },
    payload: {
      meta: { description: 'dupe' },
      jsonSchema: { $schema: 'http://json-schema.org/draft-07/schema#', title: 'X', type: 'object', 'x-graphql': { name: 'ChThread' }, properties: {}, required: [] },
      sqlSchema: ['-- test'],
    },
  };
}

describe('resolverPlan', () => {
  const plan = resolverPlan(buildSchemaModel(allTypes));

  it('indexes every field backing by TypeName.fieldName', () => {
    expect(plan.get('ChThread.id')).toEqual({ kind: 'identity', field: 'id' });
    expect(plan.get('ChThread.name')).toEqual({ kind: 'scalarColumn', column: 'name', list: false });
    expect(plan.get('ChMessage.threadId')).toMatchObject({ kind: 'reference', column: 'thread_id' });
    expect(plan.get('ChThread.messages')).toMatchObject({ kind: 'containment', targetTypeName: 'ChMessage' });
    expect(plan.get('ChThread.hasUnread')).toMatchObject({ kind: 'computed', scope: 'perViewer' });
  });
});

describe('emitSDL', () => {
  const sdl = emitSDL(buildSchemaModel(allTypes));

  it('declares the DateTime custom scalar', () => {
    expect(sdl).toMatch(/scalar DateTime/);
  });

  it('emits an object type with camelCase fields', () => {
    expect(sdl).toMatch(/type ChThread \{/);
    expect(sdl).toMatch(/createdByUserId: String/);
    expect(sdl).toMatch(/messages: \[ChMessage!\]!/);
  });

  it('emits a where input with boolean combinators and scalar filters', () => {
    expect(sdl).toMatch(/input ChThreadWhere \{/);
    expect(sdl).toMatch(/and: \[ChThreadWhere!\]/);
    expect(sdl).toMatch(/name: StringFilter/);
    expect(sdl).toMatch(/createdAt: DateTimeFilter/);
  });

  it('emits a sort enum and sort input per type', () => {
    expect(sdl).toMatch(/enum ChThreadSortField \{/);
    expect(sdl).toMatch(/input ChThreadSort \{/);
    expect(sdl).toMatch(/direction: SortDirection = ASC/);
  });

  it('emits root query fields with G1 query arguments', () => {
    expect(sdl).toMatch(/chThread\(id: ID!\): ChThread/);
    expect(sdl).toMatch(/chThreads\(where: ChThreadWhere, sort: \[ChThreadSort!\], limit: Int = 50, offset: Int = 0\): \[ChThread!\]!/);
  });

  it('only emits filter inputs that are referenced', () => {
    // No Float columns in the fixtures → FloatFilter must be absent.
    expect(sdl).not.toMatch(/input FloatFilter/);
    expect(sdl).toMatch(/input IntFilter/);
  });

  it('round-trips: the SDL names every model type', () => {
    for (const t of buildSchemaModel(allTypes).types) {
      expect(sdl).toContain(`type ${t.name} {`);
    }
  });
});
