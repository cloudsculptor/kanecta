'use strict';

// PostgresAdapter — implements the Kanecta adapter interface against PostgreSQL.
// API is identical to FilesystemAdapter (same method names, same return shapes)
// but every method is async. Callers must await all calls.
//
// Usage:
//   const adapter = await PostgresAdapter.init(pool, owner);   // fresh DB
//   const adapter = await PostgresAdapter.open(pool);           // existing DB

const crypto = require('crypto');

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
  constructor(pool) {
    this._pool   = pool;
    this._config = null;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  static async init(pool, owner) {
    const adapter = new PostgresAdapter(pool);
    await adapter._migrate();
    await adapter._ensureConfig(owner);
    await adapter._initRoots();
    return adapter;
  }

  static async open(pool) {
    const adapter = new PostgresAdapter(pool);
    const cfg = await adapter._loadConfig();
    if (!cfg) throw new Error('Not a Kanecta database: config missing or empty');
    adapter._config = cfg;
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

  async query({ type, where, rootId, sort, limit } = {}) {
    const conditions = [];
    const params     = [];
    let   p          = 1;

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
    return finalLimit > 0 ? items.slice(0, finalLimit) : items;
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

    await this._pool.query(
      `INSERT INTO types (item_id, json_schema, sql_schema, meta)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (item_id) DO UPDATE SET json_schema=$2, sql_schema=$3, meta=$4`,
      [
        id,
        JSON.stringify(resolvedSchema.jsonSchema),
        JSON.stringify(resolvedSchema.sqlSchema ?? []),
        JSON.stringify(resolvedSchema.meta ?? {}),
      ],
    );

    const metadata = await this.get(id);
    return { metadata, schema: resolvedSchema };
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

module.exports = { PostgresAdapter, ROOT_ID, WELL_KNOWN_TYPES, VALID_REL_TYPES, UUID_RE };
