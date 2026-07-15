// PostgresAdapter — implements the Kanecta adapter interface against PostgreSQL.
// API is identical to FilesystemAdapter (same method names, same return shapes)
// but every method is async. Callers must await all calls.
//
// Usage:
//   const adapter = await PostgresAdapter.init(pool, owner);   // fresh DB
//   const adapter = await PostgresAdapter.open(pool);           // existing DB

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  version as specVersion,
  primitiveTypes,
  structuredTypes,
  builtInTypeItems,
  builtInSystemItems,
  builtInRelationshipTypeItems,
  typeSeedMetaschema,
  relationshipTypeSeedMetaschema,
} from '@kanecta/specification';
import { validateItem } from '@kanecta/specification/validator';
import { deriveSqlSchema, deriveIndexDdl } from '@kanecta/schema-compiler';
import { Pool } from 'pg';
import type { PoolClient, QueryResult } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import { createEmbeddingProvider, reciprocalRankFusion } from './embeddings.ts';

const ROOT_ID         = '00000000-0000-0000-0000-000000000000';
const DEFAULT_LICENSE = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739';
// The root TYPE item (distinct from the root ITEM 0000…). root is both a
// well-known lifecycle anchor and a projected structured type: its payload is the
// datastore config record (spec §rootPayload), projected to obj_<root-type>.
const ROOT_TYPE_ID    = '73068dfc-e56b-4c4b-a8e6-f623f9ad9ab9';
// The `type` meta-type's own type-item UUID (from type.json). The type registry
// lives in obj_<type-type> — there is no bespoke `types` table (spec
// §cqrs-projections / four-table law). obj_<type-type>'s columns can't be derived
// from type.json's own (nested) payload — that's circular — so the adapter builds
// it from the flat seed metaschema (rootPayload.seedMetaschema / typeSeedMetaschema).
const TYPE_TYPE_ID    = 'abbd7b52-92aa-4fca-b458-d9c4e1a60061';
// The `relationship` type item's UUID — every relationship item projects to
// obj_<relationship> (spec §relationshipPayload; no bespoke `relationships` table).
const RELATIONSHIP_TYPE_ID = '334ea5f6-6bfa-43e5-b77f-5d811642d897';
// The `relationship-type` meta-type's own type-item UUID. relationship-type items
// (the relationship vocabulary) live in obj_<relationship-type> — no bespoke
// `rel_types` table. Like `type`, it EXTENDS the nested type payload so it can't
// derive its own columns; obj_<relationship-type> is built from the flat seed
// metaschema (relationshipTypeSeedMetaschema) — see _ensureProjection.
const RELATIONSHIP_TYPE_TYPE_ID = '15861dd7-e54c-4209-bceb-bdd65de4f472';
const WELL_KNOWN_TYPES = new Set(['root']);
const WELL_KNOWN_ORDER: string[] = [];

// Meta-types whose obj_<typeId> columns can't be derived from their own (nested,
// self-referential) payload schema, so the adapter builds them from a flat seed
// metaschema instead. `type` extends nothing but describes types; `relationship-type`
// extends the type payload — both are circular. See _ensureProjection.
const SEED_METASCHEMA_BY_TYPE_ID: Record<string, any> = {
  [TYPE_TYPE_ID]: typeSeedMetaschema,
  [RELATIONSHIP_TYPE_TYPE_ID]: relationshipTypeSeedMetaschema,
};
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_RE  = /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi;

// Built-in rel types seeded in migration 018 — also the fallback before the
// rel_types table exists (migration safety).
const BUILT_IN_REL_TYPES = [
  'relates-to', 'depends-on', 'enables', 'contradicts',
  'blocks', 'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes',
];

// All built-in type names (primitive + structured + well-known). Used by
// resolveTypeId() to distinguish items that don't need a registered type
// definition from custom user-defined types.
const BUILT_IN_TYPES = new Set([
  // Primitive value types
  'string', 'number', 'text', 'heading', 'url', 'image', 'markdown',
  // Structured built-in types
  'object', 'file', 'function', 'function-throw', 'runner', 'symlink',
  'action', 'activity', 'agent', 'alias', 'annotation', 'aspect-type',
  'cell', 'channel', 'component', 'connector', 'context', 'eval', 'eval-run',
  'claude-api-config', 'claude-code-config', 'python-config',
  'kanecta-function-config', 'group-chat-config', 'http-config',
  'document', 'document-expand-exception', 'document-role-by-depth', 'document-role-by-type',
  'formula', 'grant', 'grid', 'item_history', 'licence', 'pipeline', 'pipeline-run',
  'parameter', 'property', 'query', 'query-param', 'reference', 'relationship', 'relationship-type',
  'subscription', 'type-parameter', 'tree', 'node', 'view', 'type',
  // Well-known root types
  'root',
]);

// Keep the old export name for backward compatibility.
const PRIMITIVE_TYPES = BUILT_IN_TYPES;
const VALID_REL_TYPES = BUILT_IN_REL_TYPES;

// ─── Built-in type projection (spec §cqrs-projections: the four-table law) ─────
// The spec splits built-ins into scalar PRIMITIVES (carried on the item row) and
// STRUCTURED types (an ordinary type with typed columns, projected to
// obj_<typeId> exactly like a user 'object' type). Sourced from
// @kanecta/specification so both adapters agree on the classification.
const PRIMITIVE_TYPE_SET       = new Set<string>(primitiveTypes as string[]);
const STRUCTURED_BUILT_IN_TYPES = new Set<string>(structuredTypes as string[]);

// The synthetic types-container node every built-in type item is parented under
// (spec / core manifest). Mirrors sqlite-fs's TYPES_NODE.
const TYPES_CONTAINER_ID = '11111111-1111-1111-1111-111111111111';

// name → fixed type-item UUID for every seeded built-in type, from the core
// manifest items. Lets create()/update() resolve a structured built-in
// instance's typeId so it projects to obj_<typeId>.
const BUILT_IN_TYPE_ID_BY_NAME: Record<string, string> = Object.fromEntries(
  (builtInTypeItems as any[]).map(t => [t.item.value, t.item.id]),
);

// Structured built-ins whose instance payloads are ALREADY projected to
// obj_<typeId> (the target model). This grows type-by-type as each bespoke
// table is retired (see plans/uniform-projection-modernisation.md). A type not
// listed here keeps its legacy storage untouched, so the switch is staged and
// reversible. `grant`/`query` lead: grant's read side (PgAuthzSource) already
// targets obj_<grant-type>, and neither has a conflicting dedicated table.
const PROJECTED_BUILT_IN_TYPES = new Set<string>([
  'grant', 'reference', 'file', 'formula', 'context', 'cell', 'view',
  'channel', 'subscription', 'aspect-type', 'agent', 'action',
  'claude-api-config', 'claude-code-config', 'python-config',
  'kanecta-function-config', 'group-chat-config', 'http-config',
  // query.params is normalised to query-param children (array-of-objects rule).
  'query', 'query-param',
  // component.props -> parameter children; bundleHash -> property children.
  'component', 'parameter', 'property',
  // function.parameters -> parameter children; typeParameters -> type-parameter
  // children; throws -> function-throw children; bundleHash -> property children.
  'function', 'type-parameter', 'function-throw',
  // document scalars project; expandState.exceptions -> document-expand-exception
  // children; roleMap.byDepth/byType -> document-role-by-depth/document-role-by-type
  // children (expandState.defaultDepth is flattened onto the document scalar row).
  'document', 'document-expand-exception', 'document-role-by-depth', 'document-role-by-type',
  // annotation: a payload-dimension type — item lives under the annotation type
  // container, associates via payload.targetId, threads via payload.parentAnnotationId.
  'annotation',
  // alias: a payload-dimension type — item lives under the alias type container, string
  // is item.value, associates via payload.targetId, scoped by payload.assignedBy.
  'alias',
  // licence: a first-class item like any structured built-in — meta.license (a
  // UUID) resolves to a licence item whose {spdxId,name,url,text} projects to
  // obj_<licence-type>, never a bespoke licences table. Instances are the 19
  // built-in licences seeded by _ensureSystemItems from @kanecta/specification.
  'licence',
  // root: the datastore config record. The one root item (0000…) projects its
  // rootPayload {owner, specVersion, itemHistory, activity, entryPoint} to
  // obj_<root-type> — spec §rootPayload replaces the bespoke config table.
  'root',
  // type: the type registry. Every type item (built-in + user-defined) projects
  // to obj_<type-type> — spec §cqrs-projections replaces the bespoke `types`
  // table. obj_<type-type> is built from the flat seed metaschema (not type.json's
  // own nested payload, which would be circular) — see _ensureProjection.
  'type',
  // relationship-type: the relationship vocabulary. Each relationship-type item
  // (the 9 canonical + any user-defined) projects to obj_<relationship-type> —
  // spec §cqrs-projections replaces the bespoke `rel_types` table. Like `type`,
  // it extends the nested type payload, so obj_<relationship-type> is built from
  // the flat seed metaschema (relationshipTypeSeedMetaschema) — see _ensureProjection.
  'relationship-type',
  // relationship: a typed edge is a first-class item. relate() creates a
  // `relationship` item whose payload {typeId, sourceId, targetId, data, confidence,
  // note} projects to obj_<relationship> — spec §relationshipPayload replaces the
  // bespoke `relationships` table. The AGE graph is a purely additive perf_ mirror.
  'relationship',
]);

// The obj_<typeId> the given item projects to, or null if it doesn't project.
// A user 'object' carries its typeId on the row; a projection-enabled structured
// built-in resolves its fixed type-item UUID from the manifest.
function projectionTypeId(type: string, typeId: any): string | null {
  if (type === 'object') return typeId ?? null;
  if (PROJECTED_BUILT_IN_TYPES.has(type)) return BUILT_IN_TYPE_ID_BY_NAME[type] ?? null;
  return null;
}

class UnknownTypeError extends Error {
  code: string;
  typeName: string;

  constructor(typeName: string) {
    super(`unknown type "${typeName}" — not a registered type definition`);
    this.name = 'UnknownTypeError';
    this.code = 'UNKNOWN_TYPE';
    this.typeName = typeName;
  }
}

// ─── Row → item shape ─────────────────────────────────────────────────────────

function rowToItem(row: any): any {
  if (!row) return null;
  return {
    id:           row.id,
    specVersion:  row.spec_version,
    parentId:     row.parent_id,
    value:        row.value,
    type:         row.type,
    typeId:       row.type_id,
    owner:        row.owner,
    license:      row.license,
    sortOrder:    row.sort_order,
    confidence:   row.confidence,
    status:       row.status,
    tags:         row.tags ?? [],
    createdAt:    row.created_at?.toISOString() ?? null,
    modifiedAt:   row.modified_at?.toISOString() ?? null,
    createdBy:    row.created_by,
    modifiedBy:   row.modified_by,
    cachedAt:     row.cached_at?.toISOString() ?? null,
    expiresAt:    row.expires_at?.toISOString() ?? null,
    deletedAt:    row.deleted_at?.toISOString() ?? null,
    connectorId:       row.connector_id ?? null,
    materialized:      row.materialized ?? null,
    completedAt:       row.completed_at?.toISOString() ?? null,
    dueAt:             row.due_at?.toISOString() ?? null,
    visibility:        row.visibility ?? 'private',
    aspect:            row.aspect ?? null,
    sourceSystem:      row.source_system ?? null,
    sourceExternalId:  row.source_external_id ?? null,
  };
}

function parseLinks(value: any): string[] {
  if (!value || typeof value !== 'string') return [];
  const links = new Set<string>();
  let m;
  const re = new RegExp(LINK_RE.source, 'gi');
  while ((m = re.exec(value)) !== null) links.add(m[1]);
  return [...links];
}

function objTableName(typeId: string): string {
  return `obj_${typeId.replace(/-/g, '_')}`;
}

