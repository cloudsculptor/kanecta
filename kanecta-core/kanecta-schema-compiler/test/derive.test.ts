import { test } from 'node:test';
import assert from 'node:assert';
import {
  deriveSqlSchema,
  deriveIndexDdl,
  deriveTriggerDdl,
  deriveFunctionDdl,
  deriveFullSchema,
  objTableName,
} from '../src/index.js';

const TYPE_ID = '105354a8-4bd9-4333-9b54-68192f44599c';
const TABLE = 'obj_105354a8_4bd9_4333_9b54_68192f44599c';

test('objTableName maps hyphens to underscores', () => {
  assert.equal(objTableName(TYPE_ID), TABLE);
});

test('requires a typeId and a known dialect', () => {
  assert.throws(() => deriveSqlSchema({}, {}), /typeId/);
  assert.throws(
    () => deriveSqlSchema({}, { typeId: TYPE_ID, dialect: 'oracle' as never }),
    /dialect/,
  );
});

test('derives scalar columns with item_id PK + FK (postgres)', () => {
  const [ddl, ...rest] = deriveSqlSchema(
    { properties: { name: { type: 'string' }, rank: { type: 'integer' }, score: { type: 'number' }, done: { type: 'boolean' } } },
    { typeId: TYPE_ID, dialect: 'postgres' },
  );
  assert.equal(rest.length, 0); // no child tables
  assert.match(ddl, new RegExp(`CREATE TABLE "${TABLE}"`));
  assert.match(ddl, /item_id UUID NOT NULL/);
  assert.match(ddl, /"name" TEXT/);
  assert.match(ddl, /"rank" BIGINT/);
  assert.match(ddl, /"score" DOUBLE PRECISION/);
  assert.match(ddl, /"done" BOOLEAN/);
  assert.match(ddl, /PRIMARY KEY \(item_id\)/);
  assert.match(ddl, /FOREIGN KEY \(item_id\) REFERENCES items\(id\)/);
});

test('camelCase property names become snake_case columns', () => {
  const [ddl] = deriveSqlSchema(
    { properties: { toolUseId: { type: 'string' }, tokensCacheRead: { type: 'integer' } } },
    { typeId: TYPE_ID, dialect: 'postgres' },
  );
  assert.match(ddl, /"tool_use_id" TEXT/);
  assert.match(ddl, /"tokens_cache_read" BIGINT/);
});

test('uuid reference fields get a column + FK to items(id)', () => {
  const [ddl] = deriveSqlSchema(
    {
      properties: {
        managerId: { type: 'string', format: 'uuid', typeId: 'some-person-type' },
        pipelineId: { type: 'string', format: 'uuid', 'x-kanecta-itemType': 'pipeline' },
      },
    },
    { typeId: TYPE_ID, dialect: 'postgres' },
  );
  assert.match(ddl, /"manager_id" UUID REFERENCES items\(id\)/);
  assert.match(ddl, /"pipeline_id" UUID REFERENCES items\(id\)/);
});

test('sqlite dialect maps to sqlite scalar types', () => {
  const [ddl] = deriveSqlSchema(
    { properties: { name: { type: 'string' }, rank: { type: 'integer' }, score: { type: 'number' }, done: { type: 'boolean' } } },
    { typeId: TYPE_ID, dialect: 'sqlite' },
  );
  assert.match(ddl, /item_id TEXT NOT NULL/);
  assert.match(ddl, /"rank" INTEGER/);
  assert.match(ddl, /"score" REAL/);
  assert.match(ddl, /"done" INTEGER/); // sqlite has no boolean
});

test('ansi dialect uses portable scalar types (CLOB, CHAR(36))', () => {
  const [ddl] = deriveSqlSchema(
    { properties: { text: { type: 'string' }, ref: { type: 'string', format: 'uuid', typeId: 't' } } },
    { typeId: TYPE_ID, dialect: 'ansi' },
  );
  assert.match(ddl, /item_id CHAR\(36\) NOT NULL/);
  assert.match(ddl, /"text" CLOB/); // large text of any size
  assert.match(ddl, /"ref" CHAR\(36\) REFERENCES items\(id\)/);
});

