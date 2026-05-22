import keycloak from "../auth/keycloak";

const BASE = import.meta.env.VITE_API_URL ?? "";

export interface PrepareResult {
  token: string;
  size: number;
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
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
  return res;
}

export async function prepareDownload(): Promise<PrepareResult> {
  const res = await authFetch("/api/download/prepare", { method: "POST" });
  return res.json();
}

export async function downloadZip(token: string): Promise<void> {
  const res = await authFetch(`/api/download/${token}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "featherston-pages.zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
