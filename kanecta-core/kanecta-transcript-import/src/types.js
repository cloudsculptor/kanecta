'use strict';

/**
 * The typed-object schema for imported transcripts.
 *
 * Per the Kanecta type-system rules, every stored payload is a typed object: a
 * type carries a jsonSchema + a matching (flat, one-level) sqlSchema, and the two
 * storage backends store the SAME declared shape — Postgres in an `obj_<typeId>`
 * table (columns), the filesystem adapter as inline JSON validated by the schema.
 *
 * A transcript maps to four types:
 *   - claude-session / claude-turn / claude-tool-call — flat scalar + text columns
 *   - property — the reusable EAV key-value type for variable maps (tool inputs,
 *     the session's model list); a map is a set of child `property` items.
 *
 * Type ids are FIXED so the `obj_<typeId>` table names are stable and seeding is
 * idempotent. sqlSchema is hand-authored here (the general jsonSchema→sqlSchema
 * compiler is later work); only Postgres executes the DDL, the filesystem adapter
 * just stores the definition.
 */

const TYPE_IDS = {
  // `property` is a CORE built-in (canonical id from the spec's built-in-types).
  // The importer seeds it here only until the bootstrapper seeds built-in type
  // items; the fixed id + schema keep that future seeding idempotent.
  property: '105354a8-4bd9-4333-9b54-68192f44599c',
  session: '0a9f1e00-0000-4000-8000-000000000002',
  turn: '0a9f1e00-0000-4000-8000-000000000003',
  toolCall: '0a9f1e00-0000-4000-8000-000000000004',
};

const snake = (k) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const objTable = (id) => `obj_${id.replace(/-/g, '_')}`;

/**
 * Build a type definition from a flat column spec.
 * cols: [camelKey, sqlType, jsonType][] — jsonType is a JSON-schema primitive.
 */
function buildType(id, title, icon, description, cols) {
  const table = objTable(id);
  const colDefs = cols.map(([k, sql]) => `  "${snake(k)}" ${sql}`).join(',\n');
  const ddl =
    `CREATE TABLE "${table}" (\n` +
    `  item_id UUID NOT NULL,\n` +
    `${colDefs},\n` +
    `  CONSTRAINT "pk_${table}" PRIMARY KEY (item_id),\n` +
    `  CONSTRAINT "fk_${table}_item" FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE\n` +
    `)`;
  const properties = {};
  for (const [k, , json] of cols) properties[k] = { type: json };
  return {
    id,
    title,
    schema: {
      meta: {
        icon,
        description: description || title,
        details: '',
        keywords: '',
        tags: '',
        'ai-instructions': { claude: '' },
      },
      jsonSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: '',
        title,
        type: 'object',
        properties,
        required: [],
        additionalProperties: false,
      },
      sqlSchema: [ddl],
    },
  };
}

const PROPERTY = buildType(
  TYPE_IDS.property, 'property', 'DataObject',
  'One entry of an arbitrary key-value map. The key is item.value; this payload holds the value.',
  [
    ['value', 'TEXT', 'string'],
  ],
);

const SESSION = buildType(
  TYPE_IDS.session, 'Claude Session', 'Forum',
  'One Claude Code session, summarising its turns, tokens and timing.',
  [
    ['sessionId', 'TEXT', 'string'],
    ['cwd', 'TEXT', 'string'],
    ['gitBranch', 'TEXT', 'string'],
    ['version', 'TEXT', 'string'],
    ['startedAt', 'TEXT', 'string'],
    ['endedAt', 'TEXT', 'string'],
    ['turnCount', 'INTEGER', 'integer'],
    ['toolCallCount', 'INTEGER', 'integer'],
    ['tokensInput', 'BIGINT', 'integer'],
    ['tokensOutput', 'BIGINT', 'integer'],
    ['tokensCacheCreation', 'BIGINT', 'integer'],
    ['tokensCacheRead', 'BIGINT', 'integer'],
  ],
);

const TURN = buildType(
  TYPE_IDS.turn, 'Claude Turn', 'ChatBubbleOutline',
  'One turn in a session (a user or assistant message).',
  [
    ['kind', 'TEXT', 'string'],
    ['timestamp', 'TEXT', 'string'],
    ['model', 'TEXT', 'string'],
    ['usageInput', 'BIGINT', 'integer'],
    ['usageOutput', 'BIGINT', 'integer'],
    ['usageCacheCreation', 'BIGINT', 'integer'],
    ['usageCacheRead', 'BIGINT', 'integer'],
    ['parentUuid', 'TEXT', 'string'],
    ['isSidechain', 'BOOLEAN', 'boolean'],
    ['agentId', 'TEXT', 'string'],
    ['text', 'TEXT', 'string'],
    ['textLength', 'INTEGER', 'integer'],
  ],
);

const TOOL_CALL = buildType(
  TYPE_IDS.toolCall, 'Claude Tool Call', 'Build',
  'One tool invocation within an assistant turn; its arguments are child Property items.',
  [
    ['name', 'TEXT', 'string'],
    ['toolUseId', 'TEXT', 'string'],
    ['isError', 'BOOLEAN', 'boolean'],
    ['result', 'TEXT', 'string'],
  ],
);

const ALL_TYPES = [PROPERTY, SESSION, TURN, TOOL_CALL];

/**
 * Idempotently ensure all transcript types exist in `ds`. Safe to call every
 * import: resolves each by name, creating (with its fixed id + schema) only if
 * missing. Returns the TYPE_IDS map.
 */
async function ensureTypes(ds) {
  for (const def of ALL_TYPES) {
    const resolved = await ds.resolveTypeId(def.title);
    if (resolved && resolved.id) continue;
    await ds.createType(def.title, { schema: def.schema, id: def.id });
  }
  return TYPE_IDS;
}

module.exports = { TYPE_IDS, ALL_TYPES, ensureTypes, buildType, objTable };
