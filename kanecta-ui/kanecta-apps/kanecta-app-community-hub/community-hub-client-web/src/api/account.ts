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

export interface UpcomingEvent {
  id: string;
  title: string;
  start_date: string;
}

export const accountApi = {
  getDeletionPreview: (): Promise<{ upcomingEvents: UpcomingEvent[] }> =>
    authFetch("/api/account/deletion-preview"),
  deleteAccount: () =>
    authFetch("/api/account/me", { method: "DELETE" }),
};
