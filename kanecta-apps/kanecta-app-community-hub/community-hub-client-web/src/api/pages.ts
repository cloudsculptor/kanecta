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

export interface Page {
  id: string;
  slug: string;
  title: string;
  content_json: object;
  created_by_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  public: boolean;
  licence_id: string | null;
  licence_name: string | null;
  version: number;
  owner_type: "private" | "group" | "business";
  owner_id: string | null;
  group_name: string | null;
}

export interface PageSummary {
  id: string;
  slug: string;
  title: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  public: boolean;
  licence_id: string | null;
  version: number;
  owner_type: "private" | "group" | "business";
  owner_id: string | null;
}

export interface UploadedFile {
  id: string;
  url: string;
  name: string;
  mime_type: string;
}

export interface PageHistoryEntry {
  id: string;
  action: string;
  version: number;
  user_name: string;
  licence_name: string | null;
  created_at: string;
}

export interface PageVersionData {
  version: number;
  action: string;
  content_json: object;
  licence_name: string | null;
  user_name: string;
  created_at: string;
  title: string;
}

export function listPages(): Promise<PageSummary[]> {
  return authFetch("/api/pages");
}

export function getPage(slug: string): Promise<Page> {
  return authFetch(`/api/pages/${slug}`);
}

export function createPage(data: {
  slug: string;
  title: string;
  content_json: object;
  licence_id?: string | null;
  owner_type?: string;
  owner_id?: string | null;
}): Promise<Page> {
  return authFetch("/api/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function updatePage(
  slug: string,
  data: {
    slug?: string;
    title: string;
    content_json: object;
    licence_id?: string | null;
    public?: boolean;
    owner_type?: string;
    owner_id?: string | null;
  }
): Promise<Page> {
  const body: Record<string, unknown> = {
    title: data.title,
    content_json: data.content_json,
  };
  if (data.slug !== undefined && data.slug !== slug) body.new_slug = data.slug;
  if (data.licence_id !== undefined) body.licence_id = data.licence_id;
  if (data.public !== undefined) body.public = data.public;
  if (data.owner_type !== undefined) body.owner_type = data.owner_type;
  if (data.owner_id !== undefined) body.owner_id = data.owner_id;
  return authFetch(`/api/pages/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deletePage(slug: string): Promise<{ deleted: string }> {
  return authFetch(`/api/pages/${slug}`, { method: "DELETE" });
}

export function listPageHistory(slug: string): Promise<PageHistoryEntry[]> {
  return authFetch(`/api/pages/${slug}/history`);
}

export function getPageVersion(slug: string, version: number): Promise<PageVersionData> {
  return authFetch(`/api/pages/${slug}/version/${version}`);
}

export async function uploadPageFile(formData: FormData): Promise<UploadedFile> {
  const token = keycloak.token;
  const res = await fetch(`${BASE}/api/pages/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}
