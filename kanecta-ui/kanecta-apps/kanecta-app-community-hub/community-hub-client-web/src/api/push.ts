import keycloak from "../auth/keycloak";

const BASE = import.meta.env.VITE_API_URL ?? "";

async function authFetch(path: string, init: RequestInit = {}) {
  const token = keycloak.token;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export const pushApi = {
  saveDevice: (subscription: PushSubscription) =>
    authFetch("/api/push/device", { method: "POST", body: JSON.stringify({ subscription }) }),
  removeDevice: (endpoint: string) =>
    authFetch("/api/push/device", { method: "DELETE", body: JSON.stringify({ endpoint }) }),
  subscribeThread: (threadId: string) =>
    authFetch(`/api/discussions/threads/${threadId}/notifications`, { method: "POST" }),
  unsubscribeThread: (threadId: string) =>
    authFetch(`/api/discussions/threads/${threadId}/notifications`, { method: "DELETE" }),
  saveFcmToken: (token: string) =>
    authFetch("/api/push/fcm-token", { method: "POST", body: JSON.stringify({ token }) }),
  removeFcmToken: (token: string) =>
    authFetch("/api/push/fcm-token", { method: "DELETE", body: JSON.stringify({ token }) }),
  getPreferences: () =>
    authFetch("/api/push/preferences"),
  savePreferences: (prefs: Record<string, boolean>) =>
    authFetch("/api/push/preferences", { method: "PUT", body: JSON.stringify(prefs) }),
};
