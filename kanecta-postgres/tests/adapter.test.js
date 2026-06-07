'use strict';

// Runs against a real local Postgres (the dev instance at KANECTA_TEST_PG_URL,
// defaulting to the same connection used by cloud.json) — pg-mem and friends
// don't support the recursive CTEs, triggers, and tsvector machinery this
// adapter relies on closely enough to be trustworthy.
//
// Each run gets its own schema (search_path-scoped), so the real `kanecta`
// database and its data are never touched; the schema is dropped afterwards.

const crypto = require('crypto');
const { Pool } = require('pg');
const { PostgresAdapter } = require('../src/adapter');

const CONNECTION_STRING =
  process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const OWNER = 'test@example.com';

const SCHEMA = `kanecta_test_${crypto.randomBytes(4).toString('hex')}`;

let adminPool;
let pool;
let adapter;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: CONNECTION_STRING });
  await adminPool.query(`CREATE SCHEMA "${SCHEMA}"`);

  pool = new Pool({ connectionString: CONNECTION_STRING, options: `-c search_path="${SCHEMA}"` });
  adapter = await PostgresAdapter.init(pool, OWNER);
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await adminPool.end();
  }
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

test('init sets up config and well-known roots', async () => {
  expect(adapter.config.owner).toBe(OWNER);
  expect(adapter.config.spec_version).toBe('1.3.0');

  const root = await adapter.getRoot();
  const dataRoot = await adapter.getDataRoot();
  expect(root).toBeTruthy();
  expect(dataRoot).toBeTruthy();
});

// ─── Item CRUD ────────────────────────────────────────────────────────────────

test('create / get / update / delete round-trip', async () => {
  const item = await adapter.create({ value: 'hello world', type: 'note', createdBy: OWNER });
  expect(item.value).toBe('hello world');

  const fetched = await adapter.get(item.id);
  expect(fetched.id).toBe(item.id);

  const updated = await adapter.update(item.id, { value: 'goodbye world' }, OWNER);
  expect(updated.value).toBe('goodbye world');

  await adapter.delete(item.id, OWNER);
  expect(await adapter.get(item.id)).toBeNull();
});

// ─── createType: obj_<typeId> table + search trigger ──────────────────────────
//
// Regression coverage for the gap where createType wrote the `types` row but
// never ran the type's sqlSchema — leaving writeObjectJson with no table to
// write to (it would silently warn-and-no-op instead of persisting data).

test('createType creates the obj_<typeId> table from sqlSchema', async () => {
  const typeId = crypto.randomUUID();
  const tableName = `obj_${typeId.replace(/-/g, '_')}`;

  const schema = {
    meta: {},
    jsonSchema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Widget',
      type: 'object',
      properties: { label: { type: 'string' }, count: { type: 'integer' } },
      required: [],
      additionalProperties: false,
    },
    sqlSchema: [
      `CREATE TABLE "${tableName}" (
         item_id UUID NOT NULL,
         "label" TEXT,
         "count" INTEGER,
         CONSTRAINT "pk_${tableName}" PRIMARY KEY (item_id),
         CONSTRAINT "fk_${tableName}_item" FOREIGN KEY (item_id) REFERENCES items(id)
       )`,
    ],
  };

  await adapter.createType('Widget', { schema, createdBy: OWNER, id: typeId });

  const { rows } = await pool.query(
    `SELECT to_regclass($1) AS reg`, [tableName],
  );
  expect(rows[0].reg).toBe(tableName);
});

test('object data persists through writeObjectJson/readObjectJson once the table exists', async () => {
  const typeId = crypto.randomUUID();
  const tableName = `obj_${typeId.replace(/-/g, '_')}`;

  const schema = {
    meta: {},
    jsonSchema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Gadget',
      type: 'object',
      properties: { label: { type: 'string' } },
      required: [],
      additionalProperties: false,
    },
    sqlSchema: [
      `CREATE TABLE "${tableName}" (
         item_id UUID NOT NULL,
         "label" TEXT,
         CONSTRAINT "pk_${tableName}" PRIMARY KEY (item_id),
         CONSTRAINT "fk_${tableName}_item" FOREIGN KEY (item_id) REFERENCES items(id)
       )`,
    ],
  };

  await adapter.createType('Gadget', { schema, createdBy: OWNER, id: typeId });

  const item = await adapter.create({
    type: 'object', typeId, value: 'a gadget', createdBy: OWNER,
    objectData: { label: 'sprocket' },
  });

  const objectData = await adapter.readObjectJson(item.id, typeId);
  expect(objectData).toEqual({ label: 'sprocket' });
});

