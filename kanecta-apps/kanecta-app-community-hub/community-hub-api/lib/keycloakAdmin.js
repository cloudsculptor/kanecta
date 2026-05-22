const KEYCLOAK_URL = process.env.KEYCLOAK_URL || "https://auth.featherston.co.nz";
const KEYCLOAK_INTERNAL_URL = process.env.KEYCLOAK_INTERNAL_URL || "http://localhost:8080";
const REALM = process.env.KEYCLOAK_REALM || "featherston";

let cachedToken = null;
let tokenExpiry = 0;

async function getAdminToken() {
  if (cachedToken && Date.now() < tokenExpiry - 10_000) {
    return cachedToken;
  }

  const clientId = process.env.KEYCLOAK_MEMBERS_CLIENT_ID;
  const clientSecret = process.env.KEYCLOAK_MEMBERS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("KEYCLOAK_MEMBERS_CLIENT_ID and KEYCLOAK_MEMBERS_CLIENT_SECRET must be set");
  }

  const res = await fetch(
    `${KEYCLOAK_INTERNAL_URL}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keycloak admin token request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

export async function adminFetch(path, options = {}) {
  const token = await getAdminToken();
  const res = await fetch(`${KEYCLOAK_INTERNAL_URL}/admin/realms/${REALM}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keycloak admin API error (${res.status}): ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

