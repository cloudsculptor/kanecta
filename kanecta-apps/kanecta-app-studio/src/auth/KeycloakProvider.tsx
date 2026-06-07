import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import keycloak from "./keycloak";

export interface KeycloakContextValue {
  initialized: boolean;
  authenticated: boolean;
  // True when VITE_AUTH_DISABLED=true — lets engineers run studio locally
  // without standing up a Keycloak instance. No Keycloak instance is touched
  // in this mode (keycloak.token stays undefined, so the API client sends no
  // Authorization header — matching the backend's AUTH_DISABLED bypass).
  // Exposed via context (rather than read directly from import.meta.env by
  // consumers) so components can derive their auth UI from one source of
  // truth and be exercised in tests/stories without an env override.
  authDisabled: boolean;
}

const DISABLED_CONTEXT: KeycloakContextValue = { initialized: true, authenticated: true, authDisabled: true };

export const KeycloakContext = createContext<KeycloakContextValue>({ initialized: false, authenticated: false, authDisabled: false });

export function KeycloakProvider({ children }: { children: ReactNode }) {
  const authDisabled = import.meta.env.VITE_AUTH_DISABLED === "true";
  const [initialized, setInitialized] = useState(authDisabled);
  const [authenticated, setAuthenticated] = useState(authDisabled);
  const refreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (authDisabled) return;

    keycloak
      .init({
        pkceMethod: "S256",
        checkLoginIframe: false,
        onLoad: "check-sso",
        silentCheckSsoRedirectUri: window.location.origin + "/silent-check-sso.html",
      })
      .then((auth) => {
        setAuthenticated(auth);
        setInitialized(true);

        if (auth) {
          // Refresh the access token before it expires (refresh if <70s remaining).
          // The SSO session outlives the short-lived access token, so we need this
          // loop to stay authenticated across long browsing sessions.
          refreshInterval.current = setInterval(() => {
            keycloak.updateToken(70).catch(() => {
              setAuthenticated(false);
            });
          }, 60_000);
        }
      })
      .catch(() => {
        setInitialized(true);
      });

    return () => {
      if (refreshInterval.current) clearInterval(refreshInterval.current);
    };
  }, [authDisabled]);

  return (
    <KeycloakContext.Provider value={authDisabled ? DISABLED_CONTEXT : { initialized, authenticated, authDisabled: false }}>
      {children}
    </KeycloakContext.Provider>
  );
}

export function useKeycloak() {
  return useContext(KeycloakContext);
}