test('scalar array → native array column on postgres', () => {
  const ddl = deriveSqlSchema(
    { properties: { tags: { type: 'array', items: { type: 'string' } } } },
    { typeId: TYPE_ID, dialect: 'postgres' },
  );
  assert.equal(ddl.length, 1); // no child table
  assert.match(ddl[0], /"tags" TEXT\[\]/);
});

test('scalar array → JSON text column on sqlite', () => {
  const [ddl, ...rest] = deriveSqlSchema(
    { properties: { tags: { type: 'array', items: { type: 'string' } } } },
    { typeId: TYPE_ID, dialect: 'sqlite' },
  );
  assert.equal(rest.length, 0);
  assert.match(ddl, /"tags" TEXT/);
});

test('scalar array → decomposed child value-table on ansi (portable, no array column)', () => {
  const ddls = deriveSqlSchema(
    { properties: { tags: { type: 'array', items: { type: 'string' } } } },
    { typeId: TYPE_ID, dialect: 'ansi' },
  );
  assert.equal(ddls.length, 2); // object table + child value-table
  // The object table has NO tags column.
  assert.doesNotMatch(ddls[0], /"tags"/);
  const child = ddls[1];
  assert.match(child, new RegExp(`CREATE TABLE "${TABLE}_tags"`));
  assert.match(child, /ord INTEGER NOT NULL/);
  assert.match(child, /value CLOB/);
  assert.match(child, /PRIMARY KEY \(item_id, ord\)/);
  assert.match(child, new RegExp(`FOREIGN KEY \\(item_id\\) REFERENCES "${TABLE}" \\(item_id\\)`));
});

test('an integer array decomposes with an integer value column on ansi', () => {
  const ddls = deriveSqlSchema(
    { properties: { counts: { type: 'array', items: { type: 'integer' } } } },
    { typeId: TYPE_ID, dialect: 'ansi' },
  );
  assert.match(ddls[1], /value BIGINT/);
});

test('reproduces the hand-authored `property` core type schema (postgres)', () => {
  // property = one `value` TEXT column (the core scalar value-holder).
  const [ddl] = deriveSqlSchema(
    { properties: { value: { type: 'string' } } },
    { typeId: TYPE_ID, dialect: 'postgres' },
  );
  assert.match(ddl, /"value" TEXT/);
  assert.match(ddl, new RegExp(`CREATE TABLE "${TABLE}"`));
});

// ---------------------------------------------------------------------------
// deriveIndexDdl — declared `indexes` → CREATE INDEX DDL
// ---------------------------------------------------------------------------

const PERSON = {
  properties: {
    name: { type: 'string' },
    born: { type: 'string', format: 'date' },
    managerId: { type: 'string', format: 'uuid', typeId: 'person-type' },
    tags: { type: 'array', items: { type: 'string' } },
  },
} as const;

test('deriveIndexDdl requires a typeId and a known dialect', () => {
  assert.throws(() => deriveIndexDdl(PERSON, [{ fields: ['name'] }], {}), /typeId/);
  assert.throws(
    () => deriveIndexDdl(PERSON, [{ fields: ['name'] }], { typeId: TYPE_ID, dialect: 'oracle' as never }),
    /dialect/,
  );
});

test('deriveIndexDdl returns [] for absent/empty indexes', () => {
  assert.deepEqual(deriveIndexDdl(PERSON, undefined, { typeId: TYPE_ID }), []);
  assert.deepEqual(deriveIndexDdl(PERSON, [], { typeId: TYPE_ID }), []);
});

test('a simple single-field index (postgres) with a deterministic name', () => {
  const [ddl, ...rest] = deriveIndexDdl(PERSON, [{ fields: ['managerId'] }], { typeId: TYPE_ID, dialect: 'postgres' });
  assert.equal(rest.length, 0);
  assert.equal(ddl, `CREATE INDEX "idx_${TABLE}_manager_id" ON "${TABLE}" ("manager_id")`);
});

test('compound index preserves field order and snake_cases each column', () => {
  const [ddl] = deriveIndexDdl(PERSON, [{ fields: ['managerId', 'born'] }], { typeId: TYPE_ID });
  assert.match(ddl, new RegExp(`ON "${TABLE}" \\("manager_id", "born"\\)`));
  assert.match(ddl, new RegExp(`"idx_${TABLE}_manager_id_born"`));
});

