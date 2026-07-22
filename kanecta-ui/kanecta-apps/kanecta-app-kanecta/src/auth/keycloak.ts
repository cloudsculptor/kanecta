import Keycloak from 'keycloak-js';

// Kanecta is installed into client systems that bring their own Keycloak —
// there is no default realm/URL to fall back to, every deployment supplies
// its own via these env vars (see KeycloakProvider's AUTH_DISABLED branch
// for running without Keycloak entirely, e.g. local dev). Mirrors Studio's
// src/auth/keycloak.ts exactly.
const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: import.meta.env.VITE_KEYCLOAK_REALM,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
});

export default keycloak;
