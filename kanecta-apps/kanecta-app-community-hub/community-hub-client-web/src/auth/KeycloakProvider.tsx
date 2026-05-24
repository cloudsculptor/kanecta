import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import keycloak from "./keycloak";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function deriveRole(authenticated: boolean): string {
  if (!authenticated) return "PUBLIC";
  if (keycloak.hasRealmRole("moderator")) return "MODERATOR";
  if (keycloak.hasRealmRole("team")) return "TEAM";
  if (keycloak.hasRealmRole("resilience")) return "RESILIENCE";
  return "GUEST";
}

function reportToAnalytics(authenticated: boolean) {
  const role = deriveRole(authenticated);
  window.gtag?.("set", { user_id: authenticated ? keycloak.tokenParsed?.sub : undefined });
  window.gtag?.("set", "user_properties", { role });
}

interface KeycloakContextValue {
  initialized: boolean;
  authenticated: boolean;
}

const KeycloakContext = createContext<KeycloakContextValue>({ initialized: false, authenticated: false });

export function KeycloakProvider({ children }: { children: ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const refreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const isNativeApp = typeof (window as unknown as { Capacitor?: unknown }).Capacitor !== "undefined";
    if (isNativeApp) {
      // Android WebView clears sessionStorage when navigating to an external domain and back.
      // Keycloak stores PKCE code_verifier and state in sessionStorage before the login
      // redirect, so they're gone by the time the callback returns. Redirect to localStorage
      // which survives cross-origin navigations.
      try {
        Object.defineProperty(window, "sessionStorage", { get: () => window.localStorage });
      } catch (_) { /* already overridden */ }
    }
    keycloak
      .init({
        pkceMethod: "S256",
        checkLoginIframe: false,
        ...(isNativeApp ? {} : {
          onLoad: "check-sso",
          silentCheckSsoRedirectUri: window.location.origin + "/silent-check-sso.html",
        }),
      })
      .then((auth) => {
        setAuthenticated(auth);
        setInitialized(true);
        reportToAnalytics(auth);

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
  }, []);

  return (
    <KeycloakContext.Provider value={{ initialized, authenticated }}>
      {children}
    </KeycloakContext.Provider>
  );
}

export function useKeycloak() {
  return useContext(KeycloakContext);
}