// The schema-compiler emits plain DDL (no guards); the adapter owns idempotency.
// Add `IF NOT EXISTS` to both table and index creation so _ensureProjection can
// run on every object write.
function guardDdl(stmt: string): string {
  return stmt
    .replace(/^CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^CREATE (UNIQUE )?INDEX /i, (_m, u) => `CREATE ${u || ''}INDEX IF NOT EXISTS `);
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

class PostgresAdapter {
  _pool: Pool;
  _config: any;
  _relTypesCache: string[] | null;
  // name (slug) → relationship-type item UUID, from the relationship-type items
  // (obj_<relationship-type>). Lets relate() resolve the string API to a payload
  // typeId. Rebuilt by _loadRelTypes alongside _relTypesCache.
  _relTypeIdByName: Map<string, string>;
  _embeddingProvider: any;
  _embeddingsEnabled: boolean;
  // Apache AGE graph projection (lazy, capability-gated). `undefined` = unprobed;
  // once probed, `_ageAvailable` is a boolean and `_graphName` / `_graphReady`
  // are populated. All graph work no-ops when AGE is not installed.
  _ageAvailable?: boolean;
  _graphName?: string;
  _graphReady: boolean;
  // Carries the active transaction client (and its savepoint counter) through the
  // async call chain so every query in a `transaction(fn)` / `_withTx` scope runs
  // on ONE connection inside ONE BEGIN…COMMIT. `client` is a checked-out pg
  // PoolClient; `spSeq` is a per-transaction monotonic counter for `_execTry`'s
  // savepoint names. See `_exec` / `_execTry` / `_withTx`.
  _txStore: AsyncLocalStorage<{ client: PoolClient; spSeq?: number }>;

  constructor(pool: Pool, { embeddings = null }: any = {}) {
    this._pool              = pool;
    this._config            = null;
    this._relTypesCache     = null;
    this._relTypeIdByName   = new Map();
    this._embeddingProvider = createEmbeddingProvider(embeddings);
    this._embeddingsEnabled = embeddings?.enabled !== false;
    this._graphReady        = false;
    // Carries the active transaction client (if any) through the async call chain
    // so every query in a `transaction(fn)` / `_withTx(fn)` scope runs on ONE
    // connection inside ONE BEGIN…COMMIT — without threading a client param through
    // every helper. Concurrency-safe: each transaction gets its own async store.
    this._txStore           = new AsyncLocalStorage();
  }

  // Run a query on the active transaction client if one is in scope, else on the
  // pool. All adapter reads/writes go through this, so a call made inside
  // `transaction(fn)` both sees its own uncommitted writes and commits atomically.
  _exec(text: any, params?: any): Promise<QueryResult> {
    const runner = this._txStore.getStore()?.client ?? this._pool;
    return runner.query(text, params);
  }

  // Like `_exec`, but for the handful of queries that intentionally tolerate a
  // failure (a missing table/relation: the legacy `types` table, an un-materialised
  // obj_<typeId> projection) and swallow the error at the call site. Under autocommit
  // (no active transaction) a failed statement is naturally isolated — the next
  // query starts a fresh implicit transaction — so this was harmless before writes
  // became atomic. Inside a `transaction(fn)` / `_withTx` scope every statement now
  // shares ONE connection in ONE BEGIN…COMMIT, so a raw failure poisons the whole
  // transaction ("current transaction is aborted, commands ignored until end of
  // transaction block") and every subsequent write throws. Fencing the tolerant
  // query in a SAVEPOINT and rolling back to it on error contains the failure to
  // just that statement, leaving the enclosing transaction intact.
  async _execTry(text: any, params?: any): Promise<QueryResult> {
    const store = this._txStore.getStore();
    if (!store?.client) return this._pool.query(text, params);
    const client = store.client;
    const sp = `kx_sp_${(store.spSeq = (store.spSeq ?? 0) + 1)}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      const result = await client.query(text, params);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      return result;
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      throw err;
    }
  }

  // Join-or-begin: if already inside a transaction, run `fn` in it (no nested
  // BEGIN); otherwise check out a client, wrap `fn` in BEGIN…COMMIT, and roll back
  // on any error. This gives per-write atomicity (Level 1) AND lets a caller batch
  // many writes atomically (Level 2) via the public `transaction` below.
  async _withTx(fn: any) {
    if (this._txStore.getStore()?.client) return fn();
    const client = await this._pool.connect();
    // If we can't cleanly ROLLBACK a failed transaction, the connection is still
    // mid-transaction (aborted) — returning it to the pool would poison the NEXT
    // caller with "current transaction is aborted, commands ignored until end of
    // transaction block". Track that and DESTROY the connection instead of
    // recycling it: `client.release(err)` with a truthy arg tells pg to discard
    // the client rather than return it to the pool.
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await this._txStore.run({ client }, fn);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true; // connection couldn't be reset — must not go back to the pool
      }
      throw err;
    } finally {
      client.release(broken ? new Error('discarding connection: rollback failed') : undefined);
    }
  }

  // Public: run `fn` as ONE atomic transaction. Every adapter write `fn` performs
  // (directly or via the facade) enlists in the same BEGIN…COMMIT and commits
  // together, or all roll back. Generic over items — no domain awareness.
  async transaction(fn: any) {
    return this._withTx(() => fn(this));
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  static async init(pool: Pool, owner: any, { embeddings = null }: any = {}) {
    const adapter = new PostgresAdapter(pool, { embeddings });
    await adapter._migrate();
    // Config lives in rootPayload (obj_<root>) per spec §rootPayload, not a config
    // table. Hold owner in memory so _initRoots / _ensureBuiltInTypes can stamp it
    // on seeded rows; _ensureConfig persists it once the root item, the root type,
    // and its projection all exist.
    adapter._config = { owner, spec_version: specVersion };
    await adapter._initRoots();
    await adapter._ensureBuiltInTypes();
    await adapter._ensureConfig();
    await adapter._ensureSystemItems();
    await adapter._ensureRelationshipTypes();
    await adapter._loadRelTypes();
    if (adapter._embeddingProvider) await adapter._ensureEmbeddingTable();
    return adapter;
  }

  static async open(pool: Pool, { embeddings = null }: any = {}) {
    const adapter = new PostgresAdapter(pool, { embeddings });
    const cfg = await adapter._loadConfig();
    if (!cfg) throw new Error('Not a Kanecta database: config missing or empty');
    adapter._config = cfg;
    // Idempotent backfill: seed any built-in type definitions a pre-existing
    // datastore is missing, so open() and init() converge on the same shape.
    await adapter._ensureBuiltInTypes();
    await adapter._ensureSystemItems();
    await adapter._ensureRelationshipTypes();
    await adapter._loadRelTypes();
    if (adapter._embeddingProvider) await adapter._ensureEmbeddingTable();
    return adapter;
  }

  get config() {
    if (!this._config) throw new Error('Adapter not initialised — call open() or init()');
    return this._config;
  }

  get relTypes() {
    return this._relTypesCache ?? [...BUILT_IN_REL_TYPES];
  }

  // ─── Migrations ─────────────────────────────────────────────────────────────

  async _migrate() {
    const dir  = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

    // Migrations are forward-only and run exactly once, in filename order. A
    // ledger records what's been applied so reopening a datastore does not
    // re-run (and fail on) non-idempotent statements like ADD CONSTRAINT.
    await this._exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );

    // Baseline: a schema that was already migrated before this ledger existed
    // (items table present, no ledger rows) is recorded as fully applied so we
    // never re-run migrations against a live database.
    const { rows: count } = await this._exec('SELECT COUNT(*)::int AS n FROM schema_migrations');
    if (count[0].n === 0) {
      const { rows: has } = await this._exec("SELECT to_regclass('items') IS NOT NULL AS has_items");
      if (has[0].has_items) {
        for (const file of files) {
          await this._exec('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        }
        return;
      }
    }

    const { rows } = await this._exec('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map(r => r.filename));
    const pending = files.filter(f => !applied.has(f));

    // Fail-closed schema-change guard. Applying a migration MUTATES the database
    // (create/drop tables, alter constraints) and could destroy production data.
    // Refuse unless explicitly authorised, so a deploy can never silently modify
    // a prod datastore. Dev/test and any deliberate migrate opt in via
    // KANECTA_ALLOW_SCHEMA_CHANGES=1 (after taking a backup).
    if (pending.length && !PostgresAdapter._schemaChangesAllowed()) {
      throw new Error(
        `Refusing to apply ${pending.length} pending schema migration(s): this would modify ` +
        `the database schema and may affect production data.\n` +
        `  Pending: ${pending.join(', ')}\n` +
        `Back up the database, then set KANECTA_ALLOW_SCHEMA_CHANGES=1 to apply.`,
      );
    }

    for (const file of pending) {
      await this._exec(fs.readFileSync(path.join(dir, file), 'utf8'));
      await this._exec('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
    }
  }

  // Whether schema-mutating operations (migrations, built-in-type seeding) are
  // authorised on this process. Fail-closed: only KANECTA_ALLOW_SCHEMA_CHANGES=1
  // (or 'true') opts in. Prod deploys leave it unset, so an accidental init /
  // migrate against production fails loudly instead of silently changing it.
  static _schemaChangesAllowed(): boolean {
    const v = process.env.KANECTA_ALLOW_SCHEMA_CHANGES;
    return v === '1' || v === 'true';
  }

  // Persist the datastore config record into the root node's payload (obj_<root>)
  // — spec §rootPayload replaces the config table. Requires the root item
  // (_initRoots), the root type + its projection (_ensureBuiltInTypes) to exist
  // first. Guarded like the other seeders so an unauthorised connect never mutates
  // schema/data; the in-memory this._config (set from the init owner arg) keeps the
  // adapter usable regardless.
  async _ensureConfig() {
    if (!PostgresAdapter._schemaChangesAllowed()) return;
    const cfg = this._config ?? {};
    await this._ensureProjection(ROOT_TYPE_ID);
    // rootPayload now carries the type-type seed metaschema (spec §rootPayload /
    // §cqrs-projections) — the irreducible bootstrap, stored as data so the
    // datastore is self-describing rather than relying only on adapter code. A
    // datastore whose obj_<root> predates this field (created before the root
    // schema gained seedMetaschema) lacks the column; _ensureProjection's IF NOT
    // EXISTS create won't evolve an existing table, so reconcile it here. No-op on
    // a fresh datastore (the column is already present from the current schema).
    await this._exec(
      `ALTER TABLE "${objTableName(ROOT_TYPE_ID)}" ADD COLUMN IF NOT EXISTS seed_metaschema JSONB`,
    );
    await this.writeObjectJson(ROOT_ID, ROOT_TYPE_ID, {
      owner:          cfg.owner,
      specVersion:    cfg.spec_version ?? specVersion,
      itemHistory:    cfg.item_history ?? 'EXTERNAL',
      activity:       cfg.activity ?? 'EXTERNAL',
      seedMetaschema: typeSeedMetaschema,
      ...(cfg.entry_point ? { entryPoint: cfg.entry_point } : {}),
    });
    this._config = (await this._loadConfig()) ?? this._config;
  }

  // Read the datastore config from the root node's payload (obj_<root>). Falls back
  // to the legacy config table for datastores not yet migrated past 037. Returns
  // an object carrying at least { owner, spec_version } — the shape every
  // this.config consumer expects.
  async _loadConfig() {
    try {
      const { rows } = await this._exec(
        `SELECT owner, spec_version, item_history, activity, entry_point
           FROM "${objTableName(ROOT_TYPE_ID)}" WHERE item_id = $1`,
        [ROOT_ID],
      );
      if (rows.length) return { ...rows[0] };
    } catch { /* obj_<root> not present yet — fall back to the legacy table */ }
    try {
      const { rows } = await this._exec('SELECT key, value FROM config');
      if (rows.length) return Object.fromEntries(rows.map(r => [r.key, r.value]));
    } catch { /* no config table either */ }
    return null;
  }

  // ─── Relationship types ──────────────────────────────────────────────────────

  // The relationship vocabulary is the set of relationship-type ITEMS (spec
  // §cqrs-projections — no bespoke `rel_types` table). Cache the slugs (item.value)
  // and a name→UUID map so relate() can resolve the preserved string API to a
  // payload typeId. Falls back to the built-in slugs when the items aren't seeded
  // yet (e.g. an unauthorised open where _ensureRelationshipTypes was skipped).
  async _loadRelTypes() {
    try {
      const { rows } = await this._exec(
        `SELECT id, value FROM items WHERE type = 'relationship-type' AND deleted_at IS NULL
         ORDER BY value`,
      );
      if (rows.length) {
        this._relTypesCache   = rows.map(r => r.value);
        this._relTypeIdByName = new Map(rows.map(r => [r.value, r.id]));
        return;
      }
    } catch { /* items table not queryable — fall back */ }
    this._relTypesCache   = [...BUILT_IN_REL_TYPES];
    this._relTypeIdByName = new Map();
  }

  // Add user-defined relationship types by creating `relationship-type` items
  // (directional by default, no inverse) projecting to obj_<relationship-type>.
  async addRelTypes(names: any) {
    if (!PostgresAdapter._schemaChangesAllowed())
      throw new Error('Refusing to create relationship-type items: set KANECTA_ALLOW_SCHEMA_CHANGES=1');
    const invalid = names.filter((n: any) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(n));
    if (invalid.length)
      throw new Error(`Invalid relationship type name(s): ${invalid.join(', ')} — must be lowercase kebab-case starting with a letter`);
    await this._ensureProjection(RELATIONSHIP_TYPE_TYPE_ID);
    await this._loadRelTypes();
    const now = new Date();
    for (const name of names) {
      if (this._relTypeIdByName.has(name)) continue;   // already exists
      const id = crypto.randomUUID();
      await this._writeRelationshipTypeItem(id, {
        value: name,
        meta: { description: `User-defined relationship type: ${name}`, directional: true, inverse: null },
        jsonSchema: { '$schema': 'http://json-schema.org/draft-07/schema#', title: name, type: 'object', properties: {}, additionalProperties: true },
        sqlSchema: [],
      }, now);
    }
    await this._loadRelTypes();
  }

  // Seed the 9 canonical relationship-type items (spec §relationshipPayload) from
  // @kanecta/specification's builtInRelationshipTypeItems, each projecting to
  // obj_<relationship-type>. Runs AFTER _ensureBuiltInTypes so the relationship-type
  // type item (its items row + registry def) exists. Same fail-closed schema-change
  // guard as the other seeders. Idempotent (ON CONFLICT / UPSERT).
  //
  // Two passes: insert every items row first, THEN write every projection row —
  // meta_inverse is a self-referential FK to items(id) (depends-on ↔ enables), so a
  // one-pass insert would violate the FK before the partner row exists.
  async _ensureRelationshipTypes() {
    if (!PostgresAdapter._schemaChangesAllowed()) return;
    const rtypeId  = RELATIONSHIP_TYPE_TYPE_ID;
    const projected = await this._ensureProjection(rtypeId);
    const typePath  = `${ROOT_ID}/${TYPES_CONTAINER_ID}/${rtypeId}`;
    const now       = new Date();
    const owner     = this.config.owner;

    // Pass 1: items rows.
    for (const src of builtInRelationshipTypeItems as any[]) {
      const id = src.item.id;
      await this._exec(
        `INSERT INTO items (id, spec_version, parent_id, path, value, type, type_id, owner,
           license, sort_order, created_at, modified_at, created_by, modified_by)
         VALUES ($1,$2,$3,$4,$5,'relationship-type',$6,$7,$8,$9,$10,$10,$7,$7)
         ON CONFLICT (id) DO NOTHING`,
        [id, specVersion, rtypeId, `${typePath}/${id}`, src.item.value, rtypeId,
         owner, src.meta?.license ?? DEFAULT_LICENSE, src.item.sortOrder ?? 0, now],
      );
    }

    // Pass 2: projection rows (now every meta_inverse target exists).
    if (projected) {
      for (const src of builtInRelationshipTypeItems as any[]) {
        await this._writeRelationshipTypeProjection(src.item.id, src.payload ?? {});
      }
    }
  }

  // Insert a single relationship-type item (items row + obj_<relationship-type>
  // projection). Used by addRelTypes; the seeder uses two explicit passes instead
  // because of the meta_inverse FK ordering.
  async _writeRelationshipTypeItem(id: any, payload: any, now: Date) {
    const rtypeId  = RELATIONSHIP_TYPE_TYPE_ID;
    const typePath = `${ROOT_ID}/${TYPES_CONTAINER_ID}/${rtypeId}`;
    await this._exec(
      `INSERT INTO items (id, spec_version, parent_id, path, value, type, type_id, owner,
         license, sort_order, created_at, modified_at, created_by, modified_by)
       VALUES ($1,$2,$3,$4,$5,'relationship-type',$6,$7,$8,0,$9,$9,$7,$7)
       ON CONFLICT (id) DO NOTHING`,
      [id, specVersion, rtypeId, `${typePath}/${id}`, payload.value, rtypeId,
       this.config.owner, DEFAULT_LICENSE, now],
    );
    await this._writeRelationshipTypeProjection(id, payload);
    await this._snapshot(id, 'create', this.config.owner, now);
  }

  // Write a relationship-type item's nested payload to its flat obj_<relationship-type>
  // row (upsert). Mirrors _ensureBuiltInTypes' type-registry write, plus the two
  // directional-semantics columns (meta_directional, meta_inverse).
  async _writeRelationshipTypeProjection(id: any, payload: any) {
    const meta = payload.meta ?? {};
    await this._exec(
      `INSERT INTO "${objTableName(RELATIONSHIP_TYPE_TYPE_ID)}" (
         item_id,
         meta_icon, meta_description, meta_details, meta_keywords, meta_tags,
         meta_primary_field, meta_ai_instructions_claude,
         meta_functions_consumed_by, meta_functions_produced_by,
         meta_directional, meta_inverse,
         json_schema, sql_schema, sync, superseded_by, implements, extends, indexes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (item_id) DO UPDATE SET
         meta_icon = $2, meta_description = $3, meta_details = $4, meta_keywords = $5, meta_tags = $6,
         meta_primary_field = $7, meta_ai_instructions_claude = $8,
         meta_functions_consumed_by = $9, meta_functions_produced_by = $10,
         meta_directional = $11, meta_inverse = $12,
         json_schema = $13, sql_schema = $14, sync = $15, superseded_by = $16, implements = $17,
         extends = $18, indexes = $19`,
      [
        id,
        meta.icon ?? null, meta.description ?? '', meta.details ?? null,
        meta.keywords ?? null, meta.tags ?? null,
        meta.primaryField ?? null, meta.skills?.claude ?? null,
        meta.functions?.consumedBy ?? [], meta.functions?.producedBy ?? [],
        meta.directional ?? true, meta.inverse ?? null,
        JSON.stringify(payload.jsonSchema ?? {}), payload.sqlSchema ?? [],
        meta.sync ?? [], meta.supersededBy ?? [], meta.implements ?? [], meta.extends ?? [],
        JSON.stringify(payload.indexes ?? []),
      ],
    );
  }

  // ─── Well-known root nodes ───────────────────────────────────────────────────

  async _initRoots() {
    const existing = await this.get(ROOT_ID);
    if (!existing) await this._createWellKnownNode(ROOT_ID, ROOT_ID, 'root', 0);
    const children = await this.children(ROOT_ID);
    const existingTypes = new Set(children.map((c: any) => c.type));
    for (let i = 0; i < WELL_KNOWN_ORDER.length; i++) {
      const type = WELL_KNOWN_ORDER[i];
      if (!existingTypes.has(type)) {
        await this._createWellKnownNode(crypto.randomUUID(), ROOT_ID, type, i);
      }
    }
  }

  async _createWellKnownNode(id: any, parentId: any, type: any, sortOrder: any) {
    const now    = new Date();
    const owner  = this.config.owner;
    const value  = type;
    // Compute path: root is self-referencing, so its path = id; others get parent path prefix.
    let path;
    if (id === parentId) {
      path = id;
    } else {
      const parentPath = await this._getPath(parentId);
      path = parentPath != null ? `${parentPath}/${id}` : id;
    }
    await this._exec(
      `INSERT INTO items (id, spec_version, parent_id, path, value, type, owner, license, sort_order,
         created_at, modified_at, created_by, modified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$7,$7)
       ON CONFLICT (id) DO NOTHING`,
      [id, specVersion, parentId, path, value, type, owner, DEFAULT_LICENSE, sortOrder, now],
    );
    await this._snapshot(id, 'create', owner, now);
    return this.get(id);
  }

  // Seed the core manifest of built-in type items (grant, query, file, …) under
  // the synthetic types-container node, with their fixed UUIDs, from
  // @kanecta/specification. These are ordinary type items (type='type' in items,
  // a 1:1 registry row in obj_<type-type> carrying the jsonSchema) — so
  // readTypeJson/_ensureProjection work on a built-in exactly as on a user type.
  // Idempotent: skips the items-row for any type item already present but re-upserts
  // its obj_<type-type> row, so it safely backfills existing datastores on open (and
  // completes the `types` -> obj_<type-type> cutover on the first authorised open
  // after migration 038) as well as seeding fresh ones at init. The one obj_ table
  // it materialises is the registry itself, obj_<type-type> — a type with zero
  // *instances* still projects nothing (the four-table invariant); type items ARE
  // the instances of the type-type, so its projection is always live.
  async _ensureBuiltInTypes() {
    // Seeding inserts the built-in type items + their type rows — a bootstrap
    // mutation of the datastore. Same fail-closed guard as migrations: on an
    // unauthorised open() (e.g. a prod app connecting) skip silently so the
    // datastore is never modified on connect. A deliberate init/migrate with
    // KANECTA_ALLOW_SCHEMA_CHANGES=1 seeds it.
    if (!PostgresAdapter._schemaChangesAllowed()) return;

    const owner = this.config.owner;
    const now   = new Date();

    // The types-container node. Parented under root; its own children are the
    // built-in type items. Direct insert (create() forbids reserved types).
    await this._exec(
      `INSERT INTO items (id, spec_version, parent_id, path, value, type, owner, license,
         sort_order, created_at, modified_at, created_by, modified_by)
       VALUES ($1,$2,$3,$4,'types','types',$5,$6,0,$7,$7,$5,$5)
       ON CONFLICT (id) DO NOTHING`,
      [TYPES_CONTAINER_ID, specVersion, ROOT_ID,
       `${ROOT_ID}/${TYPES_CONTAINER_ID}`, owner, DEFAULT_LICENSE, now],
    );

    // The type registry is obj_<type-type> (spec §cqrs-projections — no bespoke
    // `types` table; migration 038 drops it). Materialise obj_<type-type> from the
    // flat seed metaschema before seeding any type rows into it — the type-type
    // can't derive its own columns (that's circular; see _ensureProjection).
    // Idempotent (IF NOT EXISTS).
    const typeObj = objTableName(TYPE_TYPE_ID);
    await this._ensureProjection(TYPE_TYPE_ID);

    for (const src of builtInTypeItems as any[]) {
      const id      = src.item.id;
      const value   = src.item.value;
      const payload = src.payload ?? {};
      if (!payload.jsonSchema) continue;             // nothing to project against

      // The items row is inserted once (skip if present); the obj_<type-type> row
      // is upserted UNCONDITIONALLY so an existing datastore — whose built-in type
      // items predate the `types` -> obj_<type-type> cutover — gets its registry
      // rows re-seeded into the new projection after migration 038 drops `types`.
      const { rows } = await this._exec('SELECT 1 FROM items WHERE id = $1', [id]);
      if (!rows.length) {
        const parentId = src.item.parentId ?? TYPES_CONTAINER_ID;
        await this._exec(
          `INSERT INTO items (id, spec_version, parent_id, path, value, type, owner, license,
             sort_order, created_at, modified_at, created_by, modified_by)
           VALUES ($1,$2,$3,$4,$5,'type',$6,$7,0,$8,$8,$6,$6)
           ON CONFLICT (id) DO NOTHING`,
          [id, specVersion, parentId, `${ROOT_ID}/${TYPES_CONTAINER_ID}/${id}`,
           value, owner, DEFAULT_LICENSE, now],
        );
      }

      const meta = payload.meta ?? {};
      await this._exec(
        `INSERT INTO "${typeObj}" (
           item_id,
           meta_icon, meta_description, meta_details, meta_keywords, meta_tags,
           meta_primary_field, meta_ai_instructions_claude,
           meta_functions_consumed_by, meta_functions_produced_by,
           json_schema, sql_schema, sync, superseded_by, implements, extends, indexes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (item_id) DO NOTHING`,
        [
          id,
          meta.icon ?? null, meta.description ?? '', meta.details ?? null,
          meta.keywords ?? null, meta.tags ?? null,
          meta.primaryField ?? null, meta.skills?.claude ?? null,
          meta.functions?.consumedBy ?? [], meta.functions?.producedBy ?? [],
          JSON.stringify(payload.jsonSchema), payload.sqlSchema ?? [],
          meta.sync ?? [], meta.supersededBy ?? [], meta.implements ?? [], meta.extends ?? [],
          JSON.stringify(payload.indexes ?? []),
        ],
      );
    }
  }

  // Seed the mandatory system INSTANCES the platform depends on — currently the
  // 19 built-in licences (spec §licencePayload) — from @kanecta/specification's
  // builtInSystemItems. Each becomes a `licence` item under the licence type
  // container, projecting {spdxId,name,url,text} to obj_<licence-type>. Runs
  // AFTER _ensureBuiltInTypes so the licence type + its projection def exist.
  // Idempotent (ON CONFLICT / UPSERT) so it backfills existing datastores on open
  // as well as seeding fresh ones. Same fail-closed guard as the type seeding.
  //
  // The default licence (bb3bf137) was seeded self-parented by migration 036 so
  // the items.license -> items(id) FK could retarget; here we write its
  // projection and reparent it under the licence type — its canonical home.
  async _ensureSystemItems() {
    if (!PostgresAdapter._schemaChangesAllowed()) return;

    const licenceTypeId = BUILT_IN_TYPE_ID_BY_NAME['licence'];
    if (!licenceTypeId) return;                       // licence type not seeded

    const projected = await this._ensureProjection(licenceTypeId);
    const typePath  = `${ROOT_ID}/${TYPES_CONTAINER_ID}/${licenceTypeId}`;
    const now       = new Date();

    for (const src of builtInSystemItems as any[]) {
      const id       = src.item.id;
      const parentId = src.item.parentId ?? licenceTypeId;
      const owner    = src.meta?.owner ?? this.config.owner;
      const license  = src.meta?.license ?? DEFAULT_LICENSE;
      await this._exec(
        `INSERT INTO items (id, spec_version, parent_id, path, value, type, type_id, owner,
           license, sort_order, created_at, modified_at, created_by, modified_by)
         VALUES ($1,$2,$3,$4,$5,'licence',$6,$7,$8,0,$9,$9,$7,$7)
         ON CONFLICT (id) DO NOTHING`,
        [id, specVersion, parentId, `${typePath}/${id}`, src.item.value,
         licenceTypeId, owner, license, now],
      );
      if (projected) await this.writeObjectJson(id, licenceTypeId, src.payload ?? {});
    }

    // Reparent the default licence out of its self-parented bootstrap state (only
    // while still self-parented, so this is a no-op on already-seeded datastores).
    await this._exec(
      `UPDATE items SET parent_id = $1, path = $2 WHERE id = $3 AND parent_id = $3`,
      [licenceTypeId, `${typePath}/${DEFAULT_LICENSE}`, DEFAULT_LICENSE],
    );
  }

  async getRoot()     { return this._getByType('root'); }

  async _getByType(type: any) {
    const { rows } = await this._exec(
      'SELECT * FROM items WHERE type = $1 LIMIT 1', [type],
    );
    return rowToItem(rows[0] ?? null);
  }

  _assertEditable(item: any, id: any) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID)
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be modified`);
  }

  _assertDeletable(item: any, id: any) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID)
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be deleted`);
  }

  // ─── Materialized path ───────────────────────────────────────────────────────

  async _getPath(id: any) {
    if (!id) return null;
    const { rows } = await this._exec('SELECT path FROM items WHERE id = $1', [id]);
    return rows[0]?.path ?? null;
  }

  _pathDepth(path: any) {
    if (!path) return 0;
    return (path.match(/\//g) || []).length;
  }

  async _cascadePathUpdate(id: any, newPath: any) {
    const oldPath = await this._getPath(id);
    await this._exec('UPDATE items SET path = $1 WHERE id = $2', [newPath, id]);
    if (oldPath) {
      const oldPrefix = oldPath + '/';
      // Update all descendants whose path starts with the old prefix.
      // SUBSTRING(path FROM length) extracts the part after the old prefix.
      await this._exec(
        // $2::int forces SUBSTRING's positional form; without the cast an
        // untyped parameter is treated as the regex-pattern form and returns
        // null, wiping every descendant's path.
        `UPDATE items
         SET path = $1 || '/' || SUBSTRING(path FROM $2::int)
         WHERE path LIKE $3 AND id != $4`,
        [newPath, oldPrefix.length + 1, oldPrefix + '%', id],
      );
    }
  }

  // ─── History ────────────────────────────────────────────────────────────────

  async _snapshot(idOrItem: any, changeType: any, changedBy: any, now?: any) {
    const item = typeof idOrItem === 'string' ? await this.get(idOrItem) : idOrItem;
    if (!item) return;
    await this._exec(
      `INSERT INTO item_history (id, item_id, snapshot, snapshot_at, changed_by, change_type)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), item.id, JSON.stringify(item), now ?? new Date(), changedBy, changeType],
    );
  }

  // ─── Item CRUD ───────────────────────────────────────────────────────────────

  async get(id: any) {
    const { rows } = await this._exec('SELECT * FROM items WHERE id = $1', [id]);
    return rowToItem(rows[0] ?? null);
  }

  async _typeDefExists(typeId: any) {
    if (!typeId) return false;
    const { rows } = await this._exec(
      `SELECT 1 FROM items WHERE id = $1 AND type = 'type' LIMIT 1`, [typeId],
    );
    return rows.length > 0;
  }

  _guardTypeIdRef(typeId: any, strict: any) {
    const effectiveStrict = strict !== undefined ? !!strict : !!this.config.strictTypeIds;
    if (effectiveStrict) {
      const err: any = new Error(`unknown typeId "${typeId}" — no registered type definition`);
      err.name = 'UnknownTypeError';
      err.code = 'UNKNOWN_TYPE';
      err.typeId = typeId;
      throw err;
    }
    return `typeId ${typeId} has no type definition — node written anyway; run \`kanecta doctor\``;
  }

  // Public write ops are atomic across all their projection/log writes: each wraps
  // its implementation in `_withTx` (a standalone BEGIN…COMMIT), or joins the
  // caller's `transaction(fn)` if one is already open.
  async create(args: any = {}) {
    return this._withTx(() => this._createImpl(args));
  }

  async _createImpl({
    id: providedId = null,
    parentId, value = null, type = 'string', typeId = null,
    owner, license = null, sortOrder, confidence = null, status = null,
    tags = [], createdBy, objectData = null, dueAt = null, aspect = null,
    expiresAt = null, connectorId = null, materialized = null, cachedAt = null,
    sourceSystem = null, sourceExternalId = null,
    strict,
  }: any = {}) {
    if (WELL_KNOWN_TYPES.has(type))
      throw new Error(`Type '${type}' is well-known and cannot be created via create()`);
    // Optional caller-supplied id (backfill preserving source UUIDs; intra-
    // transaction references where a later op points at this item). Must be a valid
    // UUID that is not already taken; otherwise ids are server-minted.
    if (providedId != null) {
      if (!UUID_RE.test(providedId))
        throw new Error(`Invalid id (must be a UUID): ${providedId}`);
      const { rows } = await this._exec('SELECT 1 FROM items WHERE id = $1', [providedId]);
      if (rows.length) throw new Error(`Item id already exists: ${providedId}`);
    }

    let typeWarning: any = null;
    if (type === 'object' && typeId && !(await this._typeDefExists(typeId))) {
      typeWarning = this._guardTypeIdRef(typeId, strict);
    }

    // The projection table this item belongs to (obj_<typeId>): a user 'object'
    // carries its typeId; a projection-enabled structured built-in (grant, query)
    // resolves its fixed type-item UUID. null for primitives / not-yet-cut-over
    // built-ins — they keep type_id NULL and project nothing.
    const rowTypeId = projectionTypeId(type, typeId);

    // Validate a supplied payload up-front, before the item row is inserted, so a
    // schema violation can never leave a dangling item with no (or invalid) payload.
    if (rowTypeId && objectData != null) {
      await this._validateObjectPayload(rowTypeId, objectData);
    }

    if (parentId == null) {
      parentId = ROOT_ID;
    }

    const id       = providedId ?? crypto.randomUUID();
    const now      = new Date();
    const ownerVal = owner || this.config.owner;
    const actor    = createdBy || ownerVal;

    if (sortOrder == null) {
      const siblings = await this.children(parentId);
      sortOrder = siblings.length === 0 ? 0 : Math.max(...siblings.map((s: any) => s.sortOrder)) + 1;
    }

    // Compute materialized path
    const parentPath = parentId ? await this._getPath(parentId) : null;
    const itemPath   = parentPath != null ? `${parentPath}/${id}` : id;

    await this._exec(
      `INSERT INTO items
         (id, spec_version, parent_id, path, value, type, type_id, owner, license, sort_order,
          confidence, status, tags, created_at, modified_at, created_by, modified_by,
          due_at, visibility, aspect, expires_at, connector_id, materialized, cached_at,
          source_system, source_external_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$15,$16,'private',$17,$18,$19,$20,$21,$22,$23)`,
      [
        id, specVersion, parentId, itemPath, value,
        type, rowTypeId,
        ownerVal, license ?? DEFAULT_LICENSE,
        sortOrder, confidence, status, tags,
        now, actor, dueAt, aspect,
        expiresAt, connectorId, materialized, cachedAt,
        sourceSystem, sourceExternalId,
      ],
    );

    for (const link of parseLinks(value)) {
      await this._exec(
        'INSERT INTO perf_backlinks (source_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [id, link],
      );
    }

    // Per-type table projection: the first live instance of a type materialises
    // its obj_<typeId> table, and every instance holds a row there (one row per
    // live item). Applies to user 'object' types AND projection-enabled
    // structured built-ins (both resolved to rowTypeId). ensureProjection is a
    // no-op for an orphan typeId (no def).
    if (rowTypeId) {
      const projected = await this._ensureProjection(rowTypeId);
      if (projected) {
        if (objectData) await this.writeObjectJson(id, rowTypeId, objectData);
        else await this._exec(
          `INSERT INTO "${objTableName(rowTypeId)}" (item_id) VALUES ($1) ON CONFLICT (item_id) DO NOTHING`,
          [id],
        );
      }
    }

    const item = await this.get(id);
    await this._snapshot(item, 'create', actor, now);
    if (typeWarning) {
      Object.defineProperty(item, 'warning', { value: typeWarning, enumerable: false, configurable: true });
    }
    return item;
  }

  async update(id: any, changes: any, actor?: any, opts: any = {}) {
    return this._withTx(() => this._updateImpl(id, changes, actor, opts));
  }

  async _updateImpl(id: any, changes: any, actor?: any, { strict }: any = {}) {
    const current = await this.get(id);
    if (!current) throw new Error(`Item not found: ${id}`);
    // The root node is renamable — its `value` (and other descriptive fields)
    // may be edited so a datastore can be given a meaningful name — but its
    // structural fields stay locked so it remains the self-parented type:'root'
    // anchor. It still can't be deleted (softDelete keeps _assertEditable). Every
    // other reserved node (the types container) stays fully immutable.
    if (current.id === ROOT_ID) {
      const LOCKED_ROOT_FIELDS = ['type', 'typeId', 'parentId', 'sortOrder', 'aspect'];
      for (const f of LOCKED_ROOT_FIELDS)
        if (f in changes && changes[f] !== current[f])
          throw new Error(`The root node's '${f}' cannot be changed`);
    } else {
      this._assertEditable(current, id);
    }

    const newType   = 'type'   in changes ? changes.type   : current.type;
    const newTypeId = 'typeId' in changes ? changes.typeId : current.typeId;
    let typeWarning: any = null;
    if (newType === 'object' && newTypeId && newTypeId !== current.typeId
        && !(await this._typeDefExists(newTypeId))) {
      typeWarning = this._guardTypeIdRef(newTypeId, strict);
    }

    actor = actor || this.config.owner;
    const now = new Date();
    await this._snapshot(current, 'update', actor, now);

    const sets:   any[] = [];
    const params: any[] = [];
    let   p      = 1;

    const maybeSet = (col: any, val: any) => { sets.push(`${col} = $${p++}`); params.push(val); };

    if ('value' in changes) {
      const oldLinks = parseLinks(current.value);
      const newLinks = parseLinks(changes.value);
      for (const l of oldLinks) if (!newLinks.includes(l))
        await this._exec('DELETE FROM perf_backlinks WHERE source_id=$1 AND target_id=$2', [id, l]);
      for (const l of newLinks) if (!oldLinks.includes(l))
        await this._exec('INSERT INTO perf_backlinks (source_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, l]);
      maybeSet('value', changes.value);
    }

    if ('type' in changes)        maybeSet('type',         changes.type);
    // Keep type_id in lockstep with the projection identity: recompute it
    // whenever type or typeId changes so a structured built-in gains/keeps its
    // fixed UUID and a primitive clears it (projectionTypeId encodes both).
    if ('type' in changes || 'typeId' in changes)
      maybeSet('type_id', projectionTypeId(newType, newTypeId));
    if ('sortOrder' in changes)   maybeSet('sort_order',   changes.sortOrder);
    if ('confidence' in changes)  maybeSet('confidence',   changes.confidence);
    if ('status' in changes)      maybeSet('status',       changes.status);
    if ('license' in changes)     maybeSet('license',      changes.license);
    if ('completedAt' in changes) maybeSet('completed_at', changes.completedAt);
    if ('dueAt' in changes)       maybeSet('due_at',       changes.dueAt);
    if ('visibility' in changes)  maybeSet('visibility',   changes.visibility);
    if ('aspect' in changes)      maybeSet('aspect',       changes.aspect);
    if ('tags' in changes)        maybeSet('tags',         changes.tags);
    if ('expiresAt' in changes)   maybeSet('expires_at',   changes.expiresAt);
    if ('deletedAt' in changes)   maybeSet('deleted_at',   changes.deletedAt);
    if ('connectorId' in changes)       maybeSet('connector_id',       changes.connectorId);
    if ('materialized' in changes)      maybeSet('materialized',       changes.materialized);
    if ('cachedAt' in changes)          maybeSet('cached_at',          changes.cachedAt);
    if ('sourceSystem' in changes)      maybeSet('source_system',      changes.sourceSystem);
    if ('sourceExternalId' in changes)  maybeSet('source_external_id', changes.sourceExternalId);

    // Cascade path when parentId changes
    if ('parentId' in changes && changes.parentId !== current.parentId) {
      const parentPath = await this._getPath(changes.parentId);
      const newPath    = parentPath != null ? `${parentPath}/${id}` : id;
      await this._cascadePathUpdate(id, newPath);
      maybeSet('parent_id', changes.parentId);
    }

    maybeSet('modified_at', now);
    maybeSet('modified_by', actor);

    if (sets.length) {
      await this._exec(
        `UPDATE items SET ${sets.join(', ')} WHERE id = $${p}`,
        [...params, id],
      );
    }

    // Per-type projection: reconcile membership when the item's projection
    // identity changes. Both sides resolve through projectionTypeId so user
    // 'object' types and projection-enabled structured built-ins are handled
    // uniformly. The items row is already updated above. A pure soft-delete
    // (deletedAt only) leaves type/typeId unchanged and keeps the obj_ row.
    const prevProj = projectionTypeId(current.type, current.typeId);
    const nextProj = projectionTypeId(newType, newTypeId);
    if (prevProj && prevProj !== nextProj) {
      try { await this._exec(`DELETE FROM "${objTableName(prevProj)}" WHERE item_id = $1`, [id]); }
      catch { /* old table already absent */ }
      await this._dropProjectionIfEmpty(prevProj);
    }
    if (nextProj && prevProj !== nextProj) {
      const projected = await this._ensureProjection(nextProj);
      if (projected) await this._exec(
        `INSERT INTO "${objTableName(nextProj)}" (item_id) VALUES ($1) ON CONFLICT (item_id) DO NOTHING`,
        [id],
      );
    }

    const result = await this.get(id);
    if (typeWarning && result) {
      Object.defineProperty(result, 'warning', { value: typeWarning, enumerable: false, configurable: true });
    }
    return result;
  }

  async deleteWarnings(id: any) {
    const { rows: linkRows } = await this._exec(
      'SELECT COUNT(*) FROM perf_backlinks WHERE target_id = $1', [id],
    );
    const relRows = await this._execTry(
      `SELECT COUNT(*) FROM "${objTableName(RELATIONSHIP_TYPE_ID)}" o
         JOIN items i ON i.id = o.item_id
        WHERE o.target_id = $1 AND i.deleted_at IS NULL`, [id],
    ).then(r => r.rows).catch(() => [{ count: '0' }]);   // obj_<relationship> not materialised
    const warnings = [];
    if (parseInt(linkRows[0].count) > 0)
      warnings.push(`${linkRows[0].count} item(s) link to this via [[uuid]] syntax`);
    if (parseInt(relRows[0].count) > 0)
      warnings.push(`${relRows[0].count} inbound relationship(s) point to this item`);
    return warnings;
  }

  async delete(id: any, actor?: any) {
    return this._withTx(() => this._deleteImpl(id, actor));
  }

  async _deleteImpl(id: any, actor?: any) {
    const item = await this.get(id);
    this._assertDeletable(item, id);
    actor = actor || this.config.owner;
    const now = new Date();
    const warnings = await this.deleteWarnings(id);
    await this._snapshot(item, 'delete', actor, now);
    // Alias items pointing at this item would dangle (and their target_id FK would
    // block the delete), so remove them first. Their obj_<alias> rows cascade via the
    // item_id FK. (Aliases are now first-class items — no `aliases` table.)
    const aliasTable = objTableName(BUILT_IN_TYPE_ID_BY_NAME['alias']);
    await this._execTry(
      `DELETE FROM items WHERE id IN (
         SELECT i.id FROM items i JOIN "${aliasTable}" a ON a.item_id = i.id
         WHERE i.type = 'alias' AND a.target_id = $1)`,
      [id],
    ).catch(() => { /* obj_<alias> not materialised yet */ });
    // Derived backlink rows reference items via FK in both directions — clear
    // them before removing the item.
    await this._exec('DELETE FROM perf_backlinks WHERE source_id = $1 OR target_id = $1', [id]);
    await this._exec('DELETE FROM items WHERE id = $1', [id]);
    // The obj_ row cascaded away with the items row (FK ON DELETE CASCADE). Drop
    // the type table if this hard delete removed the last remaining instance.
    // typeId is the projection key (object OR structured built-in).
    if (item.typeId) await this._dropProjectionIfEmpty(item.typeId);
    return { warnings };
  }

  // ─── Soft delete / restore ───────────────────────────────────────────────────

  async softDelete(id: any, actor?: any) {
    const item = await this.get(id);
    if (!item) throw new Error(`Item not found: ${id}`);
    this._assertDeletable(item, id);
    actor = actor || this.config.owner;
    const now = new Date();
    await this._snapshot(item, 'soft-delete', actor, now);
    await this._exec(
      'UPDATE items SET deleted_at = $1, modified_at = $1, modified_by = $2 WHERE id = $3',
      [now, actor, id],
    );
    return this.get(id);
  }

  async restore(id: any, actor?: any) {
    const item = await this.get(id);
    if (!item) throw new Error(`Item not found: ${id}`);
    actor = actor || this.config.owner;
    const now = new Date();
    await this._snapshot(item, 'restore', actor, now);
    await this._exec(
      'UPDATE items SET deleted_at = NULL, modified_at = $1, modified_by = $2 WHERE id = $3',
      [now, actor, id],
    );
    return this.get(id);
  }

  // ─── Aliases ─────────────────────────────────────────────────────────────────

  // An alias is a payload-dimension item (spec §"Well-known payload dimension names"):
  // the item lives under the alias type-UUID container, the alias STRING is item.value
  // (case-insensitive), and it points at its target via payload.targetId. payload.assignedBy
  // scopes it to an owning entity (null = unscoped); membership-graph visibility resolution
  // is deferred (see plan) — resolveAlias returns the matching target as before.
  // setAlias/resolveAlias/listAliases/removeAlias keep their signatures; no `aliases` table.
  async resolveAlias(alias: any) {
    const table = objTableName(BUILT_IN_TYPE_ID_BY_NAME['alias']);
    try {
      const { rows } = await this._exec(
        `SELECT a.target_id FROM items i JOIN "${table}" a ON a.item_id = i.id
         WHERE i.type = 'alias' AND lower(i.value) = $1 AND i.deleted_at IS NULL
         ORDER BY (a.assigned_by IS NULL) DESC, i.created_at LIMIT 1`,
        [String(alias).toLowerCase()],
      );
      return rows[0]?.target_id ?? null;
    } catch {
      return null;
    }
  }

  async resolve(idOrAlias: any) {
    if (UUID_RE.test(idOrAlias)) return this.get(idOrAlias);
    const id = await this.resolveAlias(idOrAlias);
    return id ? this.get(id) : null;
  }

  async setAlias(alias: any, id: any) {
    const value       = String(alias).toLowerCase();
    const aliasTypeId = BUILT_IN_TYPE_ID_BY_NAME['alias'];
    const table       = objTableName(aliasTypeId);
    const payload     = {
      targetId: id, assignedBy: null, provisional: false,
      confirmedAt: new Date().toISOString(), computedFromFormulaId: null,
    };
    // Upsert the default (unscoped) alias for this string — preserves the prior
    // one-target-per-string behaviour of setAlias.
    let existingId: any = null;
    try {
      const { rows } = await this._exec(
        `SELECT i.id FROM items i JOIN "${table}" a ON a.item_id = i.id
         WHERE i.type = 'alias' AND lower(i.value) = $1 AND a.assigned_by IS NULL
           AND i.deleted_at IS NULL LIMIT 1`,
        [value],
      );
      existingId = rows[0]?.id ?? null;
    } catch { /* obj_<alias> not materialised yet */ }

    if (existingId) {
      await this.writeObjectJson(existingId, aliasTypeId, payload);
    } else {
      await this.create({ type: 'alias', parentId: aliasTypeId, value, owner: this.config.owner, objectData: payload });
    }
  }

  async removeAlias(alias: any) {
    const { rows } = await this._exec(
      `SELECT id FROM items WHERE type = 'alias' AND lower(value) = $1 AND deleted_at IS NULL`,
      [String(alias).toLowerCase()],
    );
    for (const r of rows) await this.delete(r.id);
  }

  async listAliases() {
    const table = objTableName(BUILT_IN_TYPE_ID_BY_NAME['alias']);
    try {
      const { rows } = await this._exec(
        `SELECT i.value AS alias, a.target_id FROM items i JOIN "${table}" a ON a.item_id = i.id
         WHERE i.type = 'alias' AND i.deleted_at IS NULL ORDER BY i.value`,
      );
      return rows.map((r: any) => ({ alias: r.alias, targetId: r.target_id }));
    } catch {
      return [];
    }
  }

  // ─── Annotations ─────────────────────────────────────────────────────────────

  // An annotation is a payload-dimension item (spec §"Well-known payload dimension
  // names"): the item lives under the annotation type-UUID container, associates with
  // its target via payload.targetId, and threads via payload.parentAnnotationId. The
  // author is the item's createdBy, the timestamp is createdAt, and item.value mirrors
  // the body. annotate()/annotations() keep their signatures — they now create/read
  // `annotation` items projected to obj_<annotation-type>; there is no `annotations` table.
  async annotate(targetId: any, { author, content, parentAnnotationId = null }: any = {}) {
    const actor = author || this.config.owner;
    const item = await this.create({
      type: 'annotation',
      parentId: BUILT_IN_TYPE_ID_BY_NAME['annotation'],
      value: content,
      owner: actor,
      createdBy: actor,
      objectData: { targetId, body: content, parentAnnotationId },
    });
    return {
      id:                 item.id,
      targetId,
      author:             item.createdBy,
      content,
      createdAt:          item.createdAt,
      parentAnnotationId,
    };
  }

  async annotations(targetId: any) {
    const table = objTableName(BUILT_IN_TYPE_ID_BY_NAME['annotation']);
    try {
      const { rows } = await this._exec(
        `SELECT i.id, i.created_at, i.created_by, a.target_id, a.body, a.parent_annotation_id
         FROM items i JOIN "${table}" a ON a.item_id = i.id
         WHERE i.type = 'annotation' AND a.target_id = $1 AND i.deleted_at IS NULL
         ORDER BY i.created_at, i.id`,
        [targetId],
      );
      return rows.map((r: any) => ({
        id:                 r.id,
        targetId:           r.target_id,
        author:             r.created_by,
        content:            r.body,
        createdAt:          r.created_at?.toISOString(),
        parentAnnotationId: r.parent_annotation_id,
      }));
    } catch {
      // obj_<annotation> not materialised yet (no annotations created) → none.
      return [];
    }
  }

  // ─── Relationships ────────────────────────────────────────────────────────────

  // Create a typed relationship. A relationship is a first-class `relationship`
  // item (spec §relationshipPayload — no bespoke `relationships` table): its
  // payload {typeId, sourceId, targetId, data, confidence, note} projects to
  // obj_<relationship>. The string API is preserved: `type` is a slug resolved to
  // its relationship-type item UUID (payload.typeId). The AGE edge is an additive
  // perf_ mirror; a graph error never fails the authoritative SQL write.
  async relate(sourceId: any, type: any, targetId: any, { createdBy, note = null }: any = {}) {
    const validTypes = this._relTypesCache ?? BUILT_IN_REL_TYPES;
    if (!validTypes.includes(type))
      throw new Error(`Invalid relationship type: ${type}. Valid: ${validTypes.join(', ')}`);
    const typeId = this._relTypeIdByName.get(type) ?? null;
    const id     = crypto.randomUUID();
    const now    = new Date();
    const actor  = createdBy || this.config.owner;
    const relPath = `${ROOT_ID}/${TYPES_CONTAINER_ID}/${RELATIONSHIP_TYPE_ID}/${id}`;
    // The relationship item lives under the relationship type container (universal
    // placement rule); item.value is the slug label, item.type_id is the
    // relationship type (334ea5f6) so it projects to / counts against obj_<relationship>.
    await this._exec(
      `INSERT INTO items (id, spec_version, parent_id, path, value, type, type_id, owner,
         license, sort_order, created_at, modified_at, created_by, modified_by)
       VALUES ($1,$2,$3,$4,$5,'relationship',$6,$7,$8,0,$9,$9,$7,$7)`,
      [id, specVersion, RELATIONSHIP_TYPE_ID, relPath, type, RELATIONSHIP_TYPE_ID,
       actor, DEFAULT_LICENSE, now],
    );
    await this._ensureProjection(RELATIONSHIP_TYPE_ID);
    await this.writeObjectJson(id, RELATIONSHIP_TYPE_ID, {
      typeId, sourceId, targetId, data: null, confidence: null, note,
    });
    await this._snapshot(id, 'create', actor, now);
    await this._projectRelationshipToGraph({ id, sourceId, targetId, type });
    return { id, sourceId, targetId, type, createdAt: now.toISOString(), createdBy: actor, note };
  }

  // Retract a relationship by hard-deleting its item (its obj_<relationship> row
  // cascades via the item_id FK) and its mirrored AGE edge. Returns true if an
  // item was removed. Endpoint items are never touched (spec §relationshipPayload).
  async unrelate(id: any) {
    const { rowCount } = await this._exec(
      `DELETE FROM items WHERE id = $1 AND type = 'relationship'`, [id],
    );
    await this._unprojectRelationshipFromGraph(id);
    if ((rowCount ?? 0) > 0) await this._dropProjectionIfEmpty(RELATIONSHIP_TYPE_ID);
    return (rowCount ?? 0) > 0;
  }

  async relationships(id: any) {
    const relObj = objTableName(RELATIONSHIP_TYPE_ID);
    try {
      const { rows: out } = await this._exec(
        `SELECT o.item_id AS id, o.source_id, o.target_id, rt.value AS type, o.note,
                i.created_at, i.created_by
           FROM "${relObj}" o
           JOIN items i        ON i.id = o.item_id
           LEFT JOIN items rt  ON rt.id = o.type_id
          WHERE o.source_id = $1 AND i.deleted_at IS NULL
          ORDER BY i.created_at`, [id],
      );
      const { rows: inn } = await this._exec(
        `SELECT o.item_id AS id, o.source_id, o.target_id, rt.value AS type, o.note,
                i.created_at, i.created_by
           FROM "${relObj}" o
           JOIN items i        ON i.id = o.item_id
           LEFT JOIN items rt  ON rt.id = o.type_id
          WHERE o.target_id = $1 AND i.deleted_at IS NULL
          ORDER BY i.created_at`, [id],
      );
      return {
        outbound: out.map(r => ({ id: r.id, targetId: r.target_id, type: r.type, createdAt: r.created_at?.toISOString(), createdBy: r.created_by, note: r.note })),
        inbound:  inn.map(r => ({ id: r.id, sourceId: r.source_id, type: r.type, createdAt: r.created_at?.toISOString(), createdBy: r.created_by, note: r.note })),
      };
    } catch {
      // obj_<relationship> not materialised yet (no relationships created) → none.
      return { outbound: [], inbound: [] };
    }
  }

  async backlinks(id: any) {
    const { rows } = await this._exec(
      'SELECT source_id FROM perf_backlinks WHERE target_id = $1', [id],
    );
    return rows.map(r => r.source_id);
  }

  async listRelationships() {
    const relObj = objTableName(RELATIONSHIP_TYPE_ID);
    try {
      const { rows } = await this._exec(
        `SELECT o.item_id AS id, o.source_id, o.target_id, rt.value AS type, o.note,
                i.created_at, i.created_by
           FROM "${relObj}" o
           JOIN items i        ON i.id = o.item_id
           LEFT JOIN items rt  ON rt.id = o.type_id
          WHERE i.deleted_at IS NULL
          ORDER BY i.created_at`,
      );
      return rows.map(r => ({
        id: r.id, sourceId: r.source_id, targetId: r.target_id,
        type: r.type, createdAt: r.created_at?.toISOString(), createdBy: r.created_by, note: r.note,
      }));
    } catch {
      return [];
    }
  }

  // ─── History ─────────────────────────────────────────────────────────────────

  async history(id: any) {
    const { rows } = await this._exec(
      `SELECT * FROM item_history WHERE item_id = $1 ORDER BY snapshot_at`, [id],
    );
    return rows.map(r => ({
      ...r.snapshot,
      snapshotAt: r.snapshot_at?.toISOString(),
      changedBy:  r.changed_by,
      changeType: r.change_type,
    }));
  }

  // ─── Tree / navigation ───────────────────────────────────────────────────────

  async children(parentId: any, aspect: any = undefined) {
    if (aspect === undefined) {
      // No aspect filter: return all children (aspect IS NULL)
      const { rows } = await this._exec(
        `SELECT * FROM items WHERE parent_id = $1 AND id != $1 AND aspect IS NULL
         ORDER BY sort_order`,
        [parentId],
      );
      return rows.map(rowToItem);
    }
    if (aspect === null) {
      // Explicit null: only items with no aspect (same as above for normal use)
      const { rows } = await this._exec(
        `SELECT * FROM items WHERE parent_id = $1 AND id != $1 AND aspect IS NULL
         ORDER BY sort_order`,
        [parentId],
      );
      return rows.map(rowToItem);
    }
    // Named aspect filter
    const { rows } = await this._exec(
      `SELECT * FROM items WHERE parent_id = $1 AND id != $1 AND aspect = $2
       ORDER BY sort_order`,
      [parentId, aspect],
    );
    return rows.map(rowToItem);
  }

  async ancestors(id: any) {
    const { rows } = await this._exec('SELECT path FROM items WHERE id = $1', [id]);
    if (!rows.length || !rows[0].path) return [];
    const segments    = rows[0].path.split('/');
    const ancestorIds = segments.slice(0, -1);
    if (!ancestorIds.length) return [];
    const placeholders = ancestorIds.map((_: any, i: number) => `$${i + 1}`).join(', ');
    const { rows: aRows } = await this._exec(
      `SELECT * FROM items WHERE id IN (${placeholders})`, ancestorIds,
    );
    const byId = new Map(aRows.map(r => [r.id, rowToItem(r)]));
    return ancestorIds.map((aid: any) => byId.get(aid)).filter(Boolean);
  }

  async subtreeCount(rootId: any) {
    const { rows } = await this._exec('SELECT path FROM items WHERE id = $1', [rootId]);
    if (!rows.length || !rows[0].path) return 0;
    const rootPath = rows[0].path;
    const { rows: cnt } = await this._exec(
      'SELECT COUNT(*) AS n FROM items WHERE path = $1 OR path LIKE $2',
      [rootPath, rootPath + '/%'],
    );
    return parseInt(cnt[0].n) || 0;
  }

  async tree(rootId: any, maxDepth: any = Infinity) {
    if (!rootId) {
      rootId = ROOT_ID;
    }

    const { rows: rootRows } = await this._exec(
      'SELECT path FROM items WHERE id = $1', [rootId],
    );
    if (!rootRows.length) return [];

    const rootPath = rootRows[0].path;

    // Fall back to recursive CTE if path not populated (migration safety).
    if (!rootPath) return this._treeSlow(rootId, maxDepth);

    const rootDepth = this._pathDepth(rootPath);
    let rows;

    if (maxDepth === Infinity) {
      const { rows: r } = await this._exec(
        `SELECT * FROM items WHERE path = $1 OR path LIKE $2 ORDER BY path`,
        [rootPath, rootPath + '/%'],
      );
      rows = r;
    } else {
      const maxSlashes = rootDepth + maxDepth;
      const { rows: r } = await this._exec(
        `SELECT * FROM items
         WHERE (path = $1 OR path LIKE $2)
           AND (LENGTH(path) - LENGTH(REPLACE(path, '/', ''))) <= $3
         ORDER BY path`,
        [rootPath, rootPath + '/%', maxSlashes],
      );
      rows = r;
    }

    const items   = rows.map(rowToItem);
    const pathMap = new Map(rows.map(r => [r.id, r.path]));

    // Build parent→children map and DFS-traverse for deterministic order.
    const byParent = new Map<any, any>();
    for (const item of items) {
      if (item.id === item.parentId) continue; // root is self-parented — never nest it under itself
      const pid = item.parentId;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(item);
    }
    for (const children of byParent.values()) {
      children.sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    }

    const itemById = new Map(items.map(item => [item.id, item]));
    const result: any[] = [];
    const visit    = (id: any, depth: any) => {
      const item = itemById.get(id);
      if (item) result.push({ item, depth });
      for (const child of (byParent.get(id) || [])) visit(child.id, depth + 1);
    };
    visit(rootId, 0);
    return result;
  }

  async _treeSlow(rootId: any, maxDepth: any = Infinity) {
    const depthLimit = Number.isFinite(maxDepth) ? maxDepth : 100;
    const { rows } = await this._exec(
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

  // ─── Queries ──────────────────────────────────────────────────────────────────

  async byTag(tag: any) {
    const { rows } = await this._exec(
      'SELECT id FROM items WHERE $1 = ANY(tags)', [tag],
    );
    return rows.map(r => r.id);
  }

  async byType(typeId: any) {
    const { rows } = await this._exec(
      'SELECT id FROM items WHERE type_id = $1', [typeId],
    );
    return rows.map(r => r.id);
  }

  // Look up a single item by its external-source key. (source_system,
  // source_external_id) is UNIQUE (migration 020), so this is the idempotency
  // primitive for ingestion — the Postgres peer of the filesystem adapter's
  // bySource: upsert = bySource() ? update() : create(). Returns the read-model
  // item or null.
  async bySource(sourceSystem: any, sourceExternalId: any) {
    if (!sourceSystem || !sourceExternalId) return null;
    const { rows } = await this._exec(
      'SELECT * FROM items WHERE source_system = $1 AND source_external_id = $2 LIMIT 1',
      [sourceSystem, sourceExternalId],
    );
    return rows.length ? rowToItem(rows[0]) : null;
  }

  async loadAll() {
    const { rows } = await this._exec('SELECT * FROM items ORDER BY sort_order');
    return rows.map(rowToItem);
  }

  // List every registered type definition (id + value), ordered by name. This is
  // the pg parity of the sqlite-fs `_listTypeDefs` — kanecta-api's GraphQL schema
  // builder (loadTypeItems) and the `/types` endpoint call it through the
  // Datastore facade, so a Postgres-backed working set needs it too. Soft-deleted
  // types are excluded: a deleted type must not generate GraphQL schema.
  async _listTypeDefs() {
    const { rows } = await this._exec(
      `SELECT id, value FROM items WHERE type = 'type' AND deleted_at IS NULL ORDER BY value`,
    );
    return rows;
  }

  async resolveTypeId(name: any) {
    if (!name) return { unknown: true };
    if (BUILT_IN_TYPES.has(name)) return { primitive: true };
    const { rows } = await this._exec(
      `SELECT id FROM items WHERE value = $1 AND type = 'type' LIMIT 1`, [name],
    );
    if (rows.length) return { id: rows[0].id };
    return { unknown: true };
  }

  async query({
    type, where, rootId, sort, limit,
    strictTypes, includeDeleted, expiredOnly, excludeExpired,
  }: any = {}) {
    const conditions = [];
    const params     = [];
    let   p          = 1;
    let   typeWarning: any = null;

    if (type) {
      const resolved = await this.resolveTypeId(type);
      if ((resolved as any).unknown) {
        if (strictTypes) throw new UnknownTypeError(type);
        typeWarning = `unknown type "${type}" — not a registered type definition; run \`kanecta doctor\``;
      }
    }

    // Soft-delete filter
    if (!includeDeleted) conditions.push('deleted_at IS NULL');

    // Expiry filters
    if (expiredOnly) {
      conditions.push(`expires_at IS NOT NULL AND expires_at < NOW()`);
    } else if (excludeExpired) {
      conditions.push(`(expires_at IS NULL OR expires_at >= NOW())`);
    }

    // rootId scoping — use path index if available, fall back to CTE
    if (rootId) {
      const rootPath = await this._getPath(rootId);
      if (rootPath) {
        conditions.push(`(path = $${p} OR path LIKE $${p + 1})`);
        params.push(rootPath, rootPath + '/%'); p += 2;
      } else {
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
    }

    if (type && typeWarning) {
      // Unknown type (non-strict): it matches nothing — return an empty set
      // with the warning attached, rather than silently ignoring the filter.
      conditions.push('FALSE');
    } else if (type) {
      conditions.push(
        `(type = $${p} OR (type = 'object' AND type_id IN (SELECT id FROM items WHERE value = $${p} AND type = 'type')))`,
      );
      params.push(type); p++;
    }

    const whereClause = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await this._exec(
      `SELECT * FROM items${whereClause}`, params,
    );
    let items = rows.map(rowToItem);

    // where clause: in-JS filtering on objectData fields
    if (where && Object.keys(where).length) {
      const withData = await Promise.all(items.map(async (item: any) => {
        // type_id is the projection key for user objects AND structured built-ins.
        if (!item.typeId) return { ...item, objectData: null };
        const objectData = await this.readObjectJson(item.id, item.typeId);
        return { ...item, objectData };
      }));
      items = withData.filter((item: any) => {
        if (!item.objectData) return false;
        for (const [field, predicate] of Object.entries<any>(where)) {
          const fv = item.objectData[field];
          const op = predicate?.op ?? '=';
          const ev = predicate?.value ?? predicate;
          if (op === '='        && fv !== ev) return false;
          if (op === '!='       && fv === ev) return false;
          if (op === 'in'       && !ev?.includes(fv)) return false;
          if (op === 'contains' && !String(fv ?? '').toLowerCase().includes(String(ev).toLowerCase())) return false;
          if (op === '>'        && !(fv > ev)) return false;
          if (op === '<'        && !(fv < ev)) return false;
        }
        return true;
      });
    }

    if (sort?.field) {
      const { field, dir = 'asc' } = sort;
      const desc = dir.toLowerCase() === 'desc';
      items.sort((a: any, b: any) => {
        const va = a[field] ?? a.objectData?.[field] ?? null;
        const vb = b[field] ?? b.objectData?.[field] ?? null;
        if (va === null) return desc ? -1 : 1;
        if (vb === null) return desc ? 1 : -1;
        return va < vb ? (desc ? 1 : -1) : va > vb ? (desc ? -1 : 1) : 0;
      });
    }

    const finalLimit = limit > 0 ? limit : (limit === undefined ? 50 : 0);
    const result = finalLimit > 0 ? items.slice(0, finalLimit) : items;

    if (typeWarning) {
      Object.defineProperty(result, 'warning', { value: typeWarning, enumerable: false, configurable: true });
    }
    return result;
  }

  // ─── Full-text search ─────────────────────────────────────────────────────────

  async search(query: any, { rootId = null, limit = 10 }: any = {}) {
    const { rows } = await this._exec(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM items WHERE id = $2
         UNION ALL
         SELECT i.id FROM items i JOIN subtree s ON i.parent_id = s.id AND i.id != i.parent_id
       )
       SELECT i.*, ts_rank(si.tsv, plainto_tsquery('english', $1)) AS rank
       FROM items i
       JOIN perf_search si ON si.item_id = i.id
       WHERE si.tsv @@ plainto_tsquery('english', $1)
         AND ($2::uuid IS NULL OR i.id IN (SELECT id FROM subtree))
       ORDER BY rank DESC
       LIMIT $3`,
      [query, rootId, limit],
    );
    return rows.map(rowToItem);
  }

  // ─── Object data (obj_* tables) ───────────────────────────────────────────────

  async readObjectJson(id: any, typeId?: any) {
    if (!typeId) {
      const item = await this.get(id);
      typeId = item?.typeId;
    }
    if (!typeId) return null;
    const table = objTableName(typeId);
    try {
      const result = await this._execTry(
        `SELECT * FROM "${table}" WHERE item_id = $1`, [id],
      );
      if (!result.rows[0]) return null;
      // The compiler maps jsonSchema `integer` to BIGINT, which node-pg returns
      // as a string; coerce those columns back to numbers so the payload keeps
      // its JS types. (int4/float8/bool/arrays already come back correctly.)
      const oidByCol: Record<string, number> = {};
      for (const f of result.fields) oidByCol[f.name] = (f as any).dataTypeID;
      const { item_id, ...rest } = result.rows[0]; // eslint-disable-line no-unused-vars
      return Object.fromEntries(
        Object.entries(rest).map(([k, v]) => {
          const val = (typeof v === 'string' && oidByCol[k] === 20) ? Number(v) : v;
          return [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), val];
        }),
      );
    } catch { return null; }
  }

  // Validate a typed object's payload against its type's jsonSchema before it is
  // persisted. Skips silently when the type has no resolvable jsonSchema (nothing
  // to validate against). Throws a PayloadValidationError on a schema violation so
  // invalid typed objects never reach the obj_<typeId> table.
  async _validateObjectPayload(typeId: any, data: any) {
    if (!typeId || data == null) return;
    const typeJson = await this.readTypeJson(typeId);
    if (!typeJson || typeof typeJson.jsonSchema !== 'object') return;
    const result = validateItem(data, typeJson);
    if (!result.valid) {
      const err: any = new Error(
        `Object payload failed validation for type ${typeId}: ` +
        result.errors.map((e: any) => `${e.path || '(root)'}: ${e.message}`).join('; '),
      );
      err.name = 'PayloadValidationError';
      err.code = 'INVALID_PAYLOAD';
      err.validationErrors = result.errors;
      throw err;
    }
  }

  async writeObjectJson(id: any, typeId?: any, data?: any) {
    // Support both the adapter form (id, typeId, data) and the Datastore facade's
    // (id, data): when `data` is omitted the second arg IS the payload, and the
    // typeId is looked up from the item (mirrors readObjectJson). Without this,
    // every facade caller — the API's object-write endpoints, connectorEngine —
    // silently no-ops against Postgres (the payload lands in `typeId`).
    if (data === undefined) { data = typeId; typeId = undefined; }
    if (!typeId) {
      const item = await this.get(id);
      typeId = item?.typeId;
    }
    if (!typeId) return;
    await this._validateObjectPayload(typeId, data);
    const table        = objTableName(typeId);
    const camelToSnake = (s: string) => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    const entries      = Object.entries(data).map(([k, v]) => [camelToSnake(k), v]);
    const cols         = entries.map(([k]) => `"${k}"`).join(', ');
    const vals         = entries.map(([, v]) => v);
    const sets         = entries.map(([k], i) => `"${k}" = $${i + 2}`).join(', ');
    const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
    try {
      await this._exec(
        `INSERT INTO "${table}" (item_id, ${cols}) VALUES ($1, ${placeholders})
         ON CONFLICT (item_id) DO UPDATE SET ${sets}`,
        [id, ...vals],
      );
    } catch (e: any) {
      // Only tolerate a genuinely-missing projection table (42P01): the payload
      // just isn't projected. Any OTHER error (unique/constraint violation,
      // not-null, type mismatch) is real — swallowing it here would leave the
      // enclosing transaction ABORTED (so every later statement fails with
      // "current transaction is aborted…") and orphan the items row. Propagate it
      // so the write rolls back cleanly and the caller gets a proper error.
      if (e?.code === '42P01') {
        console.warn(`writeObjectJson: table ${table} not found for type ${typeId}:`, e.message);
        return;
      }
      throw e;
    }
  }

  // ─── Function data ───────────────────────────────────────────────────────────

  // A function's payload is projected exactly like any other type (the four-table
  // law): scalars live on obj_<function-type>; its parameters / generic type
  // parameters / declared throws are `parameter` / `type-parameter` /
  // `function-throw` children (ordered by item.sortOrder); its bundleHash open
  // map is `property` children (item.value = runtime name, payload.value = hash).
  // readFunctionJson / writeFunctionJson keep their original signatures — they are
  // the sole reader/writer of the whole nested payload — but the four bespoke
  // `function*` tables are gone.
  async readFunctionJson(id: any) {
    const scalars: any = await this.readObjectJson(id, BUILT_IN_TYPE_ID_BY_NAME['function']);

    const { rows: kids } = await this._exec(
      `SELECT id, value, type FROM items
        WHERE parent_id = $1 AND deleted_at IS NULL
          AND type = ANY($2) ORDER BY sort_order`,
      [id, ['parameter', 'type-parameter', 'function-throw', 'property']],
    );

    const parameters: any[]     = [];
    const typeParameters: any[] = [];
    const throws: any[]         = [];
    const bundleHash: Record<string, any> = {};
    let   hasBundleHash = false;

    for (const k of kids) {
      if (k.type === 'parameter') {
        const p = (await this.readObjectJson(k.id, BUILT_IN_TYPE_ID_BY_NAME['parameter'])) ?? {};
        const out: any = { name: p.name };
        if (p.type != null)         out.type = p.type;
        if (p.typeId != null)       out.typeId = p.typeId;
        if (p.functionId != null)   out.functionId = p.functionId;
        if (p.optional)             out.optional = true;
        if (p.rest)                 out.rest = true;
        if (p.defaultValue != null) out.defaultValue = p.defaultValue;
        if (p.description != null)  out.description = p.description;
        parameters.push(out);
      } else if (k.type === 'type-parameter') {
        const tp = (await this.readObjectJson(k.id, BUILT_IN_TYPE_ID_BY_NAME['type-parameter'])) ?? {};
        const out: any = { name: tp.name };
        if (tp.constraint != null)  out.constraint = tp.constraint;
        if (tp.defaultType != null) out.default = tp.defaultType;
        typeParameters.push(out);
      } else if (k.type === 'function-throw') {
        const t = (await this.readObjectJson(k.id, BUILT_IN_TYPE_ID_BY_NAME['function-throw'])) ?? {};
        const out: any = { type: t.type };
        if (t.description != null)  out.description = t.description;
        throws.push(out);
      } else if (k.type === 'property') {
        const pr = (await this.readObjectJson(k.id, BUILT_IN_TYPE_ID_BY_NAME['property'])) ?? {};
        bundleHash[k.value] = pr.value;
        hasBundleHash = true;
      }
    }

    // "Not set" = never written: no scalar values AND no children. create() lands
    // an all-null obj_<function> row for a bare function item; that must still read
    // as null until writeFunctionJson populates it.
    const hasScalars = scalars && Object.values(scalars).some(v => v != null);
    if (!hasScalars && !parameters.length && !typeParameters.length && !throws.length && !hasBundleHash)
      return null;

    const result: any = {};
    result.runtime = scalars?.runtime ?? 'typescript';
    if (scalars?.description != null)         result.description = scalars.description;
    if (scalars?.async)                       result.async = true;
    if (scalars?.ai)                          result.ai = true;
    if (scalars?.skillId != null)             result.skill = scalars.skillId;
    if (typeParameters.length)                result.typeParameters = typeParameters;
    result.parameters = parameters;
    if (scalars?.returnType != null)          result.returnType = scalars.returnType;
    if (scalars?.returnTypeId != null)        result.returnTypeId = scalars.returnTypeId;
    if (throws.length)                        result.throws = throws;
    if (scalars?.deprecated != null)          result.deprecated = scalars.deprecated;
    if (scalars?.body != null)                result.body = scalars.body;
    if (scalars?.includeKanectaSdk === false) result.includeKanectaSdk = false;
    if (scalars?.dependencies?.length)        result.dependencies = scalars.dependencies;
    if (hasBundleHash)                        result.bundleHash = bundleHash;
    return result;
  }

  async writeFunctionJson(id: any, data: any) {
    const {
      runtime = 'typescript',
      description = null, async: isAsync = false, ai = false, skill = null,
      typeParameters = [], parameters = [], returnType = null, returnTypeId = null,
      throws = [], deprecated = null, body = null, includeKanectaSdk = true,
      dependencies = [], bundleHash = null,
    } = data;

    const functionTypeId = BUILT_IN_TYPE_ID_BY_NAME['function'];
    await this._ensureProjection(functionTypeId);
    await this.writeObjectJson(id, functionTypeId, {
      runtime, description,
      async: isAsync, ai,
      skillId: skill,
      returnType, returnTypeId,
      deprecated, body, includeKanectaSdk,
      dependencies,
    });

    await this._replaceFunctionChildren(id, { parameters, typeParameters, throws, bundleHash });
  }

  // Regenerate the function's typed children wholesale from `data`. Existing
  // parameter / type-parameter / function-throw / property children are hard-
  // deleted (their obj_ rows cascade) and re-created in order. Each child is a
  // real item with its own obj_<childType> projection — the array-of-objects and
  // open-map fields are normalised into children, never inline columns.
  async _replaceFunctionChildren(id: any, { parameters, typeParameters, throws, bundleHash }: any) {
    const { rows: existing } = await this._exec(
      `SELECT id FROM items WHERE parent_id = $1
         AND type = ANY($2)`,
      [id, ['parameter', 'type-parameter', 'function-throw', 'property']],
    );
    for (const r of existing) await this.delete(r.id);

    const owner = this.config.owner;
    const mk = async (type: string, value: any, i: number, objectData: any) =>
      this.create({ parentId: id, type, value, sortOrder: i, owner, objectData });

    for (const [i, p] of parameters.entries()) {
      await mk('parameter', p.name ?? null, i, {
        name: p.name,
        type: p.type ?? null,
        typeId: p.typeId ?? null,
        functionId: p.functionId ?? null,
        optional: p.optional ?? null,
        rest: p.rest ?? null,
        defaultValue: p.defaultValue ?? null,
        description: p.description ?? null,
      });
    }
    for (const [i, tp] of typeParameters.entries()) {
      await mk('type-parameter', tp.name ?? null, i, {
        name: tp.name,
        constraint: tp.constraint ?? null,
        defaultType: tp.default ?? null,
      });
    }
    for (const [i, t] of throws.entries()) {
      await mk('function-throw', t.type ?? null, i, {
        type: t.type,
        description: t.description ?? null,
      });
    }
    if (bundleHash && typeof bundleHash === 'object') {
      let i = 0;
      for (const [rt, hash] of Object.entries(bundleHash)) {
        await mk('property', rt, i++, { value: hash });
      }
    }
  }

  // ─── Connector queries ────────────────────────────────────────────────────────

  // All stub items (materialized=false) managed by a specific connector.
  async listStubs(connectorId: any) {
    const { rows } = await this._exec(
      `SELECT * FROM items
       WHERE connector_id = $1 AND materialized = false AND deleted_at IS NULL`,
      [connectorId],
    );
    return rows.map(rowToItem);
  }

  // All connector-managed items whose cached_at is older than beforeAt.
  // Used by ConnectorEngine to drive scheduled refresh.
  async listDueForRefresh(beforeAt: any) {
    const { rows } = await this._exec(
      `SELECT * FROM items
       WHERE connector_id IS NOT NULL AND cached_at < $1 AND deleted_at IS NULL`,
      [beforeAt],
    );
    return rows.map(rowToItem);
  }

  // ─── Time data ───────────────────────────────────────────────────────────────

  async getDocument(id: any) {
    const flat = await this.get(id);
    if (!flat) return null;
    const payload = (['object', 'type'].includes(flat.type))
      ? await this.readObjectJson(id, flat.typeId).catch(() => null)
      : null;
    const time = await this.readTimeJson(id).catch(() => null);
    return {
      item: {
        id: flat.id, parentId: flat.parentId, type: flat.type, typeId: flat.typeId ?? null,
        value: flat.value ?? null, sortOrder: flat.sortOrder ?? 0, aspect: flat.aspect ?? null,
      },
      meta: {
        specVersion: flat.specVersion, owner: flat.owner ?? null, license: flat.license ?? null,
        visibility: flat.visibility ?? 'private', confidence: flat.confidence ?? null,
        status: flat.status ?? null, tags: flat.tags ?? [], createdAt: flat.createdAt,
        modifiedAt: flat.modifiedAt, createdBy: flat.createdBy ?? null, modifiedBy: flat.modifiedBy ?? null,
        completedAt: flat.completedAt ?? null, dueAt: flat.dueAt ?? null,
        expiresAt: flat.expiresAt ?? null, deletedAt: flat.deletedAt ?? null,
        cachedAt: flat.cachedAt ?? null, connectorId: flat.connectorId ?? null,
        materialized: flat.materialized ?? null, files: flat.files ?? {},
        layer: flat.layer ?? null, sourceSystem: flat.sourceSystem ?? null,
        sourceExternalId: flat.sourceExternalId ?? null, icon: flat.icon ?? null,
      },
      payload: payload ?? null,
      time: time && Object.keys(time).length > 0 ? time : null,
    };
  }

  async readTimeJson(id: any) {
    const { rows } = await this._exec('SELECT time_data FROM items WHERE id = $1', [id]);
    return rows[0]?.time_data ?? null;
  }

  async writeTimeJson(id: any, data: any) {
    await this._exec(
      'UPDATE items SET time_data = $1 WHERE id = $2', [data, id],
    );
  }

  async deleteTimeJson(id: any) {
    await this._exec('UPDATE items SET time_data = NULL WHERE id = $1', [id]);
  }

  async readScheduleJson(id: any) {
    const { rows } = await this._exec('SELECT schedule_data FROM items WHERE id = $1', [id]);
    return rows[0]?.schedule_data ?? null;
  }

  async writeScheduleJson(id: any, data: any) {
    await this._exec(
      'UPDATE items SET schedule_data = $1 WHERE id = $2', [data, id],
    );
  }

  // ─── Document type helpers ─────────────────────────────────────────────────

  // Stable UUID of the synthetic 'document' type item — seeded from
  // built-in-types/types/document.json and identical across all installations.
  static get DOCUMENT_TYPE_UUID() { return 'b4e2f1c3-a0d5-4e6f-8b9c-d7f2e1a3b5c0'; }

  // A document is projected like any other type (the four-table law): scalars live
  // on obj_<document-type>; its two nested maps are children —
  // expandState.exceptions → `document-expand-exception` ({itemId, depth}; depth −1
  // encodes the source `false` = collapse), roleMap.byDepth → `document-role-by-depth`
  // ({depth, role}), roleMap.byType → `document-role-by-type` ({key, role}).
  // expandState.defaultDepth is flattened onto the document scalar row. createDocument /
  // readDocumentPayload / writeDocumentPayload / listDocuments keep their signatures —
  // read/write reassemble the nested payload — so consumers (exportMarkdown, Studio) are
  // untouched. The `documents` JSONB table is gone (migration 031).
  async createDocument(targetId: any, name: any, {
    mode = null,
    expandState = null,
    roleMap = null,
    isOrgDefault = false,
    baseDocumentId = null,
    owner, visibility = 'private',
  }: any = {}) {
    if (!targetId) throw new Error('createDocument: targetId is required');
    if (!name)     throw new Error('createDocument: name is required');
    const item = await this.create({
      type: 'document',
      parentId: PostgresAdapter.DOCUMENT_TYPE_UUID,
      value: name,
      owner,
      visibility,
    });
    const payload: any = {
      targetId,
      name,
      expandState: expandState ?? { defaultDepth: 2, exceptions: {} },
      roleMap: roleMap ?? { byDepth: { '1': 'heading', '2': 'subheading', '3': 'body' }, byType: {} },
      isOrgDefault,
      baseDocumentId: baseDocumentId ?? null,
    };
    if (mode != null) payload.mode = mode;
    await this.writeDocumentPayload(item.id, payload);
    return item;
  }

  async readDocumentPayload(id: any) {
    const documentTypeId = BUILT_IN_TYPE_ID_BY_NAME['document'];
    const scalars: any = await this.readObjectJson(id, documentTypeId);
    // targetId is required on every real document; its absence means "no document
    // payload" (a non-document item, or the transient empty row create() leaves).
    if (!scalars || scalars.targetId == null) return null;

    const { rows: kids } = await this._exec(
      `SELECT id, type FROM items
        WHERE parent_id = $1 AND deleted_at IS NULL
          AND type = ANY($2) ORDER BY sort_order`,
      [id, ['document-expand-exception', 'document-role-by-depth', 'document-role-by-type']],
    );

    const exceptions: Record<string, any> = {};
    const byDepth: Record<string, any>    = {};
    const byType: Record<string, any>     = {};
    for (const k of kids) {
      if (k.type === 'document-expand-exception') {
        const e: any = (await this.readObjectJson(k.id, BUILT_IN_TYPE_ID_BY_NAME['document-expand-exception'])) ?? {};
        if (e.overrideItemId != null) exceptions[e.overrideItemId] = e.depth === -1 ? false : e.depth;
      } else if (k.type === 'document-role-by-depth') {
        const r: any = (await this.readObjectJson(k.id, BUILT_IN_TYPE_ID_BY_NAME['document-role-by-depth'])) ?? {};
        if (r.depth != null) byDepth[String(r.depth)] = r.role;
      } else if (k.type === 'document-role-by-type') {
        const r: any = (await this.readObjectJson(k.id, BUILT_IN_TYPE_ID_BY_NAME['document-role-by-type'])) ?? {};
        if (r.key != null) byType[r.key] = r.role;
      }
    }

    const out: any = { targetId: scalars.targetId, name: scalars.name };
    if (scalars.mode != null) out.mode = scalars.mode;
    out.expandState = {};
    if (scalars.defaultDepth != null) out.expandState.defaultDepth = scalars.defaultDepth;
    out.expandState.exceptions = exceptions;
    out.roleMap = { byDepth, byType };
    out.isOrgDefault = scalars.isOrgDefault ?? false;
    out.baseDocumentId = scalars.baseDocumentId ?? null;
    return out;
  }

  async writeDocumentPayload(id: any, payload: any) {
    const documentTypeId = BUILT_IN_TYPE_ID_BY_NAME['document'];
    await this._ensureProjection(documentTypeId);
    await this.writeObjectJson(id, documentTypeId, {
      targetId: payload?.targetId ?? null,
      name: payload?.name ?? null,
      mode: payload?.mode ?? null,
      defaultDepth: payload?.expandState?.defaultDepth ?? null,
      isOrgDefault: payload?.isOrgDefault ?? null,
      baseDocumentId: payload?.baseDocumentId ?? null,
    });
    await this._replaceDocumentChildren(id, payload);
  }

  // Regenerate a document's typed children wholesale from `payload` (mirrors the
  // function child-replacement). Existing exception / role children are hard-deleted
  // (obj_ rows cascade) and re-created in map order.
  async _replaceDocumentChildren(id: any, payload: any) {
    const { rows: existing } = await this._exec(
      `SELECT id FROM items WHERE parent_id = $1 AND type = ANY($2)`,
      [id, ['document-expand-exception', 'document-role-by-depth', 'document-role-by-type']],
    );
    for (const r of existing) await this.delete(r.id);

    const owner = this.config.owner;
    const mk = async (type: string, value: any, i: number, objectData: any) =>
      this.create({ parentId: id, type, value, sortOrder: i, owner, objectData });

    let i = 0;
    for (const [itemId, depth] of Object.entries(payload?.expandState?.exceptions ?? {})) {
      await mk('document-expand-exception', itemId, i++, {
        overrideItemId: itemId,
        depth: depth === false ? -1 : depth,
      });
    }
    i = 0;
    for (const [depthStr, role] of Object.entries(payload?.roleMap?.byDepth ?? {})) {
      await mk('document-role-by-depth', depthStr, i++, { depth: Number(depthStr), role });
    }
    i = 0;
    for (const [key, role] of Object.entries(payload?.roleMap?.byType ?? {})) {
      await mk('document-role-by-type', key, i++, { key, role });
    }
  }

  async listDocuments(targetId: any) {
    const table = objTableName(BUILT_IN_TYPE_ID_BY_NAME['document']);
    try {
      const { rows } = await this._exec(`
        SELECT i.*
        FROM items i
        JOIN "${table}" d ON d.item_id = i.id
        WHERE i.type = 'document'
          AND d.target_id = $1
          AND i.deleted_at IS NULL
        ORDER BY i.id
      `, [targetId]);
      return rows.map(rowToItem);
    } catch {
      // obj_<document> not materialised yet (no documents created) → none to list.
      return [];
    }
  }

  // Active schedule items whose next fire time is at or before beforeAt.
  async listDueSchedules(beforeAt: any) {
    const { rows } = await this._exec(
      "SELECT * FROM items WHERE type = 'schedule' AND status = 'active' AND due_at <= $1 AND deleted_at IS NULL",
      [beforeAt],
    );
    return rows.map(rowToItem);
  }

  // ─── Type definitions ─────────────────────────────────────────────────────────

  async createType(value: any, { schema, createdBy, id: explicitId }: any = {}) {
    const id    = explicitId || crypto.randomUUID();
    const now   = new Date();
    const owner = this.config.owner;
    const actor = createdBy || owner;

    await this._exec(
      `INSERT INTO items (id, spec_version, parent_id, path, value, type, owner, license, sort_order,
         created_at, modified_at, created_by, modified_by)
       VALUES ($1, $2, $1, $7, $3, 'type', $4, $5, 0, $6, $6, $4, $4)
       ON CONFLICT (id) DO NOTHING`,
      // $7 is the text `path` (a type item's path is its own id). It is a
      // separate parameter from $1 (uuid id/parent_id) so PG doesn't try to
      // deduce one type for a value used as both uuid and text.
      [id, specVersion, value.trim(), owner, DEFAULT_LICENSE, now, String(id)],
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

    const meta = resolvedSchema.meta ?? {};
    // The type registry is the type-type's own projection obj_<type-type> (spec
    // §cqrs-projections — no bespoke `types` table). This type's definition is a
    // row there. Ensure the registry table exists (idempotent; it already does
    // after init, since every built-in type seeds a row). The type's OWN instance
    // table obj_<thisTypeId> is NOT created here — a fresh type has zero instances
    // (N(T)=0), so per the spec invariant it projects no table until the first
    // live instance is written (_ensureProjection).
    await this._ensureProjection(TYPE_TYPE_ID);

    await this._exec(
      `INSERT INTO "${objTableName(TYPE_TYPE_ID)}" (
         item_id,
         meta_icon, meta_description, meta_details, meta_keywords, meta_tags,
         meta_primary_field, meta_ai_instructions_claude,
         meta_functions_consumed_by, meta_functions_produced_by,
         json_schema, sql_schema, sync, superseded_by, implements, extends, indexes
       ) VALUES (
         $1,
         $2, $3, $4, $5, $6,
         $7, $8,
         $9, $10,
         $11, $12, $13, $14, $15, $16, $17
       )
       ON CONFLICT (item_id) DO UPDATE SET
         meta_icon = $2, meta_description = $3, meta_details = $4, meta_keywords = $5, meta_tags = $6,
         meta_primary_field = $7, meta_ai_instructions_claude = $8,
         meta_functions_consumed_by = $9, meta_functions_produced_by = $10,
         json_schema = $11, sql_schema = $12, sync = $13, superseded_by = $14, implements = $15, extends = $16,
         indexes = $17`,
      [
        id,
        meta.icon ?? null, meta.description ?? '', meta.details ?? null, meta.keywords ?? null, meta.tags ?? null,
        meta.primaryField ?? null, meta.skills?.claude ?? null,
        meta.functions?.consumedBy ?? [], meta.functions?.producedBy ?? [],
        JSON.stringify(resolvedSchema.jsonSchema), resolvedSchema.sqlSchema ?? [],
        meta.sync ?? [], meta.supersededBy ?? [], meta.implements ?? [], meta.extends ?? [],
        JSON.stringify(resolvedSchema.indexes ?? []),
      ],
    );

    await this._snapshot(id, 'create', actor, now);
    const metadata = await this.get(id);
    return { metadata, schema: resolvedSchema };
  }

  // The type registry lives in obj_<type-type> (spec §cqrs-projections — no
  // bespoke `types` table). Read that projection; fall back to the legacy `types`
  // table only during the transition, before an authorised init has backfilled +
  // dropped it. obj_<type-type>'s columns match the legacy table 1:1 (by design of
  // the seed metaschema), so the reconstruction below is identical for both.
  async _readTypeRow(id: any) {
    const table = objTableName(TYPE_TYPE_ID);
    try {
      const { rows } = await this._execTry(`SELECT * FROM "${table}" WHERE item_id = $1`, [id]);
      if (rows[0]) return rows[0];
    } catch { /* obj_<type-type> not materialised yet — try legacy */ }
    try {
      const { rows } = await this._execTry('SELECT * FROM types WHERE item_id = $1', [id]);
      return rows[0] ?? null;
    } catch { return null; }   // legacy table already dropped
  }

  async readTypeJson(id: any) {
    const t = await this._readTypeRow(id);
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
    return { meta, jsonSchema: t.json_schema, sqlSchema: t.sql_schema ?? [], indexes: t.indexes ?? [] };
  }

  async writeTypeJson(id: any, data: any) {
    const meta = data.meta ?? {};
    await this._exec(
      `UPDATE "${objTableName(TYPE_TYPE_ID)}" SET
         meta_icon = $2, meta_description = $3, meta_details = $4, meta_keywords = $5, meta_tags = $6,
         meta_primary_field = $7, meta_ai_instructions_claude = $8,
         meta_functions_consumed_by = $9, meta_functions_produced_by = $10,
         json_schema = $11, sync = $12, superseded_by = $13, implements = $14, extends = $15, indexes = $16
       WHERE item_id = $1`,
      [
        id,
        meta.icon ?? null, meta.description ?? '', meta.details ?? null, meta.keywords ?? null, meta.tags ?? null,
        meta.primaryField ?? null, meta.skills?.claude ?? null,
        meta.functions?.consumedBy ?? [], meta.functions?.producedBy ?? [],
        JSON.stringify(data.jsonSchema), meta.sync ?? [], meta.supersededBy ?? [], meta.implements ?? [], meta.extends ?? [],
        JSON.stringify(data.indexes ?? []),
      ],
    );
  }

  async _attachObjectSearchTrigger(tableName: any) {
    // Idempotent + race-safe. The trigger always binds the same function (its body
    // is updated via CREATE OR REPLACE FUNCTION, never by re-attaching), so there is
    // no need to DROP+recreate. Two concurrent _ensureProjection calls for the same
    // fresh table used to race the old `DROP IF EXISTS` + `CREATE` pair — one CREATE
    // would hit "trigger already exists". Create-and-swallow-duplicate is atomic and
    // safe under concurrency.
    await this._exec(
      `DO $$
       BEGIN
         CREATE TRIGGER trg_object_search_vector
           AFTER INSERT OR UPDATE OR DELETE ON "${tableName}"
           FOR EACH ROW EXECUTE FUNCTION kanecta_update_object_search_vector();
       EXCEPTION WHEN duplicate_object THEN NULL;
       END $$`,
    );
  }

  // ─── Per-type table projection ────────────────────────────────────────────

  // Materialise `obj_<typeId>` (columns + declared indexes) if absent, derived
  // from the type's jsonSchema by @kanecta/schema-compiler, and attach the FTS
  // trigger. Idempotent (IF NOT EXISTS). Returns false when the type has no
  // stored definition (an orphan typeId) so callers skip the row write. A
  // malformed index declaration is skipped with a warning, never blocking the
  // instance write.
  async _ensureProjection(typeId: any): Promise<boolean> {
    // A meta-type's own columns cannot be derived from its own payload schema —
    // the schema describing the type that defines types is exactly what we would
    // be building (circular). `type` and `relationship-type` (which extends the
    // nested type payload) are both built from a flat SEED METASCHEMA instead
    // (rootPayload.seedMetaschema / the export-only relationshipTypeSeedMetaschema).
    // Every other type derives from its own def.
    const seed = SEED_METASCHEMA_BY_TYPE_ID[String(typeId)];
    const def = seed
      ? { jsonSchema: seed, indexes: [] }
      : await this.readTypeJson(typeId);
    if (!def || !def.jsonSchema) return false;   // orphan / schemaless type
    for (const stmt of deriveSqlSchema(def.jsonSchema, { typeId, dialect: 'postgres' }))
      await this._exec(guardDdl(stmt));
    try {
      for (const stmt of deriveIndexDdl(def.jsonSchema, def.indexes, { typeId, dialect: 'postgres' }))
        await this._exec(guardDdl(stmt));
    } catch (e: any) {
      console.warn(`[postgres] skipping indexes for type ${typeId}: ${e?.message ?? e}`);
    }
    await this._attachObjectSearchTrigger(objTableName(typeId));
    return true;
  }

  // Drop the type table when no non-hard-deleted instances remain. Unlike
  // sqlite-fs — where item.json + items_payload are the source of truth — the
  // Postgres obj_ table IS the payload store, so a soft-deleted instance's row
  // must persist there (a hard drop would lose the payload and break restore).
  // Hence N counts every remaining items row of the type (live OR soft-deleted);
  // the table is dropped only once the last one is hard-deleted / reassigned.
  async _dropProjectionIfEmpty(typeId: any) {
    // Count by type_id alone — the projection key. A structured built-in's
    // instances carry type_id but type='grant'/'query'/…, so filtering on
    // type='object' would under-count and drop a live table.
    // The type-type is the exception: type items are its instances but carry
    // type_id=NULL (type='type' is their identity), so count them by type.
    const { rows } = String(typeId) === TYPE_TYPE_ID
      ? await this._exec("SELECT COUNT(*)::int AS n FROM items WHERE type = 'type'")
      : await this._exec(
          'SELECT COUNT(*)::int AS n FROM items WHERE type_id = $1',
          [typeId],
        );
    if (!rows[0] || rows[0].n === 0)
      await this._exec(`DROP TABLE IF EXISTS "${objTableName(typeId)}"`);
  }

  // Every materialised per-type table in the current schema. Used by integrity
  // checks; mirrors the sqlite-fs handle surface.
  async listProjectedRelations() {
    const { rows } = await this._exec(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name LIKE 'obj\\_%'`,
    );
    return rows.map((r: any) => r.table_name);
  }

  // ─── Graph projection (Apache AGE) ───────────────────────────────────────────
  // Strictly ADDITIVE to the per-type table projection. When the Apache AGE
  // extension is available, relationships are mirrored into an AGE property graph
  // as edges between `Item` vertices, giving a traversal index (spec §"Graph
  // Projection (Apache AGE)"). Edge label = the relationship type upper-cased with
  // hyphens → underscores (`depends-on` → `DEPENDS_ON`); vertices carry the item's
  // `id` and `type`. Absent AGE, every method here is a silent no-op, so the
  // default (AGE-less) Postgres deployment is completely unaffected.
  //
  // MVP scope: vertices are created lazily for relationship endpoints only (an
  // isolated item adds nothing to a traversal index); full item↔vertex mirroring
  // and DB-trigger sync (spec) are left as follow-ups. Edges are keyed by the
  // relationship id so they can be retracted individually.

  // True once AGE has been probed and found installed on this database.
  get graphEnabled() { return this._ageAvailable === true; }

  // Escape a value for interpolation into a Cypher single-quoted string. Ids are
  // validated UUIDs and types are kebab-case, so this is defence-in-depth.
  _cypherLiteral(v: any) { return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  // Cypher edge label from a relationship type (`depends-on` → `DEPENDS_ON`).
  _edgeLabel(type: any) {
    const t = String(type);
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(t))
      throw new Error(`Cannot project relationship type "${type}" to a graph edge label`);
    return t.toUpperCase().replace(/-/g, '_');
  }

  // Probe (once, cached) whether AGE is installed, creating the extension if the
  // package is available. Returns false — never throws — when AGE is absent.
  async _ensureAgeExtension() {
    if (this._ageAvailable !== undefined) return this._ageAvailable;
    try {
      const { rows } = await this._exec(
        `SELECT 1 FROM pg_available_extensions WHERE name = 'age'`,
      );
      if (!rows.length) { this._ageAvailable = false; return false; }
      await this._exec(`CREATE EXTENSION IF NOT EXISTS age`);
      this._ageAvailable = true;
    } catch {
      this._ageAvailable = false;
    }
    return this._ageAvailable;
  }

  // The AGE graph is a global namespace, so derive its name from the adapter's
  // current schema to keep concurrent datastores (and per-run test schemas) from
  // colliding. `public` → `kg_public`.
  async _resolveGraphName() {
    if (this._graphName) return this._graphName;
    const { rows } = await this._exec(`SELECT current_schema() AS s`);
    const schema = (rows[0]?.s || 'public').replace(/[^a-zA-Z0-9_]/g, '_');
    this._graphName = `kg_${schema}`.slice(0, 63);
    return this._graphName;
  }

  // Run graph work on a DEDICATED connection: AGE needs `LOAD 'age'` and an
  // ag_catalog search_path, both of which are session state — running them on a
  // pooled connection would poison it for the adapter's schema-scoped queries. We
  // RESET on release so the connection returns to the pool clean.
  async _withGraphClient(fn: (client: any) => Promise<any>) {
    const client = await this._pool.connect();
    try {
      await client.query(`LOAD 'age'`);
      await client.query(`SET search_path = ag_catalog, "$user", public`);
      return await fn(client);
    } finally {
      try { await client.query('RESET search_path'); } catch { /* connection closing */ }
      client.release();
    }
  }

  // Ensure the AGE extension + graph exist. Returns false when AGE is unavailable.
  async _ensureGraph() {
    if (!(await this._ensureAgeExtension())) return false;
    if (this._graphReady) return true;
    const name = await this._resolveGraphName();
    const { rows } = await this._exec(
      `SELECT 1 FROM ag_catalog.ag_graph WHERE name = $1`, [name],
    );
    if (!rows.length) {
      await this._withGraphClient(c => c.query(`SELECT create_graph('${this._cypherLiteral(name)}')`));
    }
    this._graphReady = true;
    return true;
  }

  // Run a Cypher statement against the graph and return the raw agtype rows.
  async _cypher(cypher: string, columns = 'result agtype') {
    const name = await this._resolveGraphName();
    return this._withGraphClient(async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM ag_catalog.cypher('${this._cypherLiteral(name)}', $graph$ ${cypher} $graph$) AS (${columns})`,
      );
      return rows;
    });
  }

  async _projectRelationshipToGraph(rel: { id: any; sourceId: any; targetId: any; type: any }) {
    try {
      if (!(await this._ensureGraph())) return;
      // Look up endpoint types on the pooled (schema-scoped) connection BEFORE
      // entering the graph client, whose search_path can't see the items table.
      const { rows } = await this._exec(
        `SELECT id, type FROM items WHERE id = ANY($1::uuid[])`, [[rel.sourceId, rel.targetId]],
      );
      const typeOf = new Map(rows.map((r: any) => [r.id, r.type]));
      const src = this._cypherLiteral(rel.sourceId);
      const tgt = this._cypherLiteral(rel.targetId);
      const relId = this._cypherLiteral(rel.id);
      const label = this._edgeLabel(rel.type);
      const srcType = this._cypherLiteral(typeOf.get(rel.sourceId) ?? '');
      const tgtType = this._cypherLiteral(typeOf.get(rel.targetId) ?? '');
      await this._cypher(
        `MERGE (a:Item {id: '${src}'}) SET a.type = '${srcType}'
         MERGE (b:Item {id: '${tgt}'}) SET b.type = '${tgtType}'
         MERGE (a)-[e:${label} {id: '${relId}'}]->(b)
         RETURN e`,
      );
    } catch (e: any) {
      console.warn(`[postgres] graph projection failed for relationship ${rel.id}: ${e?.message ?? e}`);
    }
  }

  async _unprojectRelationshipFromGraph(relId: any) {
    try {
      if (!(await this._ensureGraph())) return;
      await this._cypher(
        `MATCH ()-[e {id: '${this._cypherLiteral(relId)}'}]->() DELETE e RETURN 1`,
      );
    } catch (e: any) {
      console.warn(`[postgres] graph unprojection failed for relationship ${relId}: ${e?.message ?? e}`);
    }
  }

  // Traverse the graph from an item. `direction`: 'out' (default) | 'in' | 'both';
  // optional `relType` filters by edge label. Returns the neighbour item ids.
  // No-op (empty array) when AGE is unavailable.
  async graphNeighbors(id: any, { direction = 'out', relType = null }: any = {}) {
    if (!(await this._ensureGraph())) return [];
    const label = relType ? `:${this._edgeLabel(relType)}` : '';
    const pattern =
      direction === 'in'   ? `<-[e${label}]-`
    : direction === 'both' ? `-[e${label}]-`
    :                        `-[e${label}]->`;
    const rows = await this._cypher(
      `MATCH (a:Item {id: '${this._cypherLiteral(id)}'})${pattern}(b:Item)
       RETURN DISTINCT b.id`,
      'id agtype',
    );
    // agtype string values arrive JSON-quoted (e.g. "\"<uuid>\"").
    return rows.map((r: any) => { try { return JSON.parse(r.id); } catch { return r.id; } });
  }

  // Count edges currently in the graph (0 when AGE is unavailable). Useful for
  // integrity checks and tests.
  async countProjectedGraphEdges() {
    if (!(await this._ensureGraph())) return 0;
    const rows = await this._cypher(`MATCH ()-[e]->() RETURN count(e)`, 'n agtype');
    const raw = rows[0]?.n;
    const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  // Drop and rebuild the whole graph from the relationships table — the
  // authoritative source. Returns a summary; no-op when AGE is unavailable.
  async rebuildGraphProjection() {
    if (!(await this._ensureAgeExtension())) return { rebuilt: false, reason: 'AGE unavailable', edges: 0 };
    const name = await this._resolveGraphName();
    const { rows: exists } = await this._exec(
      `SELECT 1 FROM ag_catalog.ag_graph WHERE name = $1`, [name],
    );
    if (exists.length) {
      await this._withGraphClient(c => c.query(`SELECT drop_graph('${this._cypherLiteral(name)}', true)`));
    }
    this._graphReady = false;
    await this._ensureGraph();
    // The authoritative relationship set is obj_<relationship> (the relationship
    // items); the graph is a rebuildable perf_ mirror derived from it.
    const rows = await this._execTry(
      `SELECT o.item_id AS id, o.source_id, o.target_id, rt.value AS type
         FROM "${objTableName(RELATIONSHIP_TYPE_ID)}" o
         JOIN items i        ON i.id = o.item_id
         LEFT JOIN items rt  ON rt.id = o.type_id
        WHERE i.deleted_at IS NULL`,
    ).then(r => r.rows).catch(() => []);   // no relationships materialised yet
    for (const r of rows) {
      await this._projectRelationshipToGraph({ id: r.id, sourceId: r.source_id, targetId: r.target_id, type: r.type });
    }
    return { rebuilt: true, edges: rows.length };
  }

  // Drop the graph entirely (used for teardown). No-op when AGE is unavailable.
  async dropGraphProjection() {
    if (!(await this._ensureAgeExtension())) return;
    const name = await this._resolveGraphName();
    const { rows } = await this._exec(
      `SELECT 1 FROM ag_catalog.ag_graph WHERE name = $1`, [name],
    );
    if (rows.length) {
      await this._withGraphClient(c => c.query(`SELECT drop_graph('${this._cypherLiteral(name)}', true)`));
    }
    this._graphReady = false;
  }

  // ─── Semantic / hybrid search (pgvector) ─────────────────────────────────────

  get embeddingsEnabled() {
    return !!this._embeddingProvider && this._embeddingsEnabled;
  }

  _requireEmbeddingProvider() {
    if (!this._embeddingProvider) {
      throw new Error(
        'Semantic search requires an embedding provider — set `cloud.embeddings` in the workspace config',
      );
    }
    return this._embeddingProvider;
  }

  _requireEmbeddingsEnabled() {
    const provider = this._requireEmbeddingProvider();
    if (!this._embeddingsEnabled) {
      throw new Error(
        'Semantic search is disabled (`cloud.embeddings.enabled: false`) — typically because the backfill is still running',
      );
    }
    return provider;
  }

  async semanticSearch(query: any, { rootId = null, limit = 10 }: any = {}) {
    const provider = this._requireEmbeddingsEnabled();
    const [queryEmbedding] = await provider.embed([query]);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const { rows } = await this._exec(
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

  async hybridSearch(query: any, { rootId = null, limit = 10 }: any = {}) {
    if (!this.embeddingsEnabled) return this.search(query, { rootId, limit });
    const fanOut = Math.max(limit * 2, 20);
    const [ftsResults, vectorResults] = await Promise.all([
      this.search(query, { rootId, limit: fanOut }),
      this.semanticSearch(query, { rootId, limit: fanOut }),
    ]);
    return reciprocalRankFusion([ftsResults, vectorResults]).slice(0, limit);
  }

  async _ensureEmbeddingTable() {
    const provider   = this._embeddingProvider;
    const dimensions = Number(provider.dimensions);
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error(`Invalid embedding dimensions for provider '${provider.name}': ${provider.dimensions}`);
    }
    await this._exec(`
      CREATE TABLE IF NOT EXISTS item_embeddings (
        item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        model        TEXT NOT NULL,
        embedding    public.VECTOR(${dimensions}) NOT NULL,
        content_hash TEXT NOT NULL,
        embedded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (item_id, model)
      )
    `);
    await this._exec(`
      CREATE INDEX IF NOT EXISTS idx_item_embeddings_hnsw
        ON item_embeddings USING hnsw (embedding public.vector_cosine_ops)
    `);
    await this._exec(
      `INSERT INTO perf_embedding_queue (item_id)
       SELECT i.id FROM items i
       WHERE NOT EXISTS (
         SELECT 1 FROM item_embeddings e WHERE e.item_id = i.id AND e.model = $1
       )
       ON CONFLICT (item_id) DO NOTHING`,
      [provider.model],
    );
  }

  async _embeddingContent(item: any) {
    const parts = [];
    if (item.value) parts.push(String(item.value));
    if (item.typeId) {
      const data = await this.readObjectJson(item.id, item.typeId);
      if (data) {
        for (const [field, value] of Object.entries(data)) {
          if (value != null && value !== '') parts.push(`${field}: ${value}`);
        }
      }
    }
    return parts.join('\n');
  }

  async embedItem(id: any) {
    const provider = this._requireEmbeddingProvider();
    const item = await this.get(id);
    if (!item) return false;
    const content     = await this._embeddingContent(item);
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const { rows } = await this._exec(
      'SELECT content_hash FROM item_embeddings WHERE item_id = $1 AND model = $2',
      [id, provider.model],
    );
    if (rows[0]?.content_hash === contentHash) return false;
    const [embedding] = await provider.embed([content]);
    const vectorLiteral = `[${embedding.join(',')}]`;
    await this._exec(
      `INSERT INTO item_embeddings (item_id, model, embedding, content_hash, embedded_at)
       VALUES ($1, $2, $3::public.vector, $4, now())
       ON CONFLICT (item_id, model) DO UPDATE
         SET embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash, embedded_at = now()`,
      [id, provider.model, vectorLiteral, contentHash],
    );
    return true;
  }

  async processPendingEmbeddings({ limit = 50 }: any = {}) {
    this._requireEmbeddingProvider();
    const { rows } = await this._exec(
      'SELECT item_id FROM perf_embedding_queue ORDER BY queued_at LIMIT $1', [limit],
    );
    let embedded = 0, skipped = 0, failed = 0;
    for (const { item_id } of rows) {
      try {
        if (await this.embedItem(item_id)) embedded++; else skipped++;
        await this._exec('DELETE FROM perf_embedding_queue WHERE item_id = $1', [item_id]);
      } catch (e: any) {
        failed++;
        console.warn(`processPendingEmbeddings: failed to embed ${item_id}:`, e.message);
      }
    }
    return { processed: rows.length, embedded, skipped, failed };
  }

  // ─── Index maintenance ────────────────────────────────────────────────────────

  async rebuildIndexes() {
    await this._exec('DELETE FROM perf_backlinks');
    const { rows } = await this._exec(`SELECT id, value FROM items WHERE value IS NOT NULL`);
    for (const row of rows) {
      for (const link of parseLinks(row.value)) {
        await this._exec(
          'INSERT INTO perf_backlinks (source_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [row.id, link],
        );
      }
    }
    const { rows: [{ count }] } = await this._exec('SELECT COUNT(*) FROM items');
    return parseInt(count);
  }

  // ─── Integrity checks ──────────────────────────────────────────────────────

  async checkIntegrity({ checks }: any = {}) {
    const wanted  = Array.isArray(checks) && checks.length ? new Set(checks) : null;
    const run     = (name: any) => !wanted || wanted.has(name);
    const findings = [];

    if (run('orphan-type-id')) {
      const { rows } = await this._exec(
        `SELECT i.id, i.type_id
           FROM items i
           LEFT JOIN items t ON t.id = i.type_id AND t.type = 'type'
          WHERE i.type = 'object' AND i.type_id IS NOT NULL AND t.id IS NULL`,
      );
      for (const row of rows) {
        findings.push({
          check:    'orphan-type-id',
          severity: 'error',
          nodeId:   row.id,
          typeId:   row.type_id,
          message:  `object ${row.id} references typeId ${row.type_id}, which has no type definition`,
          fix:      'register the missing type definition, or remove/retype the node',
        });
      }
    }

    if (run('disconnected-items')) {
      const { rows } = await this._exec(
        `SELECT i.id FROM items i
         WHERE i.path IS NULL AND i.type NOT IN ('root')`,
      );
      for (const row of rows) {
        findings.push({
          check:    'disconnected-items',
          severity: 'warn',
          nodeId:   row.id,
          message:  `item ${row.id} has no materialized path — not reachable from root`,
          fix:      'run rebuildPaths() or re-parent the item',
        });
      }
    }

    return findings;
  }

  // Recompute materialized paths for all items from the root down.
  async rebuildPaths() {
    await this._exec(`
      WITH RECURSIVE paths AS (
        SELECT id, id::text AS path FROM items
        WHERE id = '00000000-0000-0000-0000-000000000000'
        UNION ALL
        SELECT i.id, p.path || '/' || i.id::text
        FROM items i
        JOIN paths p ON i.parent_id = p.id AND i.id != i.parent_id
      )
      UPDATE items SET path = paths.path FROM paths WHERE items.id = paths.id
    `);
  }

  // ─── Branching ──────────────────────────────────────────────────────────────

  async createBranch(name: any) {
    if (!name || typeof name !== 'string' || !name.trim()) throw new Error('branch name is required');
    name = name.trim();
    if (name === 'main') throw new Error('Cannot create a branch named "main"');
    const existing = await this._exec('SELECT id FROM branches WHERE name = $1 AND deleted_at IS NULL', [name]);
    if (existing.rows.length) throw new Error(`Branch "${name}" already exists`);
    const { rows } = await this._exec(
      'INSERT INTO branches (name, base_branch) VALUES ($1, $2) RETURNING id, name, base_branch, created_at',
      [name, 'main'],
    );
    const r = rows[0];
    return { id: r.id, name: r.name, baseBranch: r.base_branch, createdAt: r.created_at.toISOString() };
  }

  async listBranches() {
    const { rows } = await this._exec(
      'SELECT id, name, base_branch, created_at, merged_at, deleted_at FROM branches WHERE deleted_at IS NULL ORDER BY created_at',
    );
    return rows.map(r => ({
      id: r.id, name: r.name, baseBranch: r.base_branch,
      createdAt: r.created_at.toISOString(),
      mergedAt:  r.merged_at?.toISOString() ?? null,
      deletedAt: r.deleted_at?.toISOString() ?? null,
    }));
  }

  async getBranch(name: any) {
    const { rows } = await this._exec(
      'SELECT id, name, base_branch, created_at, merged_at, deleted_at FROM branches WHERE name = $1 AND deleted_at IS NULL',
      [name],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, name: r.name, baseBranch: r.base_branch, createdAt: r.created_at.toISOString(), mergedAt: r.merged_at?.toISOString() ?? null };
  }

  // Write an array of change entries to branch_changes. Each entry: { itemId, changeType, section, data }.
  // Callers pass the full five-section breakdown.
  async applyBranchChanges(branchId: any, changes: any) {
    if (!changes?.length) return;
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const stmt = `
        INSERT INTO branch_changes (branch_id, item_id, change_type, section, data, changed_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (branch_id, item_id, section) DO UPDATE
          SET change_type = EXCLUDED.change_type, data = EXCLUDED.data, changed_at = now()
      `;
      for (const c of changes) {
        await client.query(stmt, [branchId, c.itemId, c.changeType, c.section, c.data ? JSON.stringify(c.data) : null]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getBranchChanges(branchId: any) {
    const { rows } = await this._exec(
      'SELECT item_id, change_type, section, data, changed_at FROM branch_changes WHERE branch_id = $1 ORDER BY item_id, section',
      [branchId],
    );
    return rows.map(r => ({
      itemId: r.item_id, changeType: r.change_type, section: r.section,
      data: r.data, changedAt: r.changed_at.toISOString(),
    }));
  }

  // Pre-flight scan: returns the blast radius for all items in a branch.
  // Blocks merge when any reference item with blockDeletion=true targets a deleted item.
  async preFlightScan(branchId: any) {
    // Collect the set of deleted item IDs on this branch
    const { rows: delRows } = await this._exec(
      "SELECT DISTINCT item_id FROM branch_changes WHERE branch_id = $1 AND change_type = 'delete'",
      [branchId],
    );
    const deletedIds = delRows.map(r => r.item_id);

    // Get all changed item IDs (creates, updates, deletes)
    const { rows: allRows } = await this._exec(
      "SELECT DISTINCT item_id, change_type FROM branch_changes WHERE branch_id = $1 AND section = 'item'",
      [branchId],
    );

    const adds    = allRows.filter(r => r.change_type === 'create').map(r => r.item_id);
    const edits   = allRows.filter(r => r.change_type === 'update').map(r => r.item_id);
    const deletes = deletedIds;
    const changedIds = [...new Set([...adds, ...edits, ...deletes])];

    // Blast radius: items that reference any of the changed IDs
    let structuralRefs: any[] = [];
    let blockingRefs: any[]   = [];
    if (changedIds.length) {
      const { rows: refRows } = await this._execTry(
        'SELECT source_item_id, target_item_id, reference_type, field_name FROM perf_references WHERE target_item_id = ANY($1)',
        [changedIds],
      ).catch(() => ({ rows: [] })); // item_references may not exist on older schemas
      structuralRefs = refRows.map(r => ({
        sourceId: r.source_item_id, targetId: r.target_item_id,
        referenceType: r.reference_type, fieldName: r.field_name,
      }));

      // Check for reference items with blockDeletion:true pointing at deleted items
      if (deletes.length) {
        // Reference items store targetId and blockDeletion flag in the main items value field
        // or time_data column as JSON — query items of type 'reference' pointing at deleted IDs.
        // This is a best-effort check; full payload scanning is handled by the SyncEngine.
        const { rows: blockRows } = await this._exec(`
          SELECT id FROM items
          WHERE type = 'reference'
            AND parent_id = ANY($1)
        `, [deletes]).catch(() => ({ rows: [] }));
        blockingRefs = blockRows.map(r => ({ referenceItemId: r.id }));
      }
    }

    return {
      branchId,
      summary: { adds: adds.length, edits: edits.length, deletes: deletes.length },
      structuralRefs,
      blockingRefs,
      blocked: blockingRefs.length > 0,
    };
  }

  // Atomically merge all branch_changes into main tables, then mark branch merged.
  async mergeBranch(branchId: any) {
    const { rows: branchRows } = await this._exec(
      'SELECT id, name FROM branches WHERE id = $1 AND deleted_at IS NULL AND merged_at IS NULL',
      [branchId],
    );
    if (!branchRows.length) throw new Error(`Branch ${branchId} not found or already merged`);

    const changeRows = await this.getBranchChanges(branchId);

    // Group by item
    const byItem = new Map<any, any>();
    for (const r of changeRows) {
      if (!byItem.has(r.itemId)) byItem.set(r.itemId, { changeType: r.changeType, sections: {} });
      const entry = byItem.get(r.itemId);
      if (r.changeType === 'delete') entry.changeType = 'delete';
      if (r.data) entry.sections[r.section] = r.data;
    }

    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');

      for (const [itemId, entry] of byItem) {
        if (entry.changeType === 'delete') {
          await client.query('DELETE FROM items WHERE id = $1', [itemId]);
        } else {
          const item    = entry.sections.item    ?? {};
          const meta    = entry.sections.meta    ?? {};
          const payload = entry.sections.payload ?? null;

          if (entry.changeType === 'create') {
            // Insert into items table
            await client.query(`
              INSERT INTO items (id, parent_id, value, type, type_id, sort_order, aspect, spec_version,
                owner, license, visibility, confidence, status, tags,
                created_at, modified_at, created_by, modified_by,
                expires_at, deleted_at, connector_id, materialized,
                source_system, source_external_id, path)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
              ON CONFLICT (id) DO UPDATE SET
                parent_id = EXCLUDED.parent_id, value = EXCLUDED.value, type = EXCLUDED.type,
                type_id = EXCLUDED.type_id, sort_order = EXCLUDED.sort_order, aspect = EXCLUDED.aspect,
                modified_at = EXCLUDED.modified_at, modified_by = EXCLUDED.modified_by
            `, [
              itemId, item.parentId ?? null, item.value ?? null, item.type ?? 'text',
              item.typeId ?? null, item.sortOrder ?? 0, item.aspect ?? null,
              meta.specVersion ?? specVersion,
              meta.owner ?? this.config.owner, meta.license ?? DEFAULT_LICENSE, meta.visibility ?? 'private',
              meta.confidence ?? null, meta.status ?? null, meta.tags ?? [],
              meta.createdAt ? new Date(meta.createdAt) : new Date(),
              meta.modifiedAt ? new Date(meta.modifiedAt) : new Date(),
              meta.createdBy ?? this.config.owner, meta.modifiedBy ?? this.config.owner,
              meta.expiresAt ? new Date(meta.expiresAt) : null,
              meta.deletedAt ? new Date(meta.deletedAt) : null,
              meta.connectorId ?? null, meta.materialized ?? null,
              meta.sourceSystem ?? null, meta.sourceExternalId ?? null,
              null, // path: recomputed by rebuildPaths
            ]);
          } else {
            // Update existing item
            await client.query(`
              UPDATE items SET
                parent_id = COALESCE($2, parent_id), value = COALESCE($3, value),
                type = COALESCE($4, type), type_id = $5, sort_order = COALESCE($6, sort_order),
                aspect = $7, modified_at = $8, modified_by = COALESCE($9, modified_by),
                expires_at = $10, deleted_at = $11, connector_id = $12, materialized = $13,
                visibility = COALESCE($14, visibility), status = $15, tags = COALESCE($16, tags)
              WHERE id = $1
            `, [
              itemId, item.parentId ?? null, item.value ?? null, item.type ?? null,
              item.typeId ?? null, item.sortOrder ?? null, item.aspect ?? null,
              meta.modifiedAt ? new Date(meta.modifiedAt) : new Date(),
              meta.modifiedBy ?? null,
              meta.expiresAt  ? new Date(meta.expiresAt)  : null,
              meta.deletedAt  ? new Date(meta.deletedAt)  : null,
              meta.connectorId ?? null, meta.materialized ?? null,
              meta.visibility ?? null, meta.status ?? null, meta.tags ?? null,
            ]);
          }

          // Payload for object types is stored via writeObjectJson (on-disk JSON),
          // not in a separate DB table. The payload section in branch_changes carries
          // merge metadata only; full payload sync is handled by the SyncEngine.
        }
      }

      // Mark branch merged and clear changes
      await client.query('UPDATE branches SET merged_at = now() WHERE id = $1', [branchId]);
      await client.query('DELETE FROM branch_changes WHERE branch_id = $1', [branchId]);

      // Rebuild paths for items that moved or were created
      await client.query(`
        WITH RECURSIVE paths AS (
          SELECT id, id::text AS path FROM items
          WHERE id = '00000000-0000-0000-0000-000000000000'
          UNION ALL
          SELECT i.id, p.path || '/' || i.id::text
          FROM items i
          JOIN paths p ON i.parent_id = p.id AND i.id != i.parent_id
        )
        UPDATE items SET path = paths.path FROM paths WHERE items.id = paths.id AND items.path IS DISTINCT FROM paths.path
      `);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return { merged: byItem.size, branchName: branchRows[0].name };
  }

  async deleteBranch(name: any) {
    if (!name || name === 'main') throw new Error('Cannot delete the main branch');
    const { rows } = await this._exec('SELECT id FROM branches WHERE name = $1 AND deleted_at IS NULL', [name]);
    if (!rows.length) throw new Error(`Branch "${name}" not found`);
    await this._exec('UPDATE branches SET deleted_at = now() WHERE id = $1', [rows[0].id]);
    await this._exec('DELETE FROM branch_changes WHERE branch_id = $1', [rows[0].id]);
  }
}

export {
  PostgresAdapter, UnknownTypeError,
  PRIMITIVE_TYPES, BUILT_IN_TYPES, ROOT_ID,
  WELL_KNOWN_TYPES, VALID_REL_TYPES, UUID_RE,
};
