import Keycloak from "keycloak-js";

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

// In the Android app (Capacitor WebView), intercept keycloak.login() to open Keycloak
// in a Chrome Custom Tab instead. This avoids Google's WebView OAuth block and the
// ERR_CONNECTION_REFUSED when Keycloak tries to redirect back to http://localhost.
// The custom scheme nz.co.featherston://auth is declared in AndroidManifest.xml and
// triggers appUrlOpen when the Keycloak redirect lands after authentication.
if (typeof window !== "undefined" && window.location.origin === "http://localhost") {
  const originalLogin = keycloak.login.bind(keycloak);
  keycloak.login = async (options) => {
    const Browser = (
      window as unknown as { Capacitor?: { Plugins?: { Browser?: { open: (o: { url: string }) => Promise<void> } } } }
    ).Capacitor?.Plugins?.Browser;
    if (!Browser) return originalLogin(options);
    const authUrl = (keycloak as unknown as { createLoginUrl: (o: unknown) => string }).createLoginUrl({
      ...options,
      redirectUri: "nz.co.featherston://auth",
    });
    await Browser.open({ url: authUrl });
  };
}

export default keycloak;
