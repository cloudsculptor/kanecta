import keycloak from "../auth/keycloak";

const BASE = import.meta.env.VITE_API_URL ?? "";

export type AppRole = "team" | "moderator" | "treasurer" | "resilience";

export interface Member {
  id: string;
  name: string;
  email: string;
  username: string;
  roles: AppRole[];
  enabled: boolean;
  createdTimestamp: number;
}

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
  if (res.status === 204) return null;
  return res.json();
}

export function getMembers(): Promise<Member[]> {
  return authFetch("/api/members");
}

export function addToTeam(userId: string): Promise<null> {
  return authFetch(`/api/members/${userId}/roles/team`, { method: "POST" });
}
