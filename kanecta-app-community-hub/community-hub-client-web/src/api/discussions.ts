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

export interface Thread {
  id: string;
  name: string;
  description: string | null;
  created_by_name: string;
  created_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  parent_message_id: string | null;
  user_id: string;
  user_name: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_count: number;
}

export interface Reaction {
  emoji: string;
  count: string;
  user_ids: string[];
  user_names: string[];
}

export interface User {
  id: string;
  name: string;
}

export class DuplicateThreadError extends Error {
  existing: Thread;
  constructor(existing: Thread) {
    super("A thread with this name already exists");
    this.existing = existing;
  }
}

export const api = {
  users: {
    list: () => authFetch("/api/discussions/users") as Promise<User[]>,
  },
  threads: {
    list: () => authFetch("/api/discussions/threads") as Promise<Thread[]>,
    create: async (name: string, description?: string): Promise<Thread> => {
      const token = keycloak.token;
      const res = await fetch(`${BASE}/api/discussions/threads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name, description }),
      });
      if (res.status === 409) {
        const body = await res.json();
        throw new DuplicateThreadError(body.existing as Thread);
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
  },
  messages: {
    list: (threadId: string) =>
      authFetch(`/api/discussions/threads/${threadId}/messages`) as Promise<Message[]>,
    post: (threadId: string, content: string) =>
      authFetch(`/api/discussions/threads/${threadId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }) as Promise<Message>,
    edit: (id: string, content: string) =>
      authFetch(`/api/discussions/messages/${id}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }) as Promise<Message>,
    delete: (id: string) =>
      authFetch(`/api/discussions/messages/${id}`, { method: "DELETE" }),
    replies: (id: string) =>
      authFetch(`/api/discussions/messages/${id}/replies`) as Promise<Message[]>,
    reply: (id: string, content: string) =>
      authFetch(`/api/discussions/messages/${id}/replies`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }) as Promise<Message>,
  },
  reactions: {
    listForThread: (threadId: string) =>
      authFetch(`/api/discussions/threads/${threadId}/reactions`) as Promise<Record<string, Reaction[]>>,
    add: (messageId: string, emoji: string) =>
      authFetch(`/api/discussions/messages/${messageId}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      }) as Promise<Reaction[]>,
    remove: (messageId: string, emoji: string) =>
      authFetch(`/api/discussions/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
        method: "DELETE",
      }) as Promise<Reaction[]>,
  },
};
