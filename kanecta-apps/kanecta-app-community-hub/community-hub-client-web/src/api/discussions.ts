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

export interface Thread {
  id: string;
  name: string;
  description: string | null;
  created_by_name: string;
  created_by_user_id: string;
  created_at: string;
  has_unread: boolean;
  is_notifications_enabled: boolean;
}

export interface MessageFile {
  id: string;
  file_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  show_preview: boolean;
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
  files: MessageFile[];
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

export interface UnreadThread {
  thread_id: string;
  name: string;
  last_read_at: string;
  messages: Message[];
}

export class DuplicateThreadError extends Error {
  existing: Thread;
  constructor(existing: Thread) {
    super("A thread with this name already exists");
    this.existing = existing;
  }
}

export const api = {
  reads: {
    list: () => authFetch("/api/discussions/unreads") as Promise<UnreadThread[]>,
    mark: (threadId: string) =>
      authFetch(`/api/discussions/threads/${threadId}/reads`, { method: "POST" }),
  },
  users: {
    list: () => authFetch("/api/discussions/users") as Promise<User[]>,
  },
  threads: {
    list: () => authFetch("/api/discussions/threads") as Promise<Thread[]>,
    archive: (threadId: string) =>
      authFetch(`/api/discussions/threads/${threadId}/archive`, { method: "PATCH" }),
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
    post: (threadId: string, content: string, fileIds?: string[]) =>
      authFetch(`/api/discussions/threads/${threadId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, fileIds }),
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
    reply: (id: string, content: string, fileIds?: string[]) =>
      authFetch(`/api/discussions/messages/${id}/replies`, {
        method: "POST",
        body: JSON.stringify({ content, fileIds }),
      }) as Promise<Message>,
  },
  files: {
    upload: async (file: File): Promise<{ id: string; url: string; name: string; mime_type: string; size_bytes: number }> => {
      const token = keycloak.token;
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${BASE}/api/discussions/messages/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
    delete: (fileId: string) =>
      authFetchNoContentType(`/api/discussions/files/${fileId}`, { method: "DELETE" }),
    togglePreview: (messageFileId: string, show: boolean) =>
      authFetch(`/api/discussions/message-files/${messageFileId}/preview`, {
        method: "PATCH",
        body: JSON.stringify({ show_preview: show }),
      }),
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
