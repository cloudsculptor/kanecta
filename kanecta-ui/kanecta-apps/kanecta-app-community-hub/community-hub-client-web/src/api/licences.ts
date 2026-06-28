import keycloak from "../auth/keycloak";

const BASE = import.meta.env.VITE_API_URL ?? "";

async function authFetch(path: string) {
  const token = keycloak.token;
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface Licence {
  id: string;
  name: string;
  url: string;
  public_description: string;
  private_details: string;
  badge: string | null;
  sort_order: number;
}

export function listLicences(): Promise<Licence[]> {
  return authFetch("/api/licences");
}
