import { useKeycloak } from "./KeycloakProvider";
import keycloak from "./keycloak";

export type UserRole = "PUBLIC" | "LOCAL" | "TEAM" | "RESILIENCE" | "MODERATOR";

export function useUserRole(): UserRole {
  const { authenticated } = useKeycloak();
  if (!authenticated) return "PUBLIC";
  if (keycloak.hasRealmRole("moderator")) return "MODERATOR";
  if (keycloak.hasRealmRole("team")) return "TEAM";
  if (keycloak.hasRealmRole("resilience")) return "RESILIENCE";
  return "LOCAL";
}
