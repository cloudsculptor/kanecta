// G4 — native authorization for Kanecta items (grants / visibility / owner / ReBAC).
//
// This is the real platform authz the community-hub cutover forces (see
// plans/community-hub-authz-mapping.md): kanecta has no role primitive — access
// is decided per item from `grant` items, `meta.visibility`, and `meta.owner`.
// Keycloak stays the role authority; its realm roles are translated into
// namespace-path PRINCIPALS at request time (no role mirroring into kanecta).
//
// The decision is a pure function of (a request's principal set, the target
// item, the grants on it and its ancestors). Storage is abstracted by
// `AuthzSource`, so the whole engine is verified with in-memory fixtures — no
// database. A Postgres AuthzSource later backs it with the `payload_grant`
// derived table + the container chain.
//
// DESIGN DEFAULTS (owner-confirmed 2026-07-10 — these make "admin superuser" /
// "owner-implicit write" from the mapping doc actually work):
//   * Permission implication: admin ⊇ {read,write,subscribe}; write ⊇ read;
//     subscribe ⊇ read. A grant of a stronger permission satisfies a weaker need.
//   * Owner is implicitly granted read/write/subscribe on their item — but NOT
//     admin (managing grants stays an explicit `admin` grant).

export type Permission = 'read' | 'write' | 'subscribe' | 'admin';

export type Visibility = 'private' | 'organisation' | 'public';

/** A ReBAC principal: anyone holding `relation` to `itemId` (e.g. group member). */
export interface RelationPrincipal {
  itemId: string;
  relation: string;
}

/** A grant as stored in a `grant` item's payload (grants aspect of the governed
 *  item). `principal` is an identity/namespace string or a ReBAC relation. */
export interface Grant {
  principal: string | RelationPrincipal;
  permissions: Permission[];
  cascade?: boolean;
}

/** The authz-relevant projection of an item. */
export interface ItemAuthz {
  id: string;
  owner?: string;
  visibility?: Visibility;
  /** Parent in the containment chain; used to walk cascading grants upward. */
  parentId?: string;
}

/** Storage abstraction the decision engine runs against. Methods may be async. */
export interface AuthzSource {
  /** The authz projection of an item, or null if it does not exist. */
  resolveItem(id: string): Promise<ItemAuthz | null> | ItemAuthz | null;
  /** Grants attached to an item (its grants-aspect `grant` children). */
  grantsFor(id: string): Promise<Grant[]> | Grant[];
  /** Whether `principal` holds `relation` to `itemId` (ReBAC). Optional — a
   *  source without groups can omit it; relation-principals then never match. */
  holdsRelation?(principal: string, itemId: string, relation: string): Promise<boolean> | boolean;
}

export interface Decision {
  allow: boolean;
  /** Why — for audit/debugging: 'public' | 'owner' | 'grant' | 'organisation' |
   *  'item-not-found' | 'no-matching-grant'. */
  reason: string;
}

export interface DecideOptions {
  /** True when the requester belongs to the item's organisation — enables the
   *  `visibility:"organisation"` read fast-path. The caller determines org
   *  membership (namespace/ownerDomain), which is outside the grant model. */
  inOrganisation?: boolean;
  /** Guard against pathological/cyclic containment chains. */
  maxDepth?: number;
}

const IMPLIES: Record<Permission, readonly Permission[]> = {
  admin: ['admin', 'write', 'subscribe', 'read'],
  write: ['write', 'read'],
  subscribe: ['subscribe', 'read'],
  read: ['read'],
};

/** Owner gets these implicitly (not `admin`). */
const OWNER_PERMISSIONS: readonly Permission[] = ['read', 'write', 'subscribe'];

/** Build the request principal set from a validated Keycloak token: the subject
 *  plus a `role/<name>` namespace principal per realm role. No role state is
 *  stored in kanecta — this expansion happens per request. */
export function principalsFromToken(token: { sub: string; roles?: string[]; namespaces?: string[] }): string[] {
  const set = new Set<string>();
  if (token.sub) set.add(token.sub);
  for (const r of token.roles ?? []) set.add(`role/${r}`);
  for (const ns of token.namespaces ?? []) set.add(ns);
  return [...set];
}

