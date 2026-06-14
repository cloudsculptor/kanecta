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
const { reciprocalRankFusion } = require('../src/embeddings');

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

// ─── typeId referential integrity ─────────────────────────────────────────────

const ORPHAN_TYPE_ID = 'deadbeef-0000-4000-8000-000000000000';

test('create warns by default and throws under strict for an orphan typeId', async () => {
  // Default: written, with a non-enumerable warning.
  const before = await adapter.create({ type: 'object', typeId: ORPHAN_TYPE_ID, createdBy: OWNER });
  expect(before.warning).toMatch(/has no type definition/);
  expect(await adapter.get(before.id)).toBeTruthy();

  // Strict per-call: throws and writes nothing.
  const { rows: countBefore } = await pool.query(`SELECT COUNT(*)::int AS n FROM items`);
  await expect(
    adapter.create({ type: 'object', typeId: ORPHAN_TYPE_ID, strict: true, createdBy: OWNER }),
  ).rejects.toMatchObject({ name: 'UnknownTypeError', code: 'UNKNOWN_TYPE' });
  const { rows: countAfter } = await pool.query(`SELECT COUNT(*)::int AS n FROM items`);
  expect(countAfter[0].n).toBe(countBefore[0].n);
});

test('create with a registered typeId does not warn', async () => {
  const typeId = crypto.randomUUID();
  const tableName = `obj_${typeId.replace(/-/g, '_')}`;
  await adapter.createType('Cog', {
    schema: {
      meta: {},
      jsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      sqlSchema: [`CREATE TABLE "${tableName}" (item_id UUID PRIMARY KEY REFERENCES items(id))`],
    },
    createdBy: OWNER,
    id: typeId,
  });
  const item = await adapter.create({ type: 'object', typeId, createdBy: OWNER });
  expect(item.warning).toBeUndefined();
});