test('createType attaches the FTS trigger to the new obj_* table', async () => {
  const typeId = crypto.randomUUID();
  const tableName = `obj_${typeId.replace(/-/g, '_')}`;

  const schema = {
    meta: {},
    jsonSchema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Doohickey',
      type: 'object',
      properties: { label: { type: 'string' } },
      required: [],
      additionalProperties: false,
    },
    sqlSchema: [
      `CREATE TABLE "${tableName}" (
         item_id UUID NOT NULL,
         "label" TEXT,
         CONSTRAINT "pk_${tableName}" PRIMARY KEY (item_id),
         CONSTRAINT "fk_${tableName}_item" FOREIGN KEY (item_id) REFERENCES items(id)
       )`,
    ],
  };

  await adapter.createType('Doohickey', { schema, createdBy: OWNER, id: typeId });

  const { rows } = await pool.query(
    `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_object_search_vector' AND tgrelid = $1::regclass`,
    [tableName],
  );
  expect(rows).toHaveLength(1);
});

// ─── Full-text search (search_index, migration 013) ───────────────────────────

test('search finds items by value and ranks by relevance, and stays in sync on update', async () => {
  const a = await adapter.create({ value: 'the quick brown fox jumps over the lazy dog', type: 'note', createdBy: OWNER });
  const b = await adapter.create({ value: 'foxes are quick and clever animals', type: 'note', createdBy: OWNER });
  await adapter.create({ value: 'completely unrelated content about gardening', type: 'note', createdBy: OWNER });

  let results = await adapter.search('fox', { limit: 10 });
  const ids = results.map(r => r.id);
  expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));

  // Triggers must keep the index in sync automatically as fields change
  await adapter.update(a.id, { value: 'no woodland creatures mentioned here' }, OWNER);
  results = await adapter.search('fox', { limit: 10 });
  expect(results.map(r => r.id)).not.toContain(a.id);
  expect(results.map(r => r.id)).toContain(b.id);
});

test('search can be scoped to a subtree via rootId', async () => {
  const branch = await adapter.create({ value: 'search-scope-branch', type: 'note', createdBy: OWNER });
  const inside = await adapter.create({ parentId: branch.id, value: 'needle inside the branch', type: 'note', createdBy: OWNER });
  const outside = await adapter.create({ value: 'needle outside the branch', type: 'note', createdBy: OWNER });

  const scoped = await adapter.search('needle', { rootId: branch.id, limit: 10 });
  const scopedIds = scoped.map(r => r.id);
  expect(scopedIds).toContain(inside.id);
  expect(scopedIds).not.toContain(outside.id);
});

test('search indexes object data fields too', async () => {
  const typeId = crypto.randomUUID();
  const tableName = `obj_${typeId.replace(/-/g, '_')}`;

  const schema = {
    meta: {},
    jsonSchema: {
      '$schema': 'http://json-schema.org/draft-07/schema#',
      title: 'Component',
      type: 'object',
      properties: { description: { type: 'string' } },
      required: [],
      additionalProperties: false,
    },
    sqlSchema: [
      `CREATE TABLE "${tableName}" (
         item_id UUID NOT NULL,
         "description" TEXT,
         CONSTRAINT "pk_${tableName}" PRIMARY KEY (item_id),
         CONSTRAINT "fk_${tableName}_item" FOREIGN KEY (item_id) REFERENCES items(id)
       )`,
    ],
  };
  await adapter.createType('Component', { schema, createdBy: OWNER, id: typeId });

  const item = await adapter.create({
    type: 'object', typeId, value: 'widget-7', createdBy: OWNER,
    objectData: { description: 'a uniquely identifiable zorbflange assembly' },
  });

  const results = await adapter.search('zorbflange', { limit: 10 });
  expect(results.map(r => r.id)).toContain(item.id);
});
