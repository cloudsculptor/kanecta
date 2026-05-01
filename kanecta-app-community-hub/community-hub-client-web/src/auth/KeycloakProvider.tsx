import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import keycloak from "./keycloak";

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
