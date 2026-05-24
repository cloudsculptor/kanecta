import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
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
    keycloak
      .init({
        pkceMethod: "S256",
        checkLoginIframe: false,
        ...(Capacitor.isNativePlatform() ? {} : {
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

    if (Capacitor.isNativePlatform()) {
      // After the user authenticates in Chrome Custom Tab, Keycloak redirects to
      // nz.co.featherston://auth#code=...&state=... which fires appUrlOpen.
      // We reload the WebView with the auth fragment so keycloak.init()
      // on the fresh page load can process the auth code.
      App.addListener("appUrlOpen", async ({ url }) => {
        if (!url.startsWith("nz.co.featherston://auth")) return;
        await Browser.close().catch(() => {});
        const fragment = url.includes("#") ? url.split("#").slice(1).join("#") : "";
        history.replaceState(null, "", "#" + fragment);
        window.location.reload();
      });
    }

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