/** Whether the granted permissions satisfy the required one (with implication). */
export function satisfies(granted: readonly Permission[], required: Permission): boolean {
  return granted.some((g) => IMPLIES[g]?.includes(required));
}

// A string grant principal matches a request principal by exact match or by
// namespace ancestry: a grant to "acme.com/eng" covers "acme.com/eng" and any
// "acme.com/eng/..." sub-path principal the requester holds.
function stringPrincipalMatches(grantPrincipal: string, requestPrincipals: string[]): boolean {
  return requestPrincipals.some((p) => p === grantPrincipal || p.startsWith(grantPrincipal + '/'));
}

async function principalMatches(
  grant: Grant,
  principals: string[],
  source: AuthzSource,
): Promise<boolean> {
  const gp = grant.principal;
  if (typeof gp === 'string') return stringPrincipalMatches(gp, principals);
  // ReBAC: any request principal that holds the relation to the item.
  if (!source.holdsRelation) return false;
  for (const p of principals) {
    if (await source.holdsRelation(p, gp.itemId, gp.relation)) return true;
  }
  return false;
}

/**
 * Decide whether a request (its `principals`) may exercise `permission` on
 * `targetId`. Pure w.r.t. the injected `source`.
 *
 * Order: item existence → public/organisation read fast-path → owner-implicit →
 * grants on the item and its cascading ancestors.
 */
export async function decide(
  source: AuthzSource,
  principals: string[],
  targetId: string,
  permission: Permission,
  opts: DecideOptions = {},
): Promise<Decision> {
  const item = await source.resolveItem(targetId);
  if (!item) return { allow: false, reason: 'item-not-found' };

  // Visibility fast-paths (reads only, no join).
  if (permission === 'read') {
    if (item.visibility === 'public') return { allow: true, reason: 'public' };
    if (item.visibility === 'organisation' && opts.inOrganisation) return { allow: true, reason: 'organisation' };
  }

  // Owner-implicit (read/write/subscribe, not admin).
  if (item.owner && principals.includes(item.owner) && OWNER_PERMISSIONS.includes(permission)) {
    return { allow: true, reason: 'owner' };
  }

  // Grants on the item, then cascading grants up the containment chain.
  const maxDepth = opts.maxDepth ?? 64;
  const visited = new Set<string>();
  let node: ItemAuthz | null = item;
  let depth = 0;
  let isTarget = true;
  while (node && depth < maxDepth && !visited.has(node.id)) {
    visited.add(node.id);
    const grants = await source.grantsFor(node.id);
    for (const grant of grants) {
      // A grant on the target applies directly; a grant on an ancestor applies
      // only when it cascades.
      if (!isTarget && !grant.cascade) continue;
      if (!satisfies(grant.permissions, permission)) continue;
      if (await principalMatches(grant, principals, source)) {
        return { allow: true, reason: 'grant' };
      }
    }
    if (!node.parentId || node.parentId === node.id) break; // reached root (self-referential)
    node = await source.resolveItem(node.parentId);
    isTarget = false;
    depth++;
  }

  return { allow: false, reason: 'no-matching-grant' };
}

/** Convenience: allow/deny boolean. */
export async function can(
  source: AuthzSource,
  principals: string[],
  targetId: string,
  permission: Permission,
  opts?: DecideOptions,
): Promise<boolean> {
  return (await decide(source, principals, targetId, permission, opts)).allow;
}

/** Filter a set of item ids to those the principals may read. Preserves order.
 *  (A batched Postgres AuthzSource can override this far more efficiently; this
 *  generic form is correct for any source.) */
export async function filterReadable(
  source: AuthzSource,
  principals: string[],
  ids: string[],
  opts?: DecideOptions,
): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    if (await can(source, principals, id, 'read', opts)) out.push(id);
  }
  return out;
}

/** `email_verified` is authn (a fact about the login), not a grant — checked at
 *  the edge for gated create actions (e.g. create-event/create-notice). */
export function emailVerified(token: { email_verified?: boolean }): boolean {
  return token.email_verified === true;
}
