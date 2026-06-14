'use strict';

// PostgresAdapter — implements the Kanecta adapter interface against PostgreSQL.
// API is identical to FilesystemAdapter (same method names, same return shapes)
// but every method is async. Callers must await all calls.
//
// Usage:
//   const adapter = await PostgresAdapter.init(pool, owner);   // fresh DB
//   const adapter = await PostgresAdapter.open(pool);           // existing DB

const crypto = require('crypto');
const { createEmbeddingProvider, reciprocalRankFusion } = require('./embeddings');

const ROOT_ID        = '00000000-0000-0000-0000-000000000000';
const DEFAULT_LICENSE = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739';
const WELL_KNOWN_TYPES = new Set(['root', 'system_root', 'app_root', 'component_root', 'data_root']);
const WELL_KNOWN_ORDER = ['system_root', 'app_root', 'component_root', 'data_root'];
const UUID_RE        = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_RE        = /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi;
const VALID_REL_TYPES = [
  'relates-to', 'depends-on', 'enables', 'contradicts',
  'blocks', 'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes',
];

// Built-in type names. Mirrors VALID_TYPES in @kanecta/filesystem's adapter.js
// (kept local to avoid a cross-package dependency) — keep the two in sync.
const PRIMITIVE_TYPES = new Set([
  'string', 'number', 'text', 'heading', 'file', 'symlink', 'url', 'image', 'function', 'markdown', 'runner',
  'object', 'decision', 'annotation', 'claim', 'question', 'task', 'note', 'concept', 'entity', 'event',
  'root', 'system_root', 'app_root', 'component_root', 'data_root',
]);

// Mirror of @kanecta/filesystem's UnknownTypeError — same name/code/shape so
// callers and the MCP layer can branch on it identically across adapters.
class UnknownTypeError extends Error {
  constructor(typeName) {
    super(`unknown type "${typeName}" — not a registered type definition`);
    this.name = 'UnknownTypeError';
    this.code = 'UNKNOWN_TYPE';
    this.typeName = typeName;
  }
}

// ─── Row → item shape ─────────────────────────────────────────────────────────

function rowToItem(row) {
  if (!row) return null;
  return {
    id:                  row.id,
    parentId:            row.parent_id,
    value:               row.value,
    type:                row.type,
    typeId:              row.type_id,
    owner:               row.owner,
    license:             row.license,
    sortOrder:           row.sort_order,
    confidence:          row.confidence,
    status:              row.status,
    tags:                row.tags ?? [],
    createdAt:           row.created_at?.toISOString() ?? null,
    modifiedAt:          row.modified_at?.toISOString() ?? null,
    createdBy:           row.created_by,
    modifiedBy:          row.modified_by,
    cachedAt:            row.cached_at?.toISOString() ?? null,
    subscribedAt:        row.subscribed_at?.toISOString() ?? null,
    subscriptionSource:  row.subscription_source,
    completedAt:         row.completed_at?.toISOString() ?? null,
    dueAt:               row.due_at?.toISOString() ?? null,
    visibility:          row.visibility ?? 'private',
    aspect:              row.aspect ?? null,
  };
}

function parseLinks(value) {
  if (!value || typeof value !== 'string') return [];
  const links = new Set();
  let m;
  const re = new RegExp(LINK_RE.source, 'gi');
  while ((m = re.exec(value)) !== null) links.add(m[1]);
  return [...links];
}

