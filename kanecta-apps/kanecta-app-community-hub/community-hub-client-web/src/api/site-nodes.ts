import keycloak from "../auth/keycloak";

const BASE = import.meta.env.VITE_API_URL ?? "";

async function authFetch(path: string, init: RequestInit = {}) {
  const token = keycloak.token;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface SiteNode {
  id: string;
  parent_id: string | null;
  slug: string;
  title: string;
  node_type: "index" | "page" | "component";
  component_name: string | null;
  metadata: Record<string, string>;
  sort_order: number;
  public: boolean;
  children: SiteNode[];
}

/** Full subtree rooted at `root` slug (e.g. "procedures" or "policies"). */
export function getSiteNodeTree(root: string): Promise<SiteNode> {
  return fetch(`${BASE}/api/site-nodes/tree?root=${encodeURIComponent(root)}`).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
    }
    return res.json();
  });
}

/** Direct children of a node (or root nodes if parentId is omitted). */
export function getSiteNodeChildren(parentId?: string): Promise<SiteNode[]> {
  const qs = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";
  return fetch(`${BASE}/api/site-nodes${qs}`).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
    }
    return res.json();
  });
}

export interface CreateSiteNodeInput {
  parentId?: string | null;
  slug: string;
  title: string;
  nodeType: "index" | "page" | "component";
  componentName?: string;
  metadata?: Record<string, string>;
  sortOrder?: number;
}

export function createSiteNode(input: CreateSiteNodeInput): Promise<SiteNode> {
  return authFetch("/api/site-nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export interface UpdateSiteNodeInput {
  title?: string;
  slug?: string;
  sortOrder?: number;
  public?: boolean;
  metadata?: Record<string, string>;
}

export function updateSiteNode(id: string, input: UpdateSiteNodeInput): Promise<SiteNode> {
  return authFetch(`/api/site-nodes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteSiteNode(id: string): Promise<{ ok: boolean }> {
  return authFetch(`/api/site-nodes/${id}`, { method: "DELETE" });
}
