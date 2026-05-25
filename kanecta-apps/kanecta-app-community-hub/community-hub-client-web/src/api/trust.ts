import keycloak from "../auth/keycloak";

const BASE = import.meta.env.VITE_API_URL ?? "";

async function authFetch(path: string) {
  const token = keycloak.token;
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface TrustNode {
  id: string;
  name: string;
  isCurrentUser: boolean;
  trustedBy: {
    endorserId: string;
    reason: string | null;
  } | null;
}

export function getMyTrustChain(): Promise<TrustNode[]> {
  return authFetch("/api/trust/my-chain");
}
