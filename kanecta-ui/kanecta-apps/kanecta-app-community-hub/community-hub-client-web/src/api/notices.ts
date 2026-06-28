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

export interface Notice {
  id: string;
  heading: string;
  body: string;
  notice_date: string | null;
  submitted_by_name: string | null;
  submitted_at: string;
}

export interface MyNotice {
  id: string;
  heading: string;
  notice_date: string | null;
  status: "pending" | "approved" | "declined";
  decline_reason: string | null;
  submitted_at: string;
}

export interface NoticeSubmitPayload {
  heading: string;
  body: string;
  notice_date?: string;
}

export function getNotices(): Promise<Notice[]> {
  return fetch(`${BASE}/api/notices`).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
}

export function getMyNotices(): Promise<MyNotice[]> {
  return authFetch("/api/notices/mine");
}

export function getPendingNotices(): Promise<Notice[]> {
  return authFetch("/api/notices/pending");
}

export function submitNotice(payload: NoticeSubmitPayload): Promise<{ id: string }> {
  return authFetch("/api/notices", { method: "POST", body: JSON.stringify(payload) });
}

export function approveNotice(id: string): Promise<{ ok: boolean }> {
  return authFetch(`/api/notices/${id}/approve`, { method: "PATCH" });
}

export function declineNotice(id: string, decline_reason?: string): Promise<{ ok: boolean }> {
  return authFetch(`/api/notices/${id}/decline`, {
    method: "PATCH",
    body: JSON.stringify({ decline_reason }),
  });
}

export function deleteNotice(id: string): Promise<{ ok: boolean }> {
  return authFetch(`/api/notices/${id}`, { method: "DELETE" });
}
