import { useMemo } from "react";
import { useKeycloak } from "./KeycloakProvider";
import keycloak from "./keycloak";

export type UserRole = "admin" | "moderator" | "treasurer" | "team" | "resilience";

const ALL_ROLES: UserRole[] = ["admin", "moderator", "treasurer", "team", "resilience"];

export function useUserRoles(): UserRole[] {
  const { authenticated } = useKeycloak();
  return useMemo(() => {
    if (!authenticated) return [];
    return ALL_ROLES.filter(r => keycloak.hasRealmRole(r));
  }, [authenticated]);
}

export function hasRole(userRoles: UserRole[], required: UserRole | UserRole[]): boolean {
  if (userRoles.includes("admin")) return true;
  const req = Array.isArray(required) ? required : [required];
  return req.some(r => userRoles.includes(r));
}

export function primaryRole(userRoles: UserRole[]): UserRole | null {
  return userRoles[0] ?? null;
}