test('update to an orphan typeId warns by default and throws under strict (unchanged)', async () => {
  const item = await adapter.create({ value: 'x', type: 'note', createdBy: OWNER });

  const warned = await adapter.update(item.id, { type: 'object', typeId: ORPHAN_TYPE_ID }, OWNER);
  expect(warned.warning).toMatch(/has no type definition/);

  const fresh = await adapter.create({ value: 'y', type: 'note', createdBy: OWNER });
  await expect(
    adapter.update(fresh.id, { type: 'object', typeId: ORPHAN_TYPE_ID }, OWNER, { strict: true }),
  ).rejects.toMatchObject({ name: 'UnknownTypeError' });
  const after = await adapter.get(fresh.id);
  expect(after.type).toBe('note');
  expect(after.typeId).toBeNull();
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

// ─── Reciprocal Rank Fusion (pure merge logic — no DB) ────────────────────────

test('reciprocalRankFusion ranks items appearing in multiple lists above single-list items, preserving rank order', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, d = { id: 'd' };

  // 'a' ranks #1 in both lists, 'b' is #2 in list 1 only, 'c' is #1 in list 2
  // only, 'd' appears nowhere near the top of either.
  const merged = reciprocalRankFusion([
    [a, b, d],
    [c, a],
  ]);

  expect(merged.map(x => x.id)).toEqual(['a', 'c', 'b', 'd']);
});

test('reciprocalRankFusion returns each distinct item exactly once even if duplicated across lists', () => {
  const a = { id: 'a' }, b = { id: 'b' };
  const merged = reciprocalRankFusion([[a, b], [b, a], [a, b]]);
  expect(merged.map(x => x.id).sort()).toEqual(['a', 'b']);
  expect(merged).toHaveLength(2);
});

// ─── Semantic / hybrid search (pgvector + embedding provider, migration 014) ──
//
// `adapter` (from beforeAll) has no embedding provider configured — these get
// their own adapter instance, on the same pool/schema, wired up with the
// 'mock' provider so the suite never needs a real API key or network access.

describe('semantic / hybrid search', () => {
  let semanticAdapter;

  beforeAll(async () => {
    semanticAdapter = await PostgresAdapter.open(pool, {
      embeddings: { provider: 'mock', dimensions: 16 },
    });
  });

  test('embedItem stores a vector and skips re-embedding unchanged content', async () => {
    const item = await semanticAdapter.create({ value: 'photosynthesis converts sunlight into chemical energy', type: 'note', createdBy: OWNER });

    expect(await semanticAdapter.embedItem(item.id)).toBe(true);
    const { rows: first } = await pool.query(
      'SELECT content_hash, embedding FROM item_embeddings WHERE item_id = $1', [item.id],
    );
    expect(first).toHaveLength(1);
    expect(first[0].embedding).toBeTruthy();

    // Unchanged content — second call is a no-op (no new provider call, hash matches)
    expect(await semanticAdapter.embedItem(item.id)).toBe(false);

    // Changed content — re-embeds and updates the stored hash
    await semanticAdapter.update(item.id, { value: 'mitochondria are the powerhouse of the cell' }, OWNER);
    expect(await semanticAdapter.embedItem(item.id)).toBe(true);
    const { rows: second } = await pool.query(
      'SELECT content_hash FROM item_embeddings WHERE item_id = $1', [item.id],
    );
    expect(second[0].content_hash).not.toBe(first[0].content_hash);
  });

  test('processPendingEmbeddings drains the queue populated by write triggers', async () => {
    const item = await semanticAdapter.create({ value: 'queued for background embedding', type: 'note', createdBy: OWNER });

    const { rows: queued } = await pool.query(
      'SELECT 1 FROM pending_embeddings WHERE item_id = $1', [item.id],
    );
    expect(queued).toHaveLength(1);

    const result = await semanticAdapter.processPendingEmbeddings({ limit: 100 });
    expect(result.embedded).toBeGreaterThan(0);

    const { rows: remaining } = await pool.query(
      'SELECT 1 FROM pending_embeddings WHERE item_id = $1', [item.id],
    );
    expect(remaining).toHaveLength(0);

    const { rows: stored } = await pool.query(
      'SELECT 1 FROM item_embeddings WHERE item_id = $1 AND model = $2', [item.id, 'mock-embed'],
    );
    expect(stored).toHaveLength(1);
  });

  test('semanticSearch finds conceptually related items by embedding distance', async () => {
    const sun = await semanticAdapter.create({ value: 'the sun is a star that provides light and heat to the solar system', type: 'note', createdBy: OWNER });
    const star = await semanticAdapter.create({ value: 'stars are giant balls of burning gas radiating heat and light', type: 'note', createdBy: OWNER });
    const unrelated = await semanticAdapter.create({ value: 'quarterly accounting spreadsheet reconciliation notes', type: 'note', createdBy: OWNER });

    await semanticAdapter.processPendingEmbeddings({ limit: 100 });

    const results = await semanticAdapter.semanticSearch('a glowing celestial body radiating heat and light', { limit: 10 });
    const ids = results.map(r => r.id);
    expect(ids).toEqual(expect.arrayContaining([sun.id, star.id]));
    expect(ids.indexOf(unrelated.id)).not.toBe(-1); // present somewhere, but...
    expect(ids.indexOf(sun.id)).toBeLessThan(ids.indexOf(unrelated.id));
    expect(ids.indexOf(star.id)).toBeLessThan(ids.indexOf(unrelated.id));
  });

  test('semanticSearch can be scoped to a subtree via rootId', async () => {
    const branch = await semanticAdapter.create({ value: 'semantic-scope-branch', type: 'note', createdBy: OWNER });
    const inside = await semanticAdapter.create({ parentId: branch.id, value: 'a glowing star burning brightly with heat and light', type: 'note', createdBy: OWNER });
    const outside = await semanticAdapter.create({ value: 'a glowing star burning brightly with heat and light, elsewhere', type: 'note', createdBy: OWNER });

    await semanticAdapter.processPendingEmbeddings({ limit: 100 });

    const scoped = await semanticAdapter.semanticSearch('a bright star radiating heat and light', { rootId: branch.id, limit: 10 });
    const scopedIds = scoped.map(r => r.id);
    expect(scopedIds).toContain(inside.id);
    expect(scopedIds).not.toContain(outside.id);
  });

  test('hybridSearch fuses FTS and vector results and respects rootId/limit', async () => {
    const branch = await semanticAdapter.create({ value: 'hybrid-scope-branch', type: 'note', createdBy: OWNER });
    const inside = await semanticAdapter.create({ parentId: branch.id, value: 'a glowing star radiating heat and light', type: 'note', createdBy: OWNER });
    const outside = await semanticAdapter.create({ value: 'a glowing star radiating heat and light, elsewhere', type: 'note', createdBy: OWNER });

    await semanticAdapter.processPendingEmbeddings({ limit: 100 });

    const [hybrid, fts, vector] = await Promise.all([
      semanticAdapter.hybridSearch('a glowing star radiating heat and light', { rootId: branch.id, limit: 5 }),
      semanticAdapter.search('a glowing star radiating heat and light', { rootId: branch.id, limit: 20 }),
      semanticAdapter.semanticSearch('a glowing star radiating heat and light', { rootId: branch.id, limit: 20 }),
    ]);

    // It actually fuses both rankings (not just one) — and respects rootId/limit
    // exactly like search() and semanticSearch() individually do. (Vector search
    // has no relevance threshold — like any ANN search it returns the nearest
    // neighbours *in scope* regardless of how distant — so `branch` itself can
    // legitimately appear, just ranked behind the genuine match.)
    const hybridIds = hybrid.map(r => r.id);
    expect(fts.map(r => r.id)).toContain(inside.id);
    expect(vector.map(r => r.id)).toContain(inside.id);
    expect(hybridIds[0]).toBe(inside.id);
    expect(hybridIds).not.toContain(outside.id);
    expect(hybrid.length).toBeLessThanOrEqual(5);
  });

  test('semanticSearch and hybridSearch behave correctly without a configured provider', async () => {
    // No provider at all (the `adapter` from beforeAll): semanticSearch refuses
    // outright; hybridSearch degrades to plain FTS rather than failing.
    await expect(adapter.semanticSearch('anything')).rejects.toThrow(/embedding provider/i);
    expect(adapter.embeddingsEnabled).toBe(false);

    const item = await adapter.create({ value: 'fts-fallback-probe unique phrase', type: 'note', createdBy: OWNER });
    const results = await adapter.hybridSearch('fts-fallback-probe', { limit: 10 });
    expect(results.map(r => r.id)).toContain(item.id);
  });

  test('embeddings.enabled: false keeps generating embeddings but disables semantic/hybrid results', async () => {
    const pausedAdapter = await PostgresAdapter.open(pool, {
      embeddings: { provider: 'mock', dimensions: 16, enabled: false },
    });
    expect(pausedAdapter.embeddingsEnabled).toBe(false);

    // The provider is configured and still embeds on demand (so a background
    // worker can finish backfilling before search is switched on)...
    const item = await pausedAdapter.create({ value: 'paused-mode embedding probe', type: 'note', createdBy: OWNER });
    expect(await pausedAdapter.embedItem(item.id)).toBe(true);

    // ...but semanticSearch refuses, with a message distinct from "no provider"...
    await expect(pausedAdapter.semanticSearch('anything')).rejects.toThrow(/disabled/i);
    // ...and hybridSearch quietly falls back to FTS rather than erroring.
    const results = await pausedAdapter.hybridSearch('paused-mode embedding probe', { limit: 10 });
    expect(results.map(r => r.id)).toContain(item.id);
  });
});