function objTableName(typeId) {
  return `obj_${typeId.replace(/-/g, '_')}`;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

class PostgresAdapter {
  constructor(pool, { embeddings = null } = {}) {
    this._pool   = pool;
    this._config = null;
    // Optional — null when the workspace has no `cloud.embeddings` config (or it's
    // unrecognised). FTS-only search keeps working either way; semantic search
    // requires a provider (and `enabled: true`, the default) and throws a
    // clear error without one — hybridSearch instead degrades to FTS-only.
    this._embeddingProvider = createEmbeddingProvider(embeddings);
    this._embeddingsEnabled = embeddings?.enabled !== false;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  static async init(pool, owner, { embeddings = null } = {}) {
    const adapter = new PostgresAdapter(pool, { embeddings });
    await adapter._migrate();
    await adapter._ensureConfig(owner);
    await adapter._initRoots();
    if (adapter._embeddingProvider) await adapter._ensureEmbeddingTable();
    return adapter;
  }

  static async open(pool, { embeddings = null } = {}) {
    const adapter = new PostgresAdapter(pool, { embeddings });
    const cfg = await adapter._loadConfig();
    if (!cfg) throw new Error('Not a Kanecta database: config missing or empty');
    adapter._config = cfg;
    if (adapter._embeddingProvider) await adapter._ensureEmbeddingTable();
    return adapter;
  }

  get config() {
    if (!this._config) throw new Error('Adapter not initialised — call open() or init()');
    return this._config;
  }

  get relTypes() { return VALID_REL_TYPES; }

  addRelTypes(_names) {
    // No-op in Postgres mode — relationship types are defined in VALID_REL_TYPES.
  }

  // ─── Migrations ─────────────────────────────────────────────────────────────

  async _migrate() {
    const fs   = require('fs');
    const path = require('path');
    const dir  = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await this._pool.query(sql);
    }
  }

  async _ensureConfig(owner) {
    await this._pool.query(
      `INSERT INTO config (key, value) VALUES ('owner', $1), ('spec_version', '1.3.0')
       ON CONFLICT (key) DO NOTHING`,
      [owner],
    );
    this._config = await this._loadConfig();
  }

  async _loadConfig() {
    try {
      const { rows } = await this._pool.query('SELECT key, value FROM config');
      if (!rows.length) return null;
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    } catch { return null; }
  }

  // ─── Well-known root nodes ───────────────────────────────────────────────────

  async _initRoots() {
    const existing = await this.get(ROOT_ID);
    if (!existing) await this._createWellKnownNode(ROOT_ID, ROOT_ID, 'root', 0);
    const children = await this.children(ROOT_ID);
    const existingTypes = new Set(children.map(c => c.type));
    for (let i = 0; i < WELL_KNOWN_ORDER.length; i++) {
      const type = WELL_KNOWN_ORDER[i];
      if (!existingTypes.has(type)) {
        await this._createWellKnownNode(crypto.randomUUID(), ROOT_ID, type, i);
      }
    }
  }

  async _createWellKnownNode(id, parentId, type, sortOrder) {
    const now   = new Date();
    const owner = this.config.owner;
    const value = type === 'data_root' ? "Your name or organisation's name here" : type;
    await this._pool.query(
      `INSERT INTO items (id, parent_id, value, type, owner, license, sort_order,
         created_at, modified_at, created_by, modified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$5,$5)
       ON CONFLICT (id) DO NOTHING`,
      [id, parentId, value, type, owner, DEFAULT_LICENSE, sortOrder, now],
    );
    await this._snapshot(id, 'create', owner, now);
    return this.get(id);
  }

  async getRoot()     { return this._getByType('root'); }
  async getDataRoot() { return this._getByType('data_root'); }

  async _getByType(type) {
    const { rows } = await this._pool.query(
      'SELECT * FROM items WHERE type = $1 LIMIT 1', [type],
    );
    return rowToItem(rows[0] ?? null);
  }

  _assertEditable(item, id) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (item.type !== 'data_root' && (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID))
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be modified`);
  }

  _assertDeletable(item, id) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID)
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be deleted`);
  }

  // ─── History ────────────────────────────────────────────────────────────────

  async _snapshot(idOrItem, changeType, changedBy, now) {
    const item = typeof idOrItem === 'string' ? await this.get(idOrItem) : idOrItem;
    if (!item) return;
    await this._pool.query(
      `INSERT INTO history (id, item_id, snapshot, snapshot_at, changed_by, change_type)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), item.id, JSON.stringify(item), now ?? new Date(), changedBy, changeType],
    );
  }

  // ─── Item CRUD ───────────────────────────────────────────────────────────────

  async get(id) {
    const { rows } = await this._pool.query('SELECT * FROM items WHERE id = $1', [id]);
    return rowToItem(rows[0] ?? null);
  }

  async create({
    parentId, value = null, type = 'string', typeId = null,
    owner, license = null, sortOrder, confidence = null, status = null,
    tags = [], createdBy, objectData = null, dueAt = null, aspect = null,
  } = {}) {
    if (WELL_KNOWN_TYPES.has(type))
      throw new Error(`Type '${type}' is well-known and cannot be created via create()`);

    if (parentId == null) {
      const dr = await this.getDataRoot();
      if (!dr) throw new Error('Datastore not initialised: data_root not found');
      parentId = dr.id;
    }

    const id       = crypto.randomUUID();
    const now      = new Date();
    const ownerVal = owner || this.config.owner;
    const actor    = createdBy || ownerVal;

    if (sortOrder == null) {
      const siblings = await this.children(parentId);
      sortOrder = siblings.length === 0 ? 0 : Math.max(...siblings.map(s => s.sortOrder)) + 1;
    }

    await this._pool.query(
      `INSERT INTO items
         (id, parent_id, value, type, type_id, owner, license, sort_order,
          confidence, status, tags, created_at, modified_at, created_by, modified_by,
          due_at, visibility, aspect)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$13,$14,'private',$15)`,
      [
        id, parentId, value,
        type, type === 'object' ? typeId : null,
        ownerVal, license ?? DEFAULT_LICENSE,
        sortOrder, confidence, status, tags,
        now, actor, dueAt, aspect,
      ],
    );

    // links index
    for (const link of parseLinks(value)) {
      await this._pool.query(
        'INSERT INTO links (source_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [id, link],
      );
    }

    if (objectData && type === 'object' && typeId) {
      await this.writeObjectJson(id, typeId, objectData);
    }

    const item = await this.get(id);
    await this._snapshot(item, 'create', actor, now);
    return item;
  }

  async update(id, changes, actor) {
    const current = await this.get(id);
    this._assertEditable(current, id);
    actor = actor || this.config.owner;
    const now = new Date();
    await this._snapshot(current, 'update', actor, now);

    const sets   = [];
    const params = [];
    let   p      = 1;

    const maybeSet = (col, val) => { sets.push(`${col} = $${p++}`); params.push(val); };

    if ('value' in changes) {
      const oldLinks = parseLinks(current.value);
      const newLinks = parseLinks(changes.value);
      for (const l of oldLinks) if (!newLinks.includes(l))
        await this._pool.query('DELETE FROM links WHERE source_id=$1 AND target_id=$2', [id, l]);
      for (const l of newLinks) if (!oldLinks.includes(l))
        await this._pool.query('INSERT INTO links (source_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, l]);
      maybeSet('value', changes.value);
    }

    if ('type' in changes)       maybeSet('type',       changes.type);
    if ('typeId' in changes)     maybeSet('type_id',    changes.typeId);
    if ('parentId' in changes)   maybeSet('parent_id',  changes.parentId);
    if ('sortOrder' in changes)  maybeSet('sort_order', changes.sortOrder);
    if ('confidence' in changes) maybeSet('confidence', changes.confidence);
    if ('status' in changes)     maybeSet('status',     changes.status);
    if ('license' in changes)    maybeSet('license',    changes.license);
    if ('completedAt' in changes) maybeSet('completed_at', changes.completedAt);
    if ('dueAt' in changes)      maybeSet('due_at',     changes.dueAt);
    if ('visibility' in changes) maybeSet('visibility', changes.visibility);
    if ('aspect' in changes)     maybeSet('aspect',     changes.aspect);

    if ('tags' in changes) maybeSet('tags', changes.tags);

    maybeSet('modified_at', now);
    maybeSet('modified_by', actor);

    if (sets.length) {
      await this._pool.query(
        `UPDATE items SET ${sets.join(', ')} WHERE id = $${p}`,
        [...params, id],
      );
    }

    return this.get(id);
  }

  async deleteWarnings(id) {
    const { rows: linkRows } = await this._pool.query(
      'SELECT COUNT(*) FROM links WHERE target_id = $1', [id],
    );
    const { rows: relRows } = await this._pool.query(
      'SELECT COUNT(*) FROM relationships WHERE target_id = $1', [id],
    );
    const warnings = [];
    if (parseInt(linkRows[0].count) > 0)
      warnings.push(`${linkRows[0].count} item(s) link to this via [[uuid]] syntax`);
    if (parseInt(relRows[0].count) > 0)
      warnings.push(`${relRows[0].count} inbound relationship(s) point to this item`);
    return warnings;
  }

  async delete(id, actor) {
    const item = await this.get(id);
    this._assertDeletable(item, id);
    actor = actor || this.config.owner;
    const now = new Date();
    const warnings = await this.deleteWarnings(id);
    await this._snapshot(item, 'delete', actor, now);
    await this._pool.query('DELETE FROM aliases WHERE target_id = $1', [id]);
    await this._pool.query('DELETE FROM items WHERE id = $1', [id]);
    return { warnings };
  }

  // ─── Aliases ─────────────────────────────────────────────────────────────────

  async resolveAlias(alias) {
    const { rows } = await this._pool.query(
      'SELECT target_id FROM aliases WHERE alias = $1', [alias.toLowerCase()],
    );
    return rows[0]?.target_id ?? null;
  }

  async resolve(idOrAlias) {
    if (UUID_RE.test(idOrAlias)) return this.get(idOrAlias);
    const id = await this.resolveAlias(idOrAlias);
    return id ? this.get(id) : null;
  }

  async setAlias(alias, id) {
    await this._pool.query(
      'INSERT INTO aliases (alias, target_id) VALUES ($1,$2) ON CONFLICT (alias) DO UPDATE SET target_id = $2',
      [alias.toLowerCase(), id],
    );
  }

  async removeAlias(alias) {
    await this._pool.query('DELETE FROM aliases WHERE alias = $1', [alias.toLowerCase()]);
  }

  async listAliases() {
    const { rows } = await this._pool.query('SELECT alias, target_id FROM aliases ORDER BY alias');
    return rows.map(r => ({ alias: r.alias, targetId: r.target_id }));
  }

  // ─── Annotations ─────────────────────────────────────────────────────────────

  async annotate(targetId, { author, content, parentAnnotationId = null } = {}) {
    const id  = crypto.randomUUID();
    const now = new Date();
    await this._pool.query(
      `INSERT INTO annotations (id, target_id, author, content, created_at, parent_annotation_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, targetId, author || this.config.owner, content, now, parentAnnotationId],
    );
    return { id, targetId, author: author || this.config.owner, content, createdAt: now.toISOString(), parentAnnotationId };
  }

  async annotations(targetId) {
    const { rows } = await this._pool.query(
      `SELECT * FROM annotations WHERE target_id = $1 ORDER BY created_at, id`,
      [targetId],
    );
    return rows.map(r => ({
      id:                  r.id,
      targetId:            r.target_id,
      author:              r.author,
      content:             r.content,
      createdAt:           r.created_at?.toISOString(),
      parentAnnotationId:  r.parent_annotation_id,
    }));
  }

  // ─── Relationships ────────────────────────────────────────────────────────────

  async relate(sourceId, type, targetId, { createdBy, note = null } = {}) {
    if (!VALID_REL_TYPES.includes(type))
      throw new Error(`Invalid relationship type: ${type}. Valid: ${VALID_REL_TYPES.join(', ')}`);
    const id    = crypto.randomUUID();
    const now   = new Date();
    const actor = createdBy || this.config.owner;
    await this._pool.query(
      `INSERT INTO relationships (id, source_id, target_id, type, created_at, created_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, sourceId, targetId, type, now, actor, note],
    );
    return { id, sourceId, targetId, type, createdAt: now.toISOString(), createdBy: actor, note };
  }

  async relationships(id) {
    const { rows: out } = await this._pool.query(
      `SELECT * FROM relationships WHERE source_id = $1 ORDER BY created_at`, [id],
    );
    const { rows: inn } = await this._pool.query(
      `SELECT * FROM relationships WHERE target_id = $1 ORDER BY created_at`, [id],
    );
    const fmt = (r, flip) => ({
      id: r.id,
      [flip ? 'sourceId' : 'targetId']: flip ? r.source_id : r.target_id,
      type: r.type, createdAt: r.created_at?.toISOString(), createdBy: r.created_by, note: r.note,
    });
    return {
      outbound: out.map(r => fmt(r, false)),
      inbound:  inn.map(r => fmt(r, true)),
    };
  }

  async backlinks(id) {
    const { rows } = await this._pool.query(
      'SELECT source_id FROM links WHERE target_id = $1', [id],
    );
    return rows.map(r => r.source_id);
  }

  async listRelationships() {
    const { rows } = await this._pool.query('SELECT * FROM relationships ORDER BY created_at');
    return rows.map(r => ({
      id: r.id, sourceId: r.source_id, targetId: r.target_id,
      type: r.type, createdAt: r.created_at?.toISOString(), createdBy: r.created_by, note: r.note,
    }));
  }

  // ─── History ─────────────────────────────────────────────────────────────────

  async history(id) {
    const { rows } = await this._pool.query(
      `SELECT * FROM history WHERE item_id = $1 ORDER BY snapshot_at`, [id],
    );
    return rows.map(r => ({
      ...r.snapshot,
      snapshotAt: r.snapshot_at?.toISOString(),
      changedBy:  r.changed_by,
      changeType: r.change_type,
    }));
  }

  // ─── Queries ──────────────────────────────────────────────────────────────────

  async byTag(tag) {
    const { rows } = await this._pool.query(
      'SELECT id FROM items WHERE $1 = ANY(tags)', [tag],
    );
    return rows.map(r => r.id);
  }

  async byType(typeId) {
    const { rows } = await this._pool.query(
      'SELECT id FROM items WHERE type_id = $1', [typeId],
    );
    return rows.map(r => r.id);
  }

  // Full-text search over every field of every item (own fields and, for
  // object-type items, their obj_<typeId> row) — backed by the search_index
  // table, which triggers keep in sync automatically as fields change.
  async search(query, { rootId = null, limit = 10 } = {}) {
    const { rows } = await this._pool.query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM items WHERE id = $2
         UNION ALL
         SELECT i.id FROM items i JOIN subtree s ON i.parent_id = s.id AND i.id != i.parent_id
       )
       SELECT i.*, ts_rank(si.tsv, plainto_tsquery('english', $1)) AS rank
       FROM items i
       JOIN search_index si ON si.item_id = i.id
       WHERE si.tsv @@ plainto_tsquery('english', $1)
         AND ($2::uuid IS NULL OR i.id IN (SELECT id FROM subtree))
       ORDER BY rank DESC
       LIMIT $3`,
      [query, rootId, limit],
    );
    return rows.map(rowToItem);
  }

  // ─── Semantic / hybrid search (pgvector) ─────────────────────────────────────
  //
  // The workspace's `cloud.embeddings` config selects *which provider to use for embedding*
  // — separate from `embeddings.enabled`, which controls whether search
  // actually queries vectors yet. The split matters because turning on a
  // provider doesn't retroactively populate item_embeddings: the write
  // triggers only queue items going forward, and a background worker
  // (processPendingEmbeddings) has to drain that queue — and the
  // from-cold-start backfill it queues in _ensureEmbeddingTable — before
  // semantic results would actually mean anything. So `enabled` defaults to
  // `true` (configure-and-go is the common case), but can be set `false` to
  // keep generating embeddings in the background without using them in search
  // yet — flip it on once `processPendingEmbeddings` reports an empty queue.

  get embeddingsEnabled() {
    return !!this._embeddingProvider && this._embeddingsEnabled;
  }

  // Generating embeddings (embedItem / processPendingEmbeddings) only needs a
  // provider — it's deliberately independent of `enabled`, so a background
  // worker can finish backfilling while search keeps using FTS only.
  _requireEmbeddingProvider() {
    if (!this._embeddingProvider) {
      throw new Error(
        'Semantic search requires an embedding provider — set `cloud.embeddings` in the workspace config ' +
        "(e.g. { provider: 'voyage', apiKey: '...', model: 'voyage-3-lite', dimensions: 1024 })",
      );
    }
    return this._embeddingProvider;
  }

  // Querying embeddings additionally needs `enabled` — see embeddingsEnabled
  // getter's comment for why these are split.
  _requireEmbeddingsEnabled() {
    const provider = this._requireEmbeddingProvider();
    if (!this._embeddingsEnabled) {
      throw new Error(
        "Semantic search is disabled (`cloud.embeddings.enabled: false` in the workspace config) — " +
        'typically because the backfill is still running; set it to `true` once ' +
        'processPendingEmbeddings reports an empty queue.',
      );
    }
    return provider;
  }

  // Vector nearest-neighbour search, ranked by cosine distance, optionally
  // scoped to a subtree. Mirrors search()'s shape and options.
  async semanticSearch(query, { rootId = null, limit = 10 } = {}) {
    const provider = this._requireEmbeddingsEnabled();
    const [queryEmbedding] = await provider.embed([query]);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    const { rows } = await this._pool.query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM items WHERE id = $3
         UNION ALL
         SELECT i.id FROM items i JOIN subtree s ON i.parent_id = s.id AND i.id != i.parent_id
       )
       SELECT i.*, (e.embedding OPERATOR(public.<=>) $1::public.vector) AS distance
       FROM items i
       JOIN item_embeddings e ON e.item_id = i.id AND e.model = $2
       WHERE ($3::uuid IS NULL OR i.id IN (SELECT id FROM subtree))
       ORDER BY distance ASC
       LIMIT $4`,
      [vectorLiteral, provider.model, rootId, limit],
    );
    return rows.map(rowToItem);
  }

  // Combines FTS and vector search results with Reciprocal Rank Fusion — BM25
  // catches exact terminology (acronyms, system names), vector catches
  // conceptual similarity; RRF merges the two rankings without needing the
  // (incomparable) raw scores to be normalised against each other.
  //
  // Degrades to FTS-only when semantic search isn't available yet (no
  // provider configured, or `enabled: false` during backfill) — "hybrid" is
  // the recommended default mode, so callers shouldn't need to know or care
  // which signals are currently live; they just get the best available.
  async hybridSearch(query, { rootId = null, limit = 10 } = {}) {
    if (!this.embeddingsEnabled) return this.search(query, { rootId, limit });

    const fanOut = Math.max(limit * 2, 20);
    const [ftsResults, vectorResults] = await Promise.all([
      this.search(query, { rootId, limit: fanOut }),
      this.semanticSearch(query, { rootId, limit: fanOut }),
    ]);
    return reciprocalRankFusion([ftsResults, vectorResults]).slice(0, limit);
  }

  // Creates the item_embeddings table sized for the configured provider's
  // vector width (which is only known at runtime — see migration 014's
  // header comment for why this can't be a static migration), and queues a
  // backfill of any item this model hasn't embedded yet. Safe to call
  // repeatedly — CREATE TABLE/INDEX IF NOT EXISTS, and the backfill only
  // queues items missing *this model's* embedding.
  async _ensureEmbeddingTable() {
    const provider = this._embeddingProvider;
    const dimensions = Number(provider.dimensions);
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error(`Invalid embedding dimensions for provider '${provider.name}': ${provider.dimensions}`);
    }

    // pgvector's types/operator classes live in the schema it was installed
    // into (`public`, per migration 014's CREATE EXTENSION) — schema-qualified
    // here so this works regardless of the adapter's search_path (the test
    // suite, for one, scopes search_path to a throwaway per-run schema).
    await this._pool.query(`
      CREATE TABLE IF NOT EXISTS item_embeddings (
        item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        model        TEXT NOT NULL,
        embedding    public.VECTOR(${dimensions}) NOT NULL,
        content_hash TEXT NOT NULL,
        embedded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (item_id, model)
      )
    `);
    await this._pool.query(`
      CREATE INDEX IF NOT EXISTS idx_item_embeddings_hnsw
        ON item_embeddings USING hnsw (embedding public.vector_cosine_ops)
    `);

    await this._pool.query(
      `INSERT INTO pending_embeddings (item_id)
       SELECT i.id FROM items i
       WHERE NOT EXISTS (
         SELECT 1 FROM item_embeddings e WHERE e.item_id = i.id AND e.model = $1
       )
       ON CONFLICT (item_id) DO NOTHING`,
      [provider.model],
    );
  }

  // Builds the text an item is embedded from: its own value plus, for
  // object-type items, their object data serialised as "field: value" lines —
  // gives the embedding model field names as context rather than a bare blob.
  async _embeddingContent(item) {
    const parts = [];
    if (item.value) parts.push(String(item.value));
    if (item.type === 'object' && item.typeId) {
      const data = await this.readObjectJson(item.id, item.typeId);
      if (data) {
        for (const [field, value] of Object.entries(data)) {
          if (value != null && value !== '') parts.push(`${field}: ${value}`);
        }
      }
    }
    return parts.join('\n');
  }

  // Embeds a single item and upserts its vector, skipping the (paid, slow)
  // provider call when the content hasn't changed since it was last embedded.
  // Returns true if an embedding was generated, false if skipped.
  async embedItem(id) {
    const provider = this._requireEmbeddingProvider();
    const item = await this.get(id);
    if (!item) return false;

    const content = await this._embeddingContent(item);
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const { rows } = await this._pool.query(
      'SELECT content_hash FROM item_embeddings WHERE item_id = $1 AND model = $2',
      [id, provider.model],
    );
    if (rows[0]?.content_hash === contentHash) return false;

    const [embedding] = await provider.embed([content]);
    const vectorLiteral = `[${embedding.join(',')}]`;
    await this._pool.query(
      `INSERT INTO item_embeddings (item_id, model, embedding, content_hash, embedded_at)
       VALUES ($1, $2, $3::public.vector, $4, now())
       ON CONFLICT (item_id, model) DO UPDATE
         SET embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash, embedded_at = now()`,
      [id, provider.model, vectorLiteral, contentHash],
    );
    return true;
  }

  // Drains the embedding queue — the background-worker entry point. Call this
  // periodically (cron, a long-lived loop, whatever fits the deployment) to
  // keep embeddings in sync with item writes without blocking them. Items
  // whose content turned out unchanged are dequeued without an API call.
  async processPendingEmbeddings({ limit = 50 } = {}) {
    this._requireEmbeddingProvider();
    const { rows } = await this._pool.query(
      'SELECT item_id FROM pending_embeddings ORDER BY queued_at LIMIT $1', [limit],
    );

    let embedded = 0;
    let skipped = 0;
    let failed = 0;
    for (const { item_id } of rows) {
      try {
        if (await this.embedItem(item_id)) embedded++; else skipped++;
        await this._pool.query('DELETE FROM pending_embeddings WHERE item_id = $1', [item_id]);
      } catch (e) {
        // Leave it queued — a transient provider/network failure shouldn't
        // drop the item; the next run retries it.
        failed++;
        console.warn(`processPendingEmbeddings: failed to embed ${item_id}:`, e.message);
      }
    }
    return { processed: rows.length, embedded, skipped, failed };
  }

  async loadAll() {
    const { rows } = await this._pool.query('SELECT * FROM items ORDER BY sort_order');
    return rows.map(rowToItem);
  }

  async children(parentId, aspect = null) {
    const { rows } = await this._pool.query(
      `SELECT * FROM items
       WHERE parent_id = $1 AND id != $1 AND (aspect IS NOT DISTINCT FROM $2)
       ORDER BY sort_order`,
      [parentId, aspect],
    );
    return rows.map(rowToItem);
  }

  async tree(rootId, maxDepth = Infinity) {
    if (!rootId) {
      const dr = await this.getDataRoot();
      rootId = dr?.id ?? null;
      if (!rootId) return [];
    }

    // Use a recursive CTE to fetch the subtree
    const depthLimit = Number.isFinite(maxDepth) ? maxDepth : 100;
    const { rows } = await this._pool.query(
      `WITH RECURSIVE subtree AS (
         SELECT *, 0 AS depth FROM items WHERE id = $1
         UNION ALL
         SELECT i.*, s.depth + 1
         FROM items i
         JOIN subtree s ON i.parent_id = s.id AND i.id != i.parent_id
         WHERE s.depth < $2
       )
       SELECT * FROM subtree ORDER BY depth, sort_order`,
      [rootId, depthLimit],
    );
    return rows.map(r => ({ item: rowToItem(r), depth: r.depth }));
  }

  // Resolve a type *name* used in a query. Mirrors the filesystem adapter:
  //   { primitive: true } | { id } | { unknown: true }
  async resolveTypeId(name) {
    if (!name) return { unknown: true };
    if (PRIMITIVE_TYPES.has(name)) return { primitive: true };
    const { rows } = await this._pool.query(
      `SELECT id FROM items WHERE value = $1 AND type = 'type' LIMIT 1`, [name],
    );
    if (rows.length) return { id: rows[0].id };
    return { unknown: true };
  }

  async query({ type, where, rootId, sort, limit, strictTypes } = {}) {
    const conditions = [];
    const params     = [];
    let   p          = 1;
    let   typeWarning = null;

    if (type) {
      // Distinguish "no such type" from "type exists but empty" (see fs adapter).
      const resolved = await this.resolveTypeId(type);
      if (resolved.unknown) {
        if (strictTypes) throw new UnknownTypeError(type);
        typeWarning = `unknown type "${type}" — not a registered type definition; run \`kanecta doctor\``;
      }
    }

    if (rootId) {
      conditions.push(
        `id IN (
          WITH RECURSIVE sub AS (
            SELECT id FROM items WHERE id = $${p}
            UNION ALL
            SELECT i.id FROM items i JOIN sub s ON i.parent_id = s.id AND i.id != i.parent_id
          ) SELECT id FROM sub
        )`,
      );
      params.push(rootId); p++;
    }

    if (type) {
      conditions.push(`(type = $${p} OR (type = 'object' AND type_id IN (SELECT id FROM items WHERE value = $${p} AND type = 'type')))`);
      params.push(type); p++;
    }

    const sql = `SELECT * FROM items${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''}`;
    const { rows } = await this._pool.query(sql, params);
    let items = rows.map(rowToItem);

    // where clause filtering (object fields — done in JS since fields are in obj_* tables)
    if (where && Object.keys(where).length) {
      const withData = await Promise.all(items.map(async item => {
        if (item.type !== 'object' || !item.typeId) return { ...item, objectData: null };
        const objectData = await this.readObjectJson(item.id, item.typeId);
        return { ...item, objectData };
      }));
      items = withData.filter(item => {
        if (!item.objectData) return false;
        for (const [field, predicate] of Object.entries(where)) {
          const fv = item.objectData[field];
          const op = predicate?.op ?? '=';
          const ev = predicate?.value ?? predicate;
          if (op === '='    && fv !== ev) return false;
          if (op === '!='   && fv === ev) return false;
          if (op === 'in'   && !ev?.includes(fv)) return false;
          if (op === 'contains' && !String(fv ?? '').toLowerCase().includes(String(ev).toLowerCase())) return false;
          if (op === '>'    && !(fv > ev)) return false;
          if (op === '<'    && !(fv < ev)) return false;
        }
        return true;
      });
    }

    if (sort?.field) {
      const { field, dir = 'asc' } = sort;
      const desc = dir.toLowerCase() === 'desc';
      items.sort((a, b) => {
        const va = a[field] ?? a.objectData?.[field] ?? null;
        const vb = b[field] ?? b.objectData?.[field] ?? null;
        if (va === null) return desc ? -1 : 1;
        if (vb === null) return desc ? 1 : -1;
        return va < vb ? (desc ? 1 : -1) : va > vb ? (desc ? -1 : 1) : 0;
      });
    }

    const finalLimit = (limit > 0) ? limit : (limit === undefined ? 50 : 0);
    const result = finalLimit > 0 ? items.slice(0, finalLimit) : items;

    // Warn-by-default channel (non-enumerable; return value unchanged for
    // existing callers — the MCP layer reads `result.warning`).
    if (typeWarning) {
      Object.defineProperty(result, 'warning', { value: typeWarning, enumerable: false, configurable: true });
    }

    return result;
  }

  // ─── Object data (obj_* tables) ───────────────────────────────────────────────

  async readObjectJson(id, typeId) {
    if (!typeId) {
      const item = await this.get(id);
      typeId = item?.typeId;
    }
    if (!typeId) return null;
    const table = objTableName(typeId);
    try {
      const { rows } = await this._pool.query(
        `SELECT * FROM "${table}" WHERE item_id = $1`, [id],
      );
      if (!rows[0]) return null;
      const { item_id, ...rest } = rows[0]; // eslint-disable-line no-unused-vars
      // Convert snake_case → camelCase
      return Object.fromEntries(
        Object.entries(rest).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]),
      );
    } catch { return null; }
  }

  async writeObjectJson(id, typeId, data) {
    if (!typeId) return;
    const table   = objTableName(typeId);
    const camelToSnake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    const entries = Object.entries(data).map(([k, v]) => [camelToSnake(k), v]);
    const cols    = entries.map(([k]) => `"${k}"`).join(', ');
    const vals    = entries.map(([, v]) => v);
    const sets    = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(', ');
    const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
    try {
      await this._pool.query(
        `INSERT INTO "${table}" (item_id, ${cols}) VALUES ($1, ${placeholders})
         ON CONFLICT (item_id) DO UPDATE SET ${sets}`,
        [id, ...vals],
      );
    } catch (e) {
      // Table may not exist for user-defined types not yet migrated
      console.warn(`writeObjectJson: table ${table} not found for type ${typeId}:`, e.message);
    }
  }

  // ─── Function data (functions + child tables) ────────────────────────────────

  async readFunctionJson(id) {
    const { rows } = await this._pool.query('SELECT * FROM functions WHERE item_id = $1', [id]);
    const fn = rows[0];
    if (!fn) return null;

    const [{ rows: typeParamRows }, { rows: paramRows }, { rows: throwRows }] = await Promise.all([
      this._pool.query(
        `SELECT name, constraint_expr, default_type FROM function_type_parameters
         WHERE function_id = $1 ORDER BY sort_order`, [id],
      ),
      this._pool.query(
        `SELECT name, type, type_id, optional, rest, default_value, description FROM function_parameters
         WHERE function_id = $1 ORDER BY sort_order`, [id],
      ),
      this._pool.query(
        `SELECT type, description FROM function_throws
         WHERE function_id = $1 ORDER BY sort_order`, [id],
      ),
    ]);

    const result = {};
    if (fn.description != null)    result.description = fn.description;
    if (fn.is_async)               result.async = true;
    if (fn.is_ai)                  result.ai = true;
    if (fn.skill_id)               result.skill = fn.skill_id;
    if (typeParamRows.length) {
      result.typeParameters = typeParamRows.map(r => {
        const tp = { name: r.name };
        if (r.constraint_expr != null) tp.constraint = r.constraint_expr;
        if (r.default_type != null)    tp.default = r.default_type;
        return tp;
      });
    }
    result.parameters = paramRows.map(r => {
      const p = { name: r.name };
      if (r.type != null)          p.type = r.type;
      if (r.type_id != null)       p.typeId = r.type_id;
      if (r.optional)              p.optional = true;
      if (r.rest)                  p.rest = true;
      if (r.default_value != null) p.defaultValue = r.default_value;
      if (r.description != null)   p.description = r.description;
      return p;
    });
    if (fn.return_type != null)    result.returnType = fn.return_type;
    if (fn.return_type_id != null) result.returnTypeId = fn.return_type_id;
    if (throwRows.length) {
      result.throws = throwRows.map(r => ({
        type: r.type,
        ...(r.description != null ? { description: r.description } : {}),
      }));
    }
    if (fn.deprecated_notice != null) result.deprecated = fn.deprecated_notice;
    if (fn.body != null)              result.body = fn.body;
    if (!fn.include_kanecta_sdk)      result.includeKanectaSdk = false;
    if (fn.dependencies?.length)      result.dependencies = fn.dependencies;
    return result;
  }

  async writeFunctionJson(id, data) {
    const {
      description = null,
      async: isAsync = false,
      ai = false,
      skill = null,
      typeParameters = [],
      parameters = [],
      returnType = null,
      returnTypeId = null,
      throws = [],
      deprecated = null,
      body = null,
      includeKanectaSdk = true,
      dependencies = [],
    } = data;

    await this._pool.query(
      `INSERT INTO functions (
         item_id, description, is_async, is_ai, skill_id, return_type, return_type_id,
         deprecated_notice, body, include_kanecta_sdk, dependencies
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (item_id) DO UPDATE SET
         description = $2, is_async = $3, is_ai = $4, skill_id = $5,
         return_type = $6, return_type_id = $7, deprecated_notice = $8,
         body = $9, include_kanecta_sdk = $10, dependencies = $11`,
      [id, description, isAsync, ai, skill, returnType, returnTypeId, deprecated, body, includeKanectaSdk, dependencies],
    );

    await Promise.all([
      this._pool.query('DELETE FROM function_type_parameters WHERE function_id = $1', [id]),
      this._pool.query('DELETE FROM function_parameters WHERE function_id = $1', [id]),
      this._pool.query('DELETE FROM function_throws WHERE function_id = $1', [id]),
    ]);

    for (const [i, tp] of typeParameters.entries()) {
      await this._pool.query(
        `INSERT INTO function_type_parameters (id, function_id, sort_order, name, constraint_expr, default_type)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [crypto.randomUUID(), id, i, tp.name, tp.constraint ?? null, tp.default ?? null],
      );
    }
    for (const [i, p] of parameters.entries()) {
      await this._pool.query(
        `INSERT INTO function_parameters (id, function_id, sort_order, name, type, type_id, optional, rest, default_value, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [crypto.randomUUID(), id, i, p.name, p.type ?? null, p.typeId ?? null, p.optional ?? false, p.rest ?? false, p.defaultValue ?? null, p.description ?? null],
      );
    }
    for (const [i, t] of throws.entries()) {
      await this._pool.query(
        `INSERT INTO function_throws (id, function_id, sort_order, type, description)
         VALUES ($1,$2,$3,$4,$5)`,
        [crypto.randomUUID(), id, i, t.type, t.description ?? null],
      );
    }
  }

  // ─── Type definitions ─────────────────────────────────────────────────────────

  async createType(value, { schema, createdBy, id: explicitId } = {}) {
    const id    = explicitId || crypto.randomUUID();
    const now   = new Date();
    const owner = this.config.owner;
    const actor = createdBy || owner;

    await this._pool.query(
      `INSERT INTO items (id, parent_id, value, type, owner, license, sort_order,
         created_at, modified_at, created_by, modified_by)
       VALUES ($1, $1, $2, 'type', $3, $4, 0, $5, $5, $3, $3)
       ON CONFLICT (id) DO NOTHING`,
      [id, value.trim(), owner, DEFAULT_LICENSE, now],
    );

    const resolvedSchema = schema || {
      meta: { icon: '', description: '', details: '', keywords: '', tags: '', skills: { claude: '' } },
      jsonSchema: {
        '$schema': 'http://json-schema.org/draft-07/schema#',
        '$id': '',
        title: value.trim(),
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    };

    // The `types` table mirrors type.json's `meta` as flattened meta_* columns
    // (see migrations/002_status_types_and_functions.sql) rather than storing
    // it as a JSONB blob — and has no column for sqlSchema at all: in Postgres
    // mode the obj_<typeId> table itself (named via table_name) is the
    // canonical record of a type's storage shape, immutable once created.
    const meta = resolvedSchema.meta ?? {};
    const tableName = resolvedSchema.sqlSchema?.length ? objTableName(id) : null;

    await this._pool.query(
      `INSERT INTO types (
         item_id, table_name,
         meta_icon, meta_description, meta_details, meta_keywords, meta_tags,
         meta_primary_field, meta_ai_instructions_claude,
         meta_functions_consumed_by, meta_functions_produced_by,
         json_schema, sql_schema, sync, superseded_by, implements, extends
       ) VALUES (
         $1, $2,
         $3, $4, $5, $6, $7,
         $8, $9,
         $10, $11,
         $12, $13, $14, $15, $16, $17
       )
       ON CONFLICT (item_id) DO UPDATE SET
         table_name = $2,
         meta_icon = $3, meta_description = $4, meta_details = $5, meta_keywords = $6, meta_tags = $7,
         meta_primary_field = $8, meta_ai_instructions_claude = $9,
         meta_functions_consumed_by = $10, meta_functions_produced_by = $11,
         json_schema = $12, sql_schema = $13, sync = $14, superseded_by = $15, implements = $16, extends = $17`,
      [
        id, tableName,
        meta.icon ?? null, meta.description ?? '', meta.details ?? null, meta.keywords ?? null, meta.tags ?? null,
        meta.primaryField ?? null, meta.skills?.claude ?? null,
        meta.functions?.consumedBy ?? [], meta.functions?.producedBy ?? [],
        JSON.stringify(resolvedSchema.jsonSchema), resolvedSchema.sqlSchema ?? [],
        meta.sync ?? [], meta.supersededBy ?? [], meta.implements ?? [], meta.extends ?? [],
      ],
    );

    // Run the type's own sqlSchema DDL to create its obj_<typeId> table —
    // without this, writeObjectJson has nowhere to persist object data and
    // silently no-ops (catches and logs a warning instead of failing loudly).
    if (resolvedSchema.sqlSchema?.length) {
      for (const ddl of resolvedSchema.sqlSchema) {
        const createIfNotExists = ddl.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
        await this._pool.query(createIfNotExists);
      }
      await this._attachObjectSearchTrigger(objTableName(id));
    }

    const metadata = await this.get(id);
    return { metadata, schema: resolvedSchema };
  }

  async readTypeJson(id) {
    const { rows } = await this._pool.query('SELECT * FROM types WHERE item_id = $1', [id]);
    const t = rows[0];
    if (!t) return null;

    const meta = {
      icon: t.meta_icon ?? '',
      description: t.meta_description ?? '',
      details: t.meta_details ?? '',
      keywords: t.meta_keywords ?? '',
      tags: t.meta_tags ?? '',
      primaryField: t.meta_primary_field ?? '',
      skills: { claude: t.meta_ai_instructions_claude ?? '' },
      functions: { consumedBy: t.meta_functions_consumed_by ?? [], producedBy: t.meta_functions_produced_by ?? [] },
      sync: t.sync ?? [],
      supersededBy: t.superseded_by ?? [],
      implements: t.implements ?? [],
      extends: t.extends ?? [],
    };

    return { meta, jsonSchema: t.json_schema, sqlSchema: t.sql_schema ?? [] };
  }

  async writeTypeJson(id, data) {
    const meta = data.meta ?? {};
    await this._pool.query(
      `UPDATE types SET
         meta_icon = $2, meta_description = $3, meta_details = $4, meta_keywords = $5, meta_tags = $6,
         meta_primary_field = $7, meta_ai_instructions_claude = $8,
         meta_functions_consumed_by = $9, meta_functions_produced_by = $10,
         json_schema = $11, sync = $12, superseded_by = $13, implements = $14, extends = $15
       WHERE item_id = $1`,
      [
        id,
        meta.icon ?? null, meta.description ?? '', meta.details ?? null, meta.keywords ?? null, meta.tags ?? null,
        meta.primaryField ?? null, meta.skills?.claude ?? null,
        meta.functions?.consumedBy ?? [], meta.functions?.producedBy ?? [],
        JSON.stringify(data.jsonSchema), meta.sync ?? [], meta.supersededBy ?? [], meta.implements ?? [], meta.extends ?? [],
      ],
    );
  }

  // Attaches the generic FTS trigger (see migrations/013_search_index.sql) to
  // a freshly created obj_* table — mirrors what the startup migration does
  // for tables that already existed, so newly created types stay covered too.
  async _attachObjectSearchTrigger(tableName) {
    await this._pool.query(`DROP TRIGGER IF EXISTS trg_object_search_vector ON "${tableName}"`);
    await this._pool.query(
      `CREATE TRIGGER trg_object_search_vector
         AFTER INSERT OR UPDATE OR DELETE ON "${tableName}"
         FOR EACH ROW EXECUTE FUNCTION kanecta_update_object_search_vector()`,
    );
  }

  // ─── Index maintenance ────────────────────────────────────────────────────────

  async rebuildIndexes() {
    // Postgres maintains all indexes natively; links are in the links table.
    // Rebuild just the links table from current item values.
    await this._pool.query('DELETE FROM links');
    const { rows } = await this._pool.query(`SELECT id, value FROM items WHERE value IS NOT NULL`);
    for (const row of rows) {
      for (const link of parseLinks(row.value)) {
        await this._pool.query(
          'INSERT INTO links (source_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [row.id, link],
        );
      }
    }
    const { rows: [{ count }] } = await this._pool.query('SELECT COUNT(*) FROM items');
    return parseInt(count);
  }
}

module.exports = { PostgresAdapter, UnknownTypeError, PRIMITIVE_TYPES, ROOT_ID, WELL_KNOWN_TYPES, VALID_REL_TYPES, UUID_RE };
