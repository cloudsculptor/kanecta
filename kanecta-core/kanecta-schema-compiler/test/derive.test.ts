import { test } from 'node:test';
import assert from 'node:assert';
import { deriveSqlSchema, deriveIndexDdl, deriveFullSchema, objTableName } from '../src/index.js';

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
