// backfill-executor — the I/O half of backfill.
//
// planBackfill() is pure and produces a BackfillPlan; this applies it against a
// live Postgres datastore, idempotently, in one transaction. Kept separate (and
// behind an injected pool) so the mapping stays pure/unit-testable and only this
// module touches a socket — the same split as readPgCatalog.
//
// Takes a connection POOL and checks out ONE connection for the whole plan (one
// BEGIN/COMMIT), then releases it — so callers just pass their pool (e.g. the
// adapter's) rather than juggling a dedicated client. All queries in the txn run on
// that single checked-out connection (a Pool would otherwise spread them across
// connections and break the transaction).
//
// Idempotency: every write is an upsert. Items upsert on the primary key (the
// plan's ids are stable — a preserved source UUID or a deterministic surrogate),
// and the schema's UNIQUE (source_system, source_external_id) index is the backstop.
// obj_<type> rows upsert on item_id. Relationships (no natural unique) use a
// guarded insert. Re-running the same plan changes nothing but modified_at.
//
// Precondition: the target types are already materialised (the obj_<type> tables
// exist — seed the manifest first). FK ordering is safe: items+obj first, then
// relationships (whose FK to items(id) is not deferrable); the parent_id FK is
// DEFERRABLE INITIALLY DEFERRED so child-before-parent within the txn is fine.

import { version as specVersion } from '@kanecta/specification';
import type { BackfillPlan, ItemUpsert } from './backfill.ts';

/** Anything that runs a query — a checked-out connection. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number }>;
}

/** A checked-out pool connection (query + release). */
export interface BackfillPoolClient extends Queryable {
  release(): void;
}

/** A connection pool (pg.Pool-shaped). The executor checks out one connection for
 *  the plan's transaction and releases it — so a pool is exactly what to pass. */
export interface BackfillPool {
  connect(): Promise<BackfillPoolClient>;
}

export interface ApplyBackfillOptions {
  /** Owner for created items when an upsert carries none. Default 'system'. */
  defaultOwner?: string;
  /** created_by/modified_by actor. Default: the resolved owner. */
  actor?: string;
  itemsTable?: string;
  relationshipsTable?: string;
  /** Schema to `SET search_path` on the checked-out connection before the txn,
   *  for a schema-scoped datastore. Omit when the pool is already scoped. */
  searchPath?: string;
}

export interface ApplyBackfillResult {
  items: number;
  objects: number;
  relationships: number;
}

function q(ident: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) throw new Error(`Illegal identifier: ${ident}`);
  return `"${ident}"`;
}

/** camelCase property → snake_case column (mirrors the compiler's column naming). */
export function camelToSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[A-Z]/g, (m) => m.toLowerCase());
}

function objTable(typeId: string): string {
  return `obj_${typeId.replace(/-/g, '_')}`;
}

async function upsertItem(client: Queryable, u: ItemUpsert, items: string, owner: string, actor: string): Promise<void> {
  await client.query(
    // spec_version is stamped explicitly from the lib — the column's historical
    // DEFAULT ('1.3.0') is a one-time backfill value, not "current version".
    `INSERT INTO ${q(items)}
       (id, spec_version, parent_id, value, type, type_id, owner, sort_order, created_at, modified_at,
        created_by, modified_by, tags, deleted_at, source_system, source_external_id)
     VALUES ($1,$2,$3,NULL,'object',$4,$5,0, now(), now(), $6,$6,'{}',$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET
       spec_version = EXCLUDED.spec_version,
       parent_id = EXCLUDED.parent_id,
       type_id = EXCLUDED.type_id,
       deleted_at = EXCLUDED.deleted_at,
       source_system = EXCLUDED.source_system,
       source_external_id = EXCLUDED.source_external_id,
       modified_at = now(),
       modified_by = EXCLUDED.modified_by`,
    [u.id, specVersion, u.parentId, u.typeId, owner, actor, u.deletedAt, u.sourceSystem, u.sourceExternalId],
  );
}

async function upsertObject(client: Queryable, u: ItemUpsert): Promise<boolean> {
  const keys = Object.keys(u.objectData);
  if (!keys.length) return false;
  const cols = keys.map((k) => q(camelToSnake(k)));
  const placeholders = keys.map((_k, i) => `$${i + 2}`);
  const setList = cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  await client.query(
    `INSERT INTO ${q(objTable(u.typeId))} (item_id, ${cols.join(', ')})
     VALUES ($1, ${placeholders.join(', ')})
     ON CONFLICT (item_id) DO UPDATE SET ${setList}`,
    [u.id, ...keys.map((k) => u.objectData[k])],
  );
  return true;
}

/** Apply a BackfillPlan idempotently in one transaction. Checks out one connection
 *  from `pool`, runs the whole plan on it, and releases it. */
export async function applyBackfillPlan(
  pool: BackfillPool,
  plan: BackfillPlan,
  opts: ApplyBackfillOptions = {},
): Promise<ApplyBackfillResult> {
  const items = opts.itemsTable ?? 'items';
  const rels = opts.relationshipsTable ?? 'relationships';
  const result: ApplyBackfillResult = { items: 0, objects: 0, relationships: 0 };

  const client = await pool.connect();
  try {
    if (opts.searchPath) await client.query(`SET search_path = ${q(opts.searchPath)}`);
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    for (const u of plan.upserts) {
      const owner = u.owner ?? opts.defaultOwner ?? 'system';
      const actor = opts.actor ?? owner;
      await upsertItem(client, u, items, owner, actor);
      result.items++;
      if (await upsertObject(client, u)) result.objects++;
    }
    for (const e of plan.relationships) {
      // Guarded insert — relationships has no natural unique key, so re-runs must
      // not duplicate. gen_random_uuid() for the edge id.
      const { rowCount } = await client.query(
        // Explicit casts: a bare param in a SELECT list defaults to text while the
        // WHERE compares against typed columns — Postgres then can't deduce one
        // type per param ("inconsistent types deduced"). Casting pins them.
        `INSERT INTO ${q(rels)} (id, source_id, target_id, type, created_at, created_by)
         SELECT gen_random_uuid(), $1::uuid, $2::uuid, $3::varchar, now(), $4::varchar
         WHERE NOT EXISTS (
           SELECT 1 FROM ${q(rels)} WHERE source_id = $1::uuid AND target_id = $2::uuid AND type = $3::varchar
         )`,
        [e.sourceId, e.targetId, e.type, opts.actor ?? opts.defaultOwner ?? 'system'],
      );
      result.relationships += rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return result;
}
