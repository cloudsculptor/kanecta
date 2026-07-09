// PgAuthzSource — the Postgres backing for the G4 authz engine (src/authz).
//
// The decision engine (`decide`/`can`) is pure over an AuthzSource; this implements
// that interface against the real items schema so the same engine runs on live
// data. It resolves an item's authz projection (owner / visibility / parent chain)
// from the `items` table.
//
// SCOPE (deliberate): the owner + visibility layers only. `decide()` checks
// public/organisation visibility and owner-implicit access BEFORE grants, and for a
// READ-ONLY surface like /graphql those layers cover public content, org-members
// reads, and an owner reading their own item. The GRANT-CASCADE layer (role/team
// etc. — the RBAC→ReBAC mapping) needs the `grant`-item storage + the `payload_grant`
// derived table, which are not built yet (see community-hub-authz-mapping.md); until
// then grantsFor returns [] and a non-public, non-owner item is denied. That is a
// safe direction (deny), not a wrong allow.

import type { AuthzSource, ItemAuthz, Grant } from './index.ts';

/** Minimal pg-shaped client (Pool is fine — these are independent reads, no txn). */
export interface AuthzSqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface PgAuthzSourceOptions {
  itemsTable?: string;
}

function qIdent(ident: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) throw new Error(`Illegal identifier: ${ident}`);
  return `"${ident}"`;
}

export class PgAuthzSource implements AuthzSource {
  private readonly items: string;

  constructor(private readonly client: AuthzSqlClient, opts: PgAuthzSourceOptions = {}) {
    this.items = opts.itemsTable ?? 'items';
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

  // Grant-cascade enforcement is deferred to the payload_grant derived table +
  // grant-item storage. No grants read yet → visibility/owner decide access.
  grantsFor(): Grant[] {
    return [];
  }
}
