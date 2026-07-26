import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { initKeycloak } from "./keycloak";

export interface KeycloakContextValue {
  initialized: boolean;
  authenticated: boolean;
  // True when the deployment runs without Keycloak — either a build-time
  // VITE_AUTH_DISABLED=true (offline/local dev, Storybook) or the API's
  // GET /auth-config reporting authDisabled. No Keycloak instance is touched in
  // this mode (getKeycloak() stays null, so the API client sends no Authorization
  // header — matching the backend's AUTH_DISABLED bypass). Exposed via context
  // (rather than read from import.meta.env by consumers) so components derive
  // their auth UI from one source of truth and can be exercised in tests/stories.
  authDisabled: boolean;
}

/** Public boot config from GET /auth-config (spec: core-file-specs/auth-config.json). */
interface AuthConfig {
  authDisabled: boolean;
  keycloakUrl: string | null;
  realm: string | null;
  clientId: string | null;
}

const API_BASE = import.meta.env.VITE_KANECTA_API_URL ?? "/api";

const DISABLED_STATE: KeycloakContextValue = { initialized: true, authenticated: true, authDisabled: true };

export const KeycloakContext = createContext<KeycloakContextValue>({ initialized: false, authenticated: false, authDisabled: false });

export function KeycloakProvider({ children }: { children: ReactNode }) {
  // A build-time VITE_AUTH_DISABLED=true short-circuits the whole flow for pure
  // offline/local dev and Storybook — no API and no Keycloak are touched. Cloud
  // builds OMIT it and let the API's GET /auth-config decide at runtime, so a
  // single artifact serves every instance.
  const buildDisabled = import.meta.env.VITE_AUTH_DISABLED === "true";
  const [state, setState] = useState<KeycloakContextValue>(
    buildDisabled ? DISABLED_STATE : { initialized: false, authenticated: false, authDisabled: false },
  );
  const refreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (buildDisabled) return;
    let cancelled = false;

    fetch(`${API_BASE}/auth-config`)
      .then((r) => r.json() as Promise<AuthConfig>)
      .then((cfg) => {
        if (cancelled) return;

        // Auth off at the deployment: behave like a disabled build — everything
        // is "authenticated", no Keycloak, no token sent.
        if (cfg.authDisabled || !cfg.keycloakUrl || !cfg.realm || !cfg.clientId) {
          setState(DISABLED_STATE);
          return;
        }

        const kc = initKeycloak({ url: cfg.keycloakUrl, realm: cfg.realm, clientId: cfg.clientId });
        kc
          .init({
            pkceMethod: "S256",
            checkLoginIframe: false,
            onLoad: "check-sso",
            silentCheckSsoRedirectUri: window.location.origin + "/silent-check-sso.html",
          })
          .then((auth) => {
            if (cancelled) return;
            setState({ initialized: true, authenticated: auth, authDisabled: false });

            if (auth) {
              // Refresh the access token before it expires (refresh if <70s left).
              // The SSO session outlives the short-lived access token.
              refreshInterval.current = setInterval(() => {
                kc.updateToken(70).catch(() => setState((s) => ({ ...s, authenticated: false })));
              }, 60_000);
            }
          })
          .catch(() => {
            if (!cancelled) setState({ initialized: true, authenticated: false, authDisabled: false });
          });
      })
      .catch(() => {
        // Can't reach /auth-config — fail closed (auth on, not authenticated)
        // rather than silently granting access.
        if (!cancelled) setState({ initialized: true, authenticated: false, authDisabled: false });
      });

    return () => {
      cancelled = true;
      if (refreshInterval.current) clearInterval(refreshInterval.current);
    };
  }, [buildDisabled]);

  return <KeycloakContext.Provider value={state}>{children}</KeycloakContext.Provider>;
}

export function useKeycloak() {
  return useContext(KeycloakContext);
}
