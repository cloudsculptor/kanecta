import { vi, describe, it, expect } from "vitest";

// useUserRole.ts imports the browser-only Keycloak singleton + provider at module
// load. Stub them so the pure role helpers can be exercised in Node.
vi.mock("./keycloak", () => ({ default: { hasRealmRole: () => false } }));
vi.mock("./KeycloakProvider", () => ({ useKeycloak: () => ({ authenticated: false, initialized: true }) }));

import { hasRole, primaryRole, type UserRole } from "./useUserRole";

// Role checks gate access to finances, moderation, and team features. Getting
// these wrong is a security/authorization bug — pin the contract.

describe("hasRole", () => {
  it("grants admin access to everything, even unrelated roles", () => {
    expect(hasRole(["admin"], "treasurer")).toBe(true);
    expect(hasRole(["admin"], "moderator")).toBe(true);
    expect(hasRole(["admin"], ["team", "resilience"])).toBe(true);
  });

  it("grants access when the user has the single required role", () => {
    expect(hasRole(["team"], "team")).toBe(true);
    expect(hasRole(["treasurer"], "treasurer")).toBe(true);
  });

  it("grants access when the user has ANY of several required roles", () => {
    expect(hasRole(["resilience"], ["team", "resilience"])).toBe(true);
    expect(hasRole(["moderator"], ["admin", "moderator"])).toBe(true);
  });

  it("denies access when the user lacks the required role(s)", () => {
    expect(hasRole(["team"], "treasurer")).toBe(false);
    expect(hasRole(["resilience"], ["team", "moderator"])).toBe(false);
  });

  it("denies access for a user with no roles", () => {
    expect(hasRole([], "team")).toBe(false);
    expect(hasRole([], ["admin", "team"])).toBe(false);
  });

  it("supports users with multiple roles", () => {
    const roles: UserRole[] = ["team", "treasurer"];
    expect(hasRole(roles, "treasurer")).toBe(true);
    expect(hasRole(roles, "team")).toBe(true);
    expect(hasRole(roles, "moderator")).toBe(false);
  });
});

describe("primaryRole", () => {
  it("returns the first role in the list", () => {
    expect(primaryRole(["treasurer", "team"])).toBe("treasurer");
  });

  it("returns null when the user has no roles", () => {
    expect(primaryRole([])).toBeNull();
  });
});
