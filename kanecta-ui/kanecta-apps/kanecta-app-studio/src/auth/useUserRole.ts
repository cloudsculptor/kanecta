import { useMemo } from "react";
import { useKeycloak } from "./KeycloakProvider";
import keycloak from "./keycloak";

// Unlike community-hub (one fixed realm with a known set of roles), Kanecta
// is installed against whatever Keycloak realm the client provides — so we
// can't hardcode a role list. Read whatever realm roles the token carries.
export function useUserRoles(): string[] {
  const { authenticated } = useKeycloak();
  return useMemo(() => {
    if (!authenticated) return [];
    return keycloak.tokenParsed?.realm_access?.roles ?? [];
  }, [authenticated]);
}

export function hasRole(userRoles: string[], required: string | string[]): boolean {
  if (userRoles.includes("admin")) return true;
  const req = Array.isArray(required) ? required : [required];
  return req.some(r => userRoles.includes(r));
}

export function primaryRole(userRoles: string[]): string | null {
  return userRoles[0] ?? null;
}
