// Type-item fixtures for the GraphQL engine tests. Modelled on the real
// community-hub discussions domain (plans/community-hub-discussions-contract.md),
// but authored in CANONICAL camelCase per the owner directive: type items use
// standard JSON camelCase; snake_case (the legacy REST contract) is produced by
// the naming strategy, not baked into the types. These exercise every backing
// kind the engine plans.

const THREAD_TYPE_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const MESSAGE_TYPE_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const FILE_TYPE_ID = 'aaaaaaaa-0000-4000-8000-000000000003';
const PERSON_TYPE_ID = 'aaaaaaaa-0000-4000-8000-000000000004';

const HAS_UNREAD_FN = 'bbbbbbbb-0000-4000-8000-000000000001';
const NOTIF_FN = 'bbbbbbbb-0000-4000-8000-000000000002';
const REPLY_COUNT_FN = 'bbbbbbbb-0000-4000-8000-000000000003';

export const ids = {
  THREAD_TYPE_ID,
  MESSAGE_TYPE_ID,
  FILE_TYPE_ID,
  PERSON_TYPE_ID,
  HAS_UNREAD_FN,
  NOTIF_FN,
  REPLY_COUNT_FN,
};

function prop(xId: string, schema: Record<string, unknown>) {
  return { 'x-id': xId, ...schema };
}

export const chThreadType = {
  item: { id: THREAD_TYPE_ID, parentId: '11111111-1111-1111-1111-111111111111', type: 'type', typeId: null, value: 'ch-thread', sortOrder: null },
  meta: { specVersion: '1.4.0', owner: 'kanecta', visibility: 'public' },
  payload: {
    meta: { description: 'A discussion thread.' },
    jsonSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'ChThread',
      type: 'object',
      'x-graphql': {
        name: 'ChThread',
        fields: {
          messages: { kind: 'containment', type: 'ChMessage', list: true },
          hasUnread: { kind: 'computed', type: 'Boolean', backedBy: HAS_UNREAD_FN, scope: 'perViewer' },
          isNotificationsEnabled: { kind: 'computed', type: 'Boolean', backedBy: NOTIF_FN, scope: 'perViewer' },
        },
      },
      properties: {
        name: prop('x1', { type: 'string', description: 'Thread name.' }),
        description: prop('x2', { type: 'string' }),
        createdByName: prop('x3', { type: 'string' }),
        createdByUserId: prop('x4', { type: 'string' }),
        createdAt: prop('x5', { type: 'string', format: 'date-time' }),
        latestMessageAt: prop('x6', { type: 'string', format: 'date-time' }),
        sortOrder: prop('x7', { type: 'integer' }),
        // Soft-delete marker: stored but not part of the GraphQL surface.
        archivedAt: prop('x8', { type: 'string', format: 'date-time', 'x-graphql': { expose: false } }),
      },
      required: ['name'],
    },
    sqlSchema: ['-- test'],
  },
};

export const chMessageType = {
  item: { id: MESSAGE_TYPE_ID, parentId: '11111111-1111-1111-1111-111111111111', type: 'type', typeId: null, value: 'ch-message', sortOrder: null },
  meta: { specVersion: '1.4.0', owner: 'kanecta', visibility: 'public' },
  payload: {
    meta: { description: 'A message or reply in a thread.' },
    jsonSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'ChMessage',
      type: 'object',
      'x-graphql': {
        name: 'ChMessage',
        fields: {
          replies: { kind: 'containment', type: 'ChMessage', list: true },
          replyCount: { kind: 'computed', type: 'Int', backedBy: REPLY_COUNT_FN },
          files: { kind: 'reference', type: 'ChFile', list: true, relationshipType: 'attaches' },
        },
      },
      properties: {
        // FK reference to the containing thread's type.
        threadId: prop('m1', { type: 'string', format: 'uuid', typeId: THREAD_TYPE_ID }),
        userId: prop('m2', { type: 'string' }),
        userName: prop('m3', { type: 'string' }),
        content: prop('m4', { type: 'string', description: 'Message body.' }),
        createdAt: prop('m5', { type: 'string', format: 'date-time' }),
        editedAt: prop('m6', { type: 'string', format: 'date-time' }),
        deletedAt: prop('m7', { type: 'string', format: 'date-time', 'x-graphql': { expose: false } }),
      },
      required: ['content'],
    },
    sqlSchema: ['-- test'],
  },
};

export const chFileType = {
  item: { id: FILE_TYPE_ID, parentId: '11111111-1111-1111-1111-111111111111', type: 'type', typeId: null, value: 'ch-file', sortOrder: null },
  meta: { specVersion: '1.4.0', owner: 'kanecta', visibility: 'public' },
  payload: {
    meta: { description: 'A file attached to a message.' },
    jsonSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'ChFile',
      type: 'object',
      'x-graphql': { name: 'ChFile' },
      properties: {
        name: prop('f1', { type: 'string' }),
        mimeType: prop('f2', { type: 'string' }),
        sizeBytes: prop('f3', { type: 'integer' }),
        tags: prop('f4', { type: 'array', items: { type: 'string' } }),
      },
      required: ['name', 'mimeType'],
    },
    sqlSchema: ['-- test'],
  },
};

// A type with NO x-graphql block — exercises default (unannotated) exposure,
// PascalCase name derivation from a hyphenated value, and camelCase fields.
export const personType = {
  item: { id: PERSON_TYPE_ID, parentId: '11111111-1111-1111-1111-111111111111', type: 'type', typeId: null, value: 'community-person', sortOrder: null },
  meta: { specVersion: '1.4.0', owner: 'kanecta', visibility: 'public' },
  payload: {
    meta: { description: 'A community member.' },
    jsonSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'CommunityPerson',
      type: 'object',
      properties: {
        fullName: prop('p1', { type: 'string' }),
        born: prop('p2', { type: 'string', format: 'date' }),
        active: prop('p3', { type: 'boolean' }),
      },
      required: ['fullName'],
    },
    sqlSchema: ['-- test'],
  },
};

export const allTypes = [chThreadType, chMessageType, chFileType, personType];
