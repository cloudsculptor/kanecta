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

async function authFetchNoContentType(path: string, init: RequestInit = {}) {
  const token = keycloak.token;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface EventImage {
  file_id: string;
  url: string;
  position?: number;
}

export interface Event {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  submitted_at: string;
  submitted_by_name?: string;
  hero_image: EventImage | null;
  gallery_images: EventImage[];
}

export interface EventSubmitPayload {
  title: string;
  description?: string;
  start_date: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
  website?: string;
  phone?: string;
  email?: string;
}

export function getEvents(): Promise<Event[]> {
  return fetch(`${BASE}/api/events`).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
}

export function getPendingEvents(): Promise<Event[]> {
  return authFetch("/api/events/pending");
}

export function submitEvent(payload: EventSubmitPayload): Promise<{ id: string }> {
  return authFetch("/api/events", { method: "POST", body: JSON.stringify(payload) });
}

export function uploadEventImage(
  eventId: string,
  file: File,
  role: "hero" | "gallery",
  position = 0
): Promise<{ file_id: string; url: string }> {
  const form = new FormData();
  form.append("image", file);
  form.append("role", role);
  form.append("position", String(position));
  return authFetchNoContentType(`/api/events/${eventId}/images`, { method: "POST", body: form });
}

export function deleteEventImage(eventId: string, fileId: string): Promise<{ ok: boolean }> {
  return authFetch(`/api/events/${eventId}/images/${fileId}`, { method: "DELETE" });
}

export function approveEvent(id: string): Promise<{ ok: boolean }> {
  return authFetch(`/api/events/${id}/approve`, { method: "PATCH" });
}

export function declineEvent(id: string, decline_reason?: string): Promise<{ ok: boolean }> {
  return authFetch(`/api/events/${id}/decline`, {
    method: "PATCH",
    body: JSON.stringify({ decline_reason }),
  });
}
