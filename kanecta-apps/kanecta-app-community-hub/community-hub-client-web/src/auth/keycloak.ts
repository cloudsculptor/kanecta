import Keycloak from "keycloak-js";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

// Android WebView clears sessionStorage on cross-origin navigation; redirect it to
// localStorage so PKCE state/verifier survives the Keycloak redirect and back.
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

// In the Android app, intercept keycloak.login() to open Keycloak in a Chrome Custom
// Tab instead of navigating in the WebView. This avoids Google's WebView OAuth block
// and ERR_CONNECTION_REFUSED when Keycloak redirects back to http://localhost.
// The custom scheme nz.co.featherston://auth (declared in AndroidManifest.xml)
// triggers appUrlOpen after authentication completes.
if (Capacitor.isNativePlatform()) {
  keycloak.login = async (options) => {
    const authUrl = await (keycloak as unknown as { createLoginUrl: (o: unknown) => Promise<string> }).createLoginUrl({
      ...options,
      redirectUri: "nz.co.featherston://auth",
    });
    await Browser.open({ url: authUrl });
  };
}

export default keycloak;
