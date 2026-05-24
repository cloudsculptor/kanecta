import Keycloak from "keycloak-js";

// Android WebView clears sessionStorage when navigating to an external domain and back.
// Keycloak stores PKCE state/verifier in sessionStorage before the login redirect, so
// they're missing on the callback page. Redirect to localStorage at module load time
// (before any Keycloak calls) so the data survives cross-origin navigation.
if (typeof window !== "undefined" && window.location.origin === "http://localhost") {
  try {
    Object.defineProperty(window, "sessionStorage", { get: () => window.localStorage, configurable: true });
  } catch (_) {}
}

const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: import.meta.env.VITE_KEYCLOAK_REALM,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
});

export default keycloak;
