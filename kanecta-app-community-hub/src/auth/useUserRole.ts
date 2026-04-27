import { useAuth0 } from "@auth0/auth0-react";

export type UserRole = "PUBLIC" | "VISITOR" | "LOCAL" | "TEAM";

const ROLE_CLAIM = "https://featherston.app/role";

export function useUserRole(): UserRole {
  const { isAuthenticated, user } = useAuth0();
  if (!isAuthenticated || !user) return "PUBLIC";
  return (user[ROLE_CLAIM] as UserRole) ?? "VISITOR";
}