test('unique index emits CREATE UNIQUE INDEX and a _uq name suffix', () => {
  const [ddl] = deriveIndexDdl(PERSON, [{ fields: ['name'], unique: true }], { typeId: TYPE_ID });
  assert.match(ddl, /^CREATE UNIQUE INDEX /);
  assert.match(ddl, new RegExp(`"idx_${TABLE}_name_uq"`));
});

test('caseInsensitive uses lower() on postgres and COLLATE NOCASE on sqlite', () => {
  const [pg] = deriveIndexDdl(PERSON, [{ fields: ['name'], caseInsensitive: true }], { typeId: TYPE_ID, dialect: 'postgres' });
  assert.match(pg, /\(lower\("name"\)\)/);
  assert.match(pg, new RegExp(`"idx_${TABLE}_name_ci"`));
  const [sq] = deriveIndexDdl(PERSON, [{ fields: ['name'], caseInsensitive: true }], { typeId: TYPE_ID, dialect: 'sqlite' });
  assert.match(sq, /\("name" COLLATE NOCASE\)/);
});

test('caseInsensitive on a non-text (uuid ref / integer) field is a compile error', () => {
  assert.throws(
    () => deriveIndexDdl(PERSON, [{ fields: ['managerId'], caseInsensitive: true }], { typeId: TYPE_ID }),
    /requires text columns/,
  );
});

test('a partial-index predicate is appended as WHERE', () => {
  const [ddl] = deriveIndexDdl(PERSON, [{ fields: ['born'], where: 'born IS NOT NULL' }], { typeId: TYPE_ID });
  assert.match(ddl, /\) WHERE born IS NOT NULL$/);
});

test('an explicit name overrides the derived name', () => {
  const [ddl] = deriveIndexDdl(PERSON, [{ fields: ['name'], name: 'people_by_name' }], { typeId: TYPE_ID });
  assert.match(ddl, /"people_by_name"/);
});

test('a field not in jsonSchema is a compile error', () => {
  assert.throws(
    () => deriveIndexDdl(PERSON, [{ fields: ['nope'] }], { typeId: TYPE_ID }),
    /not a property of the type's jsonSchema/,
  );
});

test('an index entry with no fields is a compile error', () => {
  assert.throws(
    () => deriveIndexDdl(PERSON, [{ fields: [] }], { typeId: TYPE_ID }),
    /at least one field/,
  );
});

test('deriveFullSchema concatenates table DDL then index DDL', () => {
  const ddls = deriveFullSchema(PERSON, {
    typeId: TYPE_ID,
    dialect: 'postgres',
    indexes: [{ fields: ['name'], unique: true, caseInsensitive: true }, { fields: ['managerId'] }],
  });
  // First statement is the object table; the last two are the indexes, in order.
  assert.match(ddls[0], new RegExp(`^CREATE TABLE "${TABLE}"`));
  assert.match(ddls[ddls.length - 2], /^CREATE UNIQUE INDEX .*lower\("name"\)/);
  assert.match(ddls[ddls.length - 1], /^CREATE INDEX .*"manager_id"/);
});

