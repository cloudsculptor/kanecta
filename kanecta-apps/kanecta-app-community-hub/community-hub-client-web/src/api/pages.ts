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
}

export interface PageSummary {
  id: string;
  slug: string;
  title: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface UploadedFile {
  id: string;
  url: string;
  name: string;
  mime_type: string;
}

export function listPages(): Promise<PageSummary[]> {
  return authFetch("/api/pages");
}

export function getPage(slug: string): Promise<Page> {
  return authFetch(`/api/pages/${slug}`);
}

export function createPage(data: { slug: string; title: string; content_json: object }): Promise<Page> {
  return authFetch("/api/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function updatePage(
  slug: string,
  data: { slug?: string; title: string; content_json: object }
): Promise<Page> {
  const body: { new_slug?: string; title: string; content_json: object } = {
    title: data.title,
    content_json: data.content_json,
  };
  if (data.slug !== undefined && data.slug !== slug) body.new_slug = data.slug;
  return authFetch(`/api/pages/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deletePage(slug: string): Promise<{ deleted: string }> {
  return authFetch(`/api/pages/${slug}`, { method: "DELETE" });
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
