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
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface Suggestion {
  id: string;
  content: string;
  submitted_by_name: string | null;
  submitted_at: string;
}

export function submitSuggestion(content: string): Promise<{ id: string }> {
  return authFetch("/api/suggestions", { method: "POST", body: JSON.stringify({ content }) });
}

export function getSuggestions(): Promise<Suggestion[]> {
  return authFetch("/api/suggestions");
}