test('deriveFullSchema with no indexes equals deriveSqlSchema', () => {
  const a = deriveFullSchema(PERSON, { typeId: TYPE_ID, dialect: 'sqlite' });
  const b = deriveSqlSchema(PERSON, { typeId: TYPE_ID, dialect: 'sqlite' });
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// computedColumns — declared generated columns, emitted inside the CREATE TABLE
// ---------------------------------------------------------------------------

test('computed column emits a GENERATED column inline on postgres (STORED)', () => {
  const [ddl, ...rest] = deriveSqlSchema(
    { properties: { price: { type: 'number' }, qty: { type: 'integer' } } },
    {
      typeId: TYPE_ID,
      dialect: 'postgres',
      computedColumns: { total: { expression: 'price * qty', type: 'number', stored: true } },
    },
  );
  assert.equal(rest.length, 0);
  assert.match(ddl, /"total" DOUBLE PRECISION GENERATED ALWAYS AS \(price \* qty\) STORED/);
  // The stored columns it references still exist and precede it.
  assert.ok(ddl.indexOf('"price"') < ddl.indexOf('"total"'));
});

test('computed column defaults to VIRTUAL when not stored, snake_cases its name', () => {
  const [ddl] = deriveSqlSchema(
    { properties: { firstName: { type: 'string' } } },
    {
      typeId: TYPE_ID,
      dialect: 'sqlite',
      computedColumns: { upperName: { expression: 'upper(first_name)', type: 'string' } },
    },
  );
  assert.match(ddl, /"upper_name" TEXT GENERATED ALWAYS AS \(upper\(first_name\)\) VIRTUAL/);
});

test('computed column is a compile error on ansi (unsupported)', () => {
  assert.throws(
    () =>
      deriveSqlSchema(
        { properties: { price: { type: 'number' } } },
        {
          typeId: TYPE_ID,
          dialect: 'ansi',
          computedColumns: { total: { expression: 'price * 2', type: 'number' } },
        },
      ),
    /does not support computed columns/,
  );
});

test('no computedColumns leaves the CREATE TABLE unchanged (backward compat)', () => {
  const withEmpty = deriveSqlSchema(PERSON, { typeId: TYPE_ID, dialect: 'postgres', computedColumns: {} });
  const without = deriveSqlSchema(PERSON, { typeId: TYPE_ID, dialect: 'postgres' });
  assert.deepEqual(withEmpty, without);
});

// ---------------------------------------------------------------------------
// deriveTriggerDdl — declared `triggers` → CREATE TRIGGER DDL
// ---------------------------------------------------------------------------

test('deriveTriggerDdl requires a typeId and known dialect, returns [] when empty', () => {
  assert.throws(() => deriveTriggerDdl([], {}), /typeId/);
  assert.throws(
    () => deriveTriggerDdl([], { typeId: TYPE_ID, dialect: 'oracle' as never }),
    /dialect/,
  );
  assert.deepEqual(deriveTriggerDdl(undefined, { typeId: TYPE_ID }), []);
  assert.deepEqual(deriveTriggerDdl([], { typeId: TYPE_ID }), []);
});

test('postgres trigger emits DROP IF EXISTS + CREATE with events joined by OR', () => {
  const [ddl, ...rest] = deriveTriggerDdl(
    [
      {
        timing: 'BEFORE',
        events: ['INSERT', 'UPDATE'],
        functionName: 'touch_updated_at',
        when: 'NEW.status IS NOT NULL',
      },
    ],
    { typeId: TYPE_ID, dialect: 'postgres' },
  );
  assert.equal(rest.length, 0);
  assert.match(ddl, new RegExp(`DROP TRIGGER IF EXISTS "trg_${TABLE}_before_insert_update" ON "${TABLE}";`));
  assert.match(ddl, new RegExp(`CREATE TRIGGER "trg_${TABLE}_before_insert_update" BEFORE INSERT OR UPDATE ON "${TABLE}"`));
  assert.match(ddl, /FOR EACH ROW WHEN \(NEW\.status IS NOT NULL\) EXECUTE FUNCTION "touch_updated_at"\(\)/);
});

test('postgres trigger honours forEach statement and functionId, and explicit name', () => {
  const [ddl] = deriveTriggerDdl(
    [{ name: 'audit_del', timing: 'AFTER', events: ['DELETE'], forEach: 'statement', functionId: 'fn_audit' }],
    { typeId: TYPE_ID, dialect: 'postgres' },
  );
  assert.match(ddl, /"audit_del" AFTER DELETE ON/);
  assert.match(ddl, /FOR EACH STATEMENT EXECUTE FUNCTION "fn_audit"\(\)/);
});

test('postgres trigger without a function reference is a compile error', () => {
  assert.throws(
    () => deriveTriggerDdl([{ timing: 'BEFORE', events: ['INSERT'] }], { typeId: TYPE_ID, dialect: 'postgres' }),
    /requires a functionName or functionId/,
  );
});

test('sqlite trigger emits one inline CREATE TRIGGER per event (no EXECUTE FUNCTION)', () => {
  const ddls = deriveTriggerDdl(
    [{ name: 'touch', timing: 'AFTER', events: ['INSERT', 'UPDATE'], body: 'UPDATE items SET updated_at = 1 WHERE id = NEW.item_id;' }],
    { typeId: TYPE_ID, dialect: 'sqlite' },
  );
  assert.equal(ddls.length, 2); // one per event
  assert.match(ddls[0], new RegExp(`CREATE TRIGGER "touch_insert" AFTER INSERT ON "${TABLE}" FOR EACH ROW BEGIN`));
  assert.match(ddls[1], new RegExp(`CREATE TRIGGER "touch_update" AFTER UPDATE ON "${TABLE}" FOR EACH ROW BEGIN`));
  // Body is inlined with a single trailing semicolon then END (no EXECUTE FUNCTION).
  assert.match(ddls[0], /BEGIN UPDATE items SET updated_at = 1 WHERE id = NEW\.item_id; END$/);
  assert.doesNotMatch(ddls[0], /EXECUTE FUNCTION/);
});

test('sqlite single-event trigger keeps the exact name (no event suffix)', () => {
  const [ddl] = deriveTriggerDdl(
    [{ name: 'on_del', timing: 'BEFORE', events: ['DELETE'], body: 'SELECT 1;' }],
    { typeId: TYPE_ID, dialect: 'sqlite' },
  );
  assert.match(ddl, /CREATE TRIGGER "on_del" BEFORE DELETE ON/);
});

test('sqlite trigger without a body is a compile error', () => {
  assert.throws(
    () => deriveTriggerDdl([{ timing: 'AFTER', events: ['INSERT'] }], { typeId: TYPE_ID, dialect: 'sqlite' }),
    /requires an inline body/,
  );
});

test('triggers are unsupported on ansi (compile error)', () => {
  assert.throws(
    () => deriveTriggerDdl([{ timing: 'AFTER', events: ['INSERT'], body: 'x' }], { typeId: TYPE_ID, dialect: 'ansi' }),
    /does not support triggers/,
  );
});

test('a trigger with no events is a compile error', () => {
  assert.throws(
    () => deriveTriggerDdl([{ timing: 'AFTER', events: [] }], { typeId: TYPE_ID, dialect: 'postgres' }),
    /at least one event/,
  );
});

// ---------------------------------------------------------------------------
// deriveFunctionDdl — declared `storedFunctions` → CREATE FUNCTION DDL (pg only)
// ---------------------------------------------------------------------------

test('postgres stored function emits CREATE OR REPLACE FUNCTION with defaults', () => {
  const [ddl, ...rest] = deriveFunctionDdl(
    [{ name: 'touch_updated_at', returns: 'trigger', body: 'BEGIN NEW.updated_at = now(); RETURN NEW; END;' }],
    { typeId: TYPE_ID, dialect: 'postgres' },
  );
  assert.equal(rest.length, 0);
  assert.match(ddl, /^CREATE OR REPLACE FUNCTION "touch_updated_at"\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$/);
  assert.match(ddl, /BEGIN NEW\.updated_at = now\(\); RETURN NEW; END;/);
});

test('postgres stored function maps a scalar return type and honours language', () => {
  const [ddl] = deriveFunctionDdl(
    [{ name: 'row_count', returns: 'integer', language: 'sql', body: 'SELECT count(*) FROM items' }],
    { typeId: TYPE_ID, dialect: 'postgres' },
  );
  assert.match(ddl, /RETURNS BIGINT LANGUAGE sql AS/);
});

test('stored functions are omitted on sqlite and ansi', () => {
  const fns = [{ name: 'f', returns: 'trigger', body: 'x' }];
  assert.deepEqual(deriveFunctionDdl(fns, { typeId: TYPE_ID, dialect: 'sqlite' }), []);
  assert.deepEqual(deriveFunctionDdl(fns, { typeId: TYPE_ID, dialect: 'ansi' }), []);
});

test('a stored function without a body is a compile error (postgres)', () => {
  assert.throws(
    () => deriveFunctionDdl([{ name: 'f', returns: 'trigger', body: '' }], { typeId: TYPE_ID, dialect: 'postgres' }),
    /requires a body/,
  );
});

// ---------------------------------------------------------------------------
// deriveFullSchema — ordering of functions → table → indexes → triggers
// ---------------------------------------------------------------------------

test('deriveFullSchema orders functions before the table and triggers after indexes', () => {
  const ddls = deriveFullSchema(PERSON, {
    typeId: TYPE_ID,
    dialect: 'postgres',
    storedFunctions: [{ name: 'touch', returns: 'trigger', body: 'BEGIN RETURN NEW; END;' }],
    computedColumns: { label: { expression: "name || ' (person)'", type: 'string', stored: true } },
    indexes: [{ fields: ['name'] }],
    triggers: [{ timing: 'BEFORE', events: ['UPDATE'], functionName: 'touch' }],
  });
  // Function first.
  assert.match(ddls[0], /^CREATE OR REPLACE FUNCTION "touch"/);
  // Then the object table — with the computed column inline.
  const tableIdx = ddls.findIndex((s) => new RegExp(`^CREATE TABLE "${TABLE}"`).test(s));
  assert.ok(tableIdx > 0);
  assert.match(ddls[tableIdx], /"label" TEXT GENERATED ALWAYS AS/);
  // Index before trigger.
  const idxIdx = ddls.findIndex((s) => /^CREATE INDEX/.test(s));
  const trgIdx = ddls.findIndex((s) => /CREATE TRIGGER/.test(s));
  assert.ok(tableIdx < idxIdx && idxIdx < trgIdx);
});

test('deriveFullSchema with no new inputs is identical to the table + index DDL (backward compat)', () => {
  const full = deriveFullSchema(PERSON, {
    typeId: TYPE_ID,
    dialect: 'postgres',
    indexes: [{ fields: ['name'] }],
  });
  const expected = [
    ...deriveSqlSchema(PERSON, { typeId: TYPE_ID, dialect: 'postgres' }),
    ...deriveIndexDdl(PERSON, [{ fields: ['name'] }], { typeId: TYPE_ID, dialect: 'postgres' }),
  ];
  assert.deepEqual(full, expected);
});

test('nullable-union scalars map to their non-null SQL type, not TEXT', () => {
  const ddl = deriveSqlSchema({
    properties: {
      flag:   { type: ['boolean', 'null'] },
      count:  { type: ['integer', 'null'] },
      amount: { type: ['number', 'null'] },
      label:  { type: ['string', 'null'] },
      tags:   { type: ['array', 'null'], items: { type: 'string' } },
    },
  }, { typeId: TYPE_ID, dialect: 'postgres' });
  const create = ddl.find((s) => /CREATE TABLE/.test(s)) as string;
  assert.match(create, /"flag" BOOLEAN/);
  assert.match(create, /"count" BIGINT/);
  assert.match(create, /"amount" DOUBLE PRECISION/);
  assert.match(create, /"label" TEXT/);
  // nullable array is still recognised as an array column, not degraded to a scalar
  assert.match(create, /"tags" TEXT\[\]/);
});

test('a genuine-JSON field (x-kanecta-storage:"json") maps to the dialect json type', () => {
  const pg = deriveSqlSchema({ properties: { schema: { type: 'object', 'x-kanecta-storage': 'json' } } },
    { typeId: TYPE_ID, dialect: 'postgres' }).find((s) => /CREATE TABLE/.test(s)) as string;
  assert.match(pg, /"schema" JSONB/);
  const lite = deriveSqlSchema({ properties: { schema: { type: 'object', 'x-kanecta-storage': 'json' } } },
    { typeId: TYPE_ID, dialect: 'sqlite' }).find((s) => /CREATE TABLE/.test(s)) as string;
  assert.match(lite, /"schema" TEXT/);
});

test('an unmarked object field is a compile error (must normalise into a child type)', () => {
  assert.throws(
    () => deriveSqlSchema({ properties: { channel: { type: 'object' } } }, { typeId: TYPE_ID, dialect: 'postgres' }),
    /object-typed field cannot be a column/,
  );
  // nullable object union is also caught
  assert.throws(
    () => deriveSqlSchema({ properties: { config: { type: ['object', 'null'] } } }, { typeId: TYPE_ID, dialect: 'postgres' }),
    /object-typed field cannot be a column/,
  );
});
