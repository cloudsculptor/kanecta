import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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

  useEffect(() => {
    keycloak
      .init({
        onLoad: "check-sso",
        silentCheckSsoRedirectUri: window.location.origin + "/silent-check-sso.html",
        pkceMethod: "S256",
      })
      .then((auth) => {
        setAuthenticated(auth);
        setInitialized(true);
        reportToAnalytics(auth);
      });
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
