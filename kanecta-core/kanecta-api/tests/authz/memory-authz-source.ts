// In-memory AuthzSource for testing the decision engine without a datastore.
// Model items (id, owner, visibility, parentId), their grants, and ReBAC group
// memberships, then assert decisions.

import type { AuthzSource, Grant, ItemAuthz } from '../../src/authz/index.ts';

export class MemoryAuthzSource implements AuthzSource {
  private items = new Map<string, ItemAuthz>();
  private grants = new Map<string, Grant[]>();
  private memberships: Array<{ principal: string; itemId: string; relation: string }> = [];

  item(i: ItemAuthz): this {
    this.items.set(i.id, i);
    return this;
  }

  grant(itemId: string, ...grants: Grant[]): this {
    this.grants.set(itemId, [...(this.grants.get(itemId) ?? []), ...grants]);
    return this;
  }

  member(principal: string, itemId: string, relation: string): this {
    this.memberships.push({ principal, itemId, relation });
    return this;
  }

  resolveItem(id: string): ItemAuthz | null {
    return this.items.get(id) ?? null;
  }

  grantsFor(id: string): Grant[] {
    return this.grants.get(id) ?? [];
  }

  holdsRelation(principal: string, itemId: string, relation: string): boolean {
    return this.memberships.some((m) => m.principal === principal && m.itemId === itemId && m.relation === relation);
  }
}
