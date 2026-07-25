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

export interface SiteNodeHistoryEntry {
  id: string;
  action: "Created" | "Updated" | "Deleted";
  snapshot: SiteNode;
  user_name: string;
  created_at: string;
}

export function getSiteNodeHistory(id: string): Promise<SiteNodeHistoryEntry[]> {
  return authFetch(`/api/site-nodes/history/${id}`);
}

/** Swap sort_order of two sibling nodes so `id` moves up or down by one position. */
export async function swapSiteNodeOrder(
  nodes: SiteNode[],
  id: string,
  direction: "up" | "down"
): Promise<void> {
  const idx = nodes.findIndex((n) => n.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= nodes.length) return;
  const a = nodes[idx];
  const b = nodes[swapIdx];
  await Promise.all([
    updateSiteNode(a.id, { sortOrder: b.sort_order }),
    updateSiteNode(b.id, { sortOrder: a.sort_order }),
  ]);
}
