import keycloak from "../auth/keycloak";

const BASE = import.meta.env.VITE_API_URL ?? "";

async function throwIfNotOk(res: Response) {
  if (res.ok) return;
  const body = await res.json().catch(() => null);
  throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
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
  await throwIfNotOk(res);
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
  await throwIfNotOk(res);
  return res.json();
}

export interface EventImage {
  file_id: string;
  url: string;
  position?: number;
}

export const AREAS = [
  "Featherston", "Greytown", "Carterton", "Martinborough",
  "Masterton", "South Wairarapa", "Wairarapa",
] as const;

export type Area = typeof AREAS[number];

export interface Event {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  area: string;
  organiser_name: string | null;
  organiser_email: string | null;
  organiser_phone: string | null;
  submitted_at: string;
  submitted_by_name?: string;
  status?: "pending" | "approved" | "declined";
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
  address?: string;
  lat?: number;
  lng?: number;
  website?: string;
  phone?: string;
  email?: string;
  area?: string;
  organiser_name?: string;
  organiser_email?: string;
  organiser_phone?: string;
}

export interface MyEvent {
  id: string;
  title: string;
  start_date: string;
  start_time: string | null;
  end_date: string | null;
  status: "pending" | "approved" | "declined";
  decline_reason: string | null;
  submitted_at: string;
}

export function getEvents(): Promise<Event[]> {
  return fetch(`${BASE}/api/events`).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
}

export function getMyEvents(): Promise<MyEvent[]> {
  return authFetch("/api/events/mine");
}

export function deleteEvent(id: string): Promise<{ ok: boolean }> {
  return authFetch(`/api/events/${id}`, { method: "DELETE" });
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

export function getEvent(id: string): Promise<Event> {
  return authFetch(`/api/events/${id}`);
}

export function updateEvent(id: string, payload: EventSubmitPayload): Promise<{ ok: boolean; status: string }> {
  return authFetch(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
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
