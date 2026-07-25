// PgAuthzSource — the Postgres backing for the G4 authz engine (src/authz).
//
// The decision engine (`decide`/`can`) is pure over an AuthzSource; this implements
// that interface against the real, generic items schema so the same engine runs on
// any Kanecta app's data — nothing domain-specific here:
//   * resolveItem — owner / visibility / parent chain from the `items` table.
//   * grantsFor  — every `grant` item governing the item, read from the grant type's
//     own per-type projected table `obj_<grant-type-uuid>` (spec §cqrs-projections:
//     a `grant` is an ordinary type with typed columns; governed_item_id / principal
//     / permissions / cascade are COLUMNS). We NEVER read grants from a generic JSON
//     payload store — that is a prohibited anti-pattern (spec §cqrs-projections).
//   The engine's own ancestor walk (decide() climbing parent_id) applies CASCADE, so
//   a role grant on a container flows to everything inside it — no per-app code.
//
// Principal is a string identity or a namespace path (roles arrive as `role/<name>`
// principals from the token). ReBAC group principals ({itemId, relation}) need
// holdsRelation wiring + a membership relationship type — deferred.
//
// STATUS: this adapter does not yet auto-project built-in structured types (grant,
// query, …) to their obj_ tables — built-ins are currently treated as primitive, so
// obj_<grant-type> is not materialised until that per-type projection lands (+ a
// seeder writes grant items). Until then grantsFor finds no table and returns [] —
// visibility + owner decide. The read shape here is already the spec-correct one
// (query the per-type table), so it is complete when the projection exists.

import type { AuthzSource, ItemAuthz, Grant, Permission } from './index.ts';

/** The built-in `grant` type item's fixed UUID (core manifest / spec built-in
 *  types). Grant instances project to `obj_<this-uuid-with-underscores>`. */
export const GRANT_TYPE_ID = '89138971-cd16-4c7a-b4cd-669711bfab75';

function objTableFor(typeId: string): string {
  return `obj_${typeId.replace(/-/g, '_')}`;
}

/** Minimal pg-shaped client (Pool is fine — these are independent reads, no txn). */
export interface AuthzSqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface PgAuthzSourceOptions {
  itemsTable?: string;
  /** Override the grant type's projected table (default obj_<GRANT_TYPE_ID>). */
  grantTable?: string;
}

function qIdent(ident: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) throw new Error(`Illegal identifier: ${ident}`);
  return `"${ident}"`;
}

export class PgAuthzSource implements AuthzSource {
  private readonly items: string;
  private readonly grantTable: string;

  constructor(private readonly client: AuthzSqlClient, opts: PgAuthzSourceOptions = {}) {
    this.items = opts.itemsTable ?? 'items';
    this.grantTable = opts.grantTable ?? objTableFor(GRANT_TYPE_ID);
  }

  async resolveItem(id: string): Promise<ItemAuthz | null> {
    const { rows } = await this.client.query(
      `SELECT id, owner, visibility, parent_id FROM ${qIdent(this.items)} WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: String(r.id),
      owner: r.owner ?? undefined,
      visibility: r.visibility ?? undefined,
      parentId: r.parent_id == null ? undefined : String(r.parent_id),
    };
  }

  // Every live `grant` item governing `id`, read from the grant type's own
  // per-type projected table (typed columns) — never a generic JSON scan. The
  // engine applies these directly and, via its ancestor walk, cascades a
  // container's grants down to this item.
  async grantsFor(id: string): Promise<Grant[]> {
    try {
      const { rows } = await this.client.query(
        `SELECT g.principal AS principal, g.permissions AS permissions, g.cascade AS cascade
           FROM ${qIdent(this.grantTable)} g
           JOIN ${qIdent(this.items)} i ON i.id = g.item_id
          WHERE g.governed_item_id = $1 AND i.deleted_at IS NULL`,
        [id],
      );
      const grants: Grant[] = [];
      for (const r of rows) {
        if (r.principal == null || !Array.isArray(r.permissions)) continue;
        grants.push({
          principal: r.principal,
          permissions: r.permissions as Permission[],
          cascade: r.cascade === true,
        });
      }
      return grants;
    } catch {
      // obj_<grant-type> not projected yet (built-in structured-type projection is
      // pending). No grants → visibility + owner decide. NEVER a generic JSON scan.
      return [];
    }
  }
}
