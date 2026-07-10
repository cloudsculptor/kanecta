// PgAuthzSource — the Postgres backing for the G4 authz engine (src/authz).
//
// The decision engine (`decide`/`can`) is pure over an AuthzSource; this implements
// that interface against the real, GENERIC items schema so the same engine runs on
// any Kanecta app's data — nothing domain-specific here:
//   * resolveItem — owner / visibility / parent chain from the `items` table.
//   * grantsFor  — every `grant` item governing the item, read generically from the
//     `item_payloads` store (`payload->>'governedItemId' = id`). The engine's own
//     ancestor walk (decide() climbing parent_id) applies CASCADE grants, so a role
//     grant on a container flows to everything inside it — no per-app code.
//
// Grants are ordinary `grant` items with payload {governedItemId, principal,
// permissions, cascade} (spec §grantPayload). Principal is a string identity or a
// namespace path (roles arrive as `role/<name>` principals from the token). ReBAC
// group principals ({itemId, relation}) need holdsRelation wiring + a membership
// relationship type — deferred (relation principals simply don't match until then).
//
// Performance: correctness comes from grantsFor(item) + the engine's per-level walk
// (a few small indexed queries up the container chain). A recursive-CTE batch and
// the O(1) `payload_grant` derived table are later optimizations over these same
// source rows.

import type { AuthzSource, ItemAuthz, Grant, Permission } from './index.ts';

/** Minimal pg-shaped client (Pool is fine — these are independent reads, no txn). */
export interface AuthzSqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface PgAuthzSourceOptions {
  itemsTable?: string;
  payloadsTable?: string;
}

function qIdent(ident: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) throw new Error(`Illegal identifier: ${ident}`);
  return `"${ident}"`;
}

export class PgAuthzSource implements AuthzSource {
  private readonly items: string;
  private readonly payloads: string;

  constructor(private readonly client: AuthzSqlClient, opts: PgAuthzSourceOptions = {}) {
    this.items = opts.itemsTable ?? 'items';
    this.payloads = opts.payloadsTable ?? 'item_payloads';
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

  // Every `grant` item governing `id` — read generically from item_payloads by
  // governedItemId. The engine applies these directly (grant on the item) and, via
  // its ancestor walk, cascades a container's grants down to this item.
  async grantsFor(id: string): Promise<Grant[]> {
    const { rows } = await this.client.query(
      `SELECT p.payload AS payload
         FROM ${qIdent(this.payloads)} p
         JOIN ${qIdent(this.items)} i ON i.id = p.item_id
        WHERE i.type = 'grant' AND i.deleted_at IS NULL
          AND p.payload->>'governedItemId' = $1`,
      [id],
    );
    const grants: Grant[] = [];
    for (const r of rows) {
      const g = r.payload;
      if (!g || g.principal == null || !Array.isArray(g.permissions)) continue;
      grants.push({
        principal: g.principal,
        permissions: g.permissions as Permission[],
        cascade: g.cascade === true,
      });
    }
    return grants;
  }
}
