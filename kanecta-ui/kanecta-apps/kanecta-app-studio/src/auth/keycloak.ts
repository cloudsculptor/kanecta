import Keycloak from "keycloak-js";

// Kanecta installs against whatever Keycloak the deployment provides. Rather than
// bake the realm/URL/client into the build (VITE_*), Studio fetches them at boot
// from its API's public GET /auth-config and creates the instance here — so one
// built artifact serves a no-auth local instance and a Keycloak-protected cloud
// one alike. Until initKeycloak() runs (auth disabled, or before boot completes)
// there is no instance: getKeycloak() returns null and callers send no token,
// matching the API's AUTH_DISABLED bypass.
let instance: Keycloak | null = null;

export interface KeycloakInit {
  url: string;
  realm: string;
  clientId: string;
}

/** Create the Keycloak singleton from runtime auth-config. Idempotent. */
export function initKeycloak(cfg: KeycloakInit): Keycloak {
  if (!instance) instance = new Keycloak({ url: cfg.url, realm: cfg.realm, clientId: cfg.clientId });
  return instance;
}

/** The Keycloak singleton, or null before initKeycloak() runs (e.g. auth disabled). */
export function getKeycloak(): Keycloak | null {
  return instance;
}
