import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.js";
import pool from "../db.js";
import { notifyThreadSubscribers } from "./push.js";
import { broadcastFcm, notifyThreadSubscribersFcm } from "../lib/fcm.js";
import { notify } from "../lib/notification-templates.js";
import { uploadFile, deleteFile, getFileStream, fileUrl } from "../lib/spaces.js";
import * as discussionsRepo from "../repositories/discussions.js";
import { USE_KANECTA } from "../repositories/backend.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();
const canAccess = requireRole("team", "moderator");

// Backend-aware URL: pg → Spaces CDN key, kanecta → file proxy (a CDN URL built
// from the kanecta storage_key 403s — same bug as the events images).
const withUrl = (f) => ({ ...f, url: fileUrl({ fileId: f.file_id, storageKey: f.storage_key, mimeType: f.mime_type }) });

async function fetchMessageFiles(messageId) {
  if (!USE_KANECTA && !process.env.SPACES_PUBLIC_URL) return [];
  const rows = await discussionsRepo.getMessageFiles(messageId);
  return rows.map(withUrl);
}

// ── File upload / delete / preview toggle ─────────────────────────────────────

router.post("/messages/upload", requireAuth, canAccess, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });
  try {
    const { file, url } = await uploadFile({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      uploadedById: req.user.id,
      uploadedByName: req.user.name,
      pool,
    });
    res.status(201).json({ id: file.id, url, name: file.name, mime_type: file.mime_type, size_bytes: file.size_bytes });
  } catch (err) {
    res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/files/:fileId/download", requireAuth, canAccess, async (req, res) => {
  try {
    const file = await discussionsRepo.getFileForDownload(req.params.fileId);
    if (!file) return res.status(404).json({ error: "File not found" });
    const { name, storage_key, mime_type } = file;
    const { Body } = await getFileStream({ storageKey: storage_key });
    const encoded = encodeURIComponent(name);
    res.setHeader("Content-Type", mime_type);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encoded}`);
    Body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: "Download failed" });
  }
});

router.delete("/files/:fileId", requireAuth, canAccess, async (req, res) => {
  const isModerator = req.user.roles.includes("moderator");
  try {
    const file = await discussionsRepo.getFileForDelete(req.params.fileId);
    if (!file) return res.status(404).json({ error: "File not found" });
    if (!isModerator && file.uploaded_by_id !== req.user.id) {
      return res.status(403).json({ error: "Not authorised to delete this file" });
    }
    await deleteFile({ storageKey: file.storage_key, fileId: file.id, pool });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete file" });
  }
});

router.patch("/message-files/:id/preview", requireAuth, canAccess, async (req, res) => {
  const { show_preview } = req.body;
  if (typeof show_preview !== "boolean") return res.status(400).json({ error: "show_preview must be boolean" });
  try {
    const row = await discussionsRepo.setMessageFilePreview(req.params.id, show_preview, req.user.id);
    if (!row) return res.status(404).json({ error: "Not found or not authorised" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update preview" });
  }
});

// ── Threads ──────────────────────────────────────────────────────────────────

router.get("/threads", requireAuth, canAccess, async (req, res) => {
  try {
    // Seed read state for first-time visitors so they start with everything read
    const hasReads = await discussionsRepo.hasThreadReads(req.user.id);
    if (!hasReads) {
      await discussionsRepo.seedThreadReads(req.user.id);
    }

    const rows = await discussionsRepo.listThreads(req.user.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

router.post("/threads", requireAuth, canAccess, async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Thread name is required" });
  try {
    const normalized = name.trim().toLowerCase().replace(/\s+/g, "");
    const dupes = await discussionsRepo.findDuplicateThreads(normalized);
    if (dupes.length > 0) {
      return res.status(409).json({ error: "A thread with this name already exists", existing: dupes[0] });
    }
    const thread = await discussionsRepo.createThread({
      name: name.trim(),
      description: description?.trim() || null,
      createdByUserId: req.user.id,
      createdByName: req.user.name,
    });
    req.io?.emit("thread:new", thread);
    ;(async () => {
      await broadcastFcm("discussions", req.user.id, notify.discussionThreadCreated({
        threadName: thread.name,
        authorName: req.user.name,
        description: thread.description,
        threadId: thread.id,
      }));
    })().catch(() => {});
    res.status(201).json(thread);
  } catch (err) {
    res.status(500).json({ error: "Failed to create thread" });
  }
});

router.patch("/threads/:threadId/archive", requireAuth, canAccess, async (req, res) => {
  try {
    const thread = await discussionsRepo.getThreadForArchive(req.params.threadId);
    if (!thread) return res.status(404).json({ error: "Thread not found" });

    const isModerator = req.user.roles.includes("moderator");
    if (!isModerator && thread.created_by_user_id !== req.user.id) {
      return res.status(403).json({
        error: "Only the thread creator or an admin can archive this thread",
        created_by_name: thread.created_by_name,
      });
    }

    await discussionsRepo.archiveThread(req.params.threadId);
    req.io?.emit("thread:archived", { id: req.params.threadId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to archive thread" });
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

router.get("/threads/:threadId/messages", requireAuth, canAccess, async (req, res) => {
  const { threadId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before;
  try {
    const rows = await discussionsRepo.listThreadMessages(threadId, limit, before);
    res.json(rows.map(m => ({
      ...m,
      files: (m.files || []).map(withUrl),
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/threads/:threadId/messages", requireAuth, canAccess, async (req, res) => {
  const { threadId } = req.params;
  const { content, fileIds } = req.body;
  if (!content?.trim() && !fileIds?.length) return res.status(400).json({ error: "Content or a file is required" });
  try {
    const message = await discussionsRepo.createMessage({
      threadId,
      userId: req.user.id,
      userName: req.user.name,
      content: content?.trim() ?? "",
    });
    await discussionsRepo.attachFilesToMessage(message.id, fileIds, req.user.id);
    await discussionsRepo.touchThreadLatestMessage(threadId, message.created_at);
    await discussionsRepo.upsertThreadRead(req.user.id, threadId, message.created_at);
    const files = await fetchMessageFiles(message.id);
    req.io?.to(`thread:${threadId}`).emit("message:new", { ...message, files });
    req.io?.emit("thread:activity", { thread_id: threadId });
    ;(async () => {
      const tr = await discussionsRepo.getThreadName(threadId);
      const notifPayload = notify.discussionMessage({
        threadName: tr?.name ?? "Featherston",
        authorName: req.user.name,
        content: message.content,
        threadId,
      });
      await notifyThreadSubscribers(threadId, req.user.id, notifPayload);
      await notifyThreadSubscribersFcm(threadId, req.user.id, notifPayload);
    })().catch(() => {});
    res.status(201).json({ ...message, files });
  } catch (err) {
    res.status(500).json({ error: "Failed to post message" });
  }
});

router.put("/messages/:id", requireAuth, canAccess, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Content is required" });
  try {
    const message = await discussionsRepo.updateMessage(req.params.id, content.trim(), req.user.id);
    if (!message) return res.status(404).json({ error: "Message not found or not yours" });
    req.io?.to(`thread:${message.thread_id}`).emit("message:edit", message);
    res.json(message);
  } catch (err) {
    res.status(500).json({ error: "Failed to edit message" });
  }
});

router.delete("/messages/:id", requireAuth, canAccess, async (req, res) => {
  const isModerator = req.user.roles.includes("moderator");
  try {
    const message = await discussionsRepo.deleteMessage(req.params.id, req.user.id, isModerator);
    if (!message) return res.status(404).json({ error: "Message not found" });
    req.io?.to(`thread:${message.thread_id}`).emit("message:delete", { id: message.id, thread_id: message.thread_id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// ── Replies ───────────────────────────────────────────────────────────────────

router.get("/messages/:id/replies", requireAuth, canAccess, async (req, res) => {
  try {
    const rows = await discussionsRepo.listReplies(req.params.id);
    res.json(rows.map(m => ({
      ...m,
      files: (m.files || []).map(withUrl),
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch replies" });
  }
});

router.post("/messages/:id/replies", requireAuth, canAccess, async (req, res) => {
  const { content, fileIds } = req.body;
  if (!content?.trim() && !fileIds?.length) return res.status(400).json({ error: "Content or a file is required" });
  try {
    const parent = await discussionsRepo.getParentMessage(req.params.id);
    if (!parent) return res.status(404).json({ error: "Parent message not found" });
    const { thread_id } = parent;
    const reply = await discussionsRepo.createReply({
      threadId: thread_id,
      parentMessageId: req.params.id,
      userId: req.user.id,
      userName: req.user.name,
      content: content?.trim() ?? "",
    });
    await discussionsRepo.attachFilesToMessage(reply.id, fileIds, req.user.id);
    await discussionsRepo.touchThreadLatestMessage(thread_id, reply.created_at);
    await discussionsRepo.upsertThreadRead(req.user.id, thread_id, reply.created_at);
    const files = await fetchMessageFiles(reply.id);
    req.io?.to(`replies:${req.params.id}`).emit("reply:new", { ...reply, files });
    req.io?.to(`thread:${thread_id}`).emit("message:reply_count", { message_id: req.params.id });
    req.io?.emit("thread:activity", { thread_id });
    ;(async () => {
      const tr = await discussionsRepo.getThreadName(thread_id);
      await notifyThreadSubscribers(thread_id, req.user.id, {
        title: `#${tr?.name ?? "Featherston"}`,
        body: `${req.user.name}: ${reply.content.slice(0, 100)}`,
        url: `/discussions#${thread_id}`,
      });
    })().catch(() => {});
    res.status(201).json({ ...reply, files });
  } catch (err) {
    res.status(500).json({ error: "Failed to post reply" });
  }
});

// ── Thread notification preferences ──────────────────────────────────────────

router.post("/threads/:threadId/notifications", requireAuth, canAccess, async (req, res) => {
  try {
    await discussionsRepo.subscribeThreadNotifications(req.user.id, req.params.threadId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to subscribe to notifications" });
  }
});

router.delete("/threads/:threadId/notifications", requireAuth, canAccess, async (req, res) => {
  try {
    await discussionsRepo.unsubscribeThreadNotifications(req.user.id, req.params.threadId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to unsubscribe from notifications" });
  }
});

// ── Read state ────────────────────────────────────────────────────────────────

router.get("/unreads", requireAuth, canAccess, async (req, res) => {
  try {
    const rows = await discussionsRepo.listUnreads(req.user.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch unreads" });
  }
});

router.post("/threads/:threadId/reads", requireAuth, canAccess, async (req, res) => {
  try {
    await discussionsRepo.markThreadRead(req.user.id, req.params.threadId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark thread as read" });
  }
});

// ── Reactions ─────────────────────────────────────────────────────────────────

router.get("/threads/:threadId/reactions", requireAuth, canAccess, async (req, res) => {
  try {
    const rows = await discussionsRepo.getThreadReactions(req.params.threadId);
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.message_id]) grouped[row.message_id] = [];
      grouped[row.message_id].push({ emoji: row.emoji, count: row.count, user_ids: row.user_ids, user_names: row.user_names });
    }
    res.json(grouped);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch reactions" });
  }
});

router.post("/messages/:id/reactions", requireAuth, canAccess, async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: "Emoji is required" });
  try {
    await discussionsRepo.addReaction(req.params.id, req.user.id, req.user.name, emoji);
    const rows = await discussionsRepo.getMessageReactions(req.params.id);
    const msg = await discussionsRepo.getMessageThreadId(req.params.id);
    req.io?.to(`thread:${msg?.thread_id}`).emit("reaction:update", { message_id: req.params.id, reactions: rows });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to add reaction" });
  }
});

router.delete("/messages/:id/reactions/:emoji", requireAuth, canAccess, async (req, res) => {
  try {
    await discussionsRepo.removeReaction(req.params.id, req.user.id, req.params.emoji);
    const rows = await discussionsRepo.getMessageReactions(req.params.id);
    const msg = await discussionsRepo.getMessageThreadId(req.params.id);
    req.io?.to(`thread:${msg?.thread_id}`).emit("reaction:update", { message_id: req.params.id, reactions: rows });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to remove reaction" });
  }
});

// ── Users (for @mention autocomplete) ────────────────────────────────────────

async function getKeycloakAdminToken() {
  const url = `${process.env.KEYCLOAK_ADMIN_URL || process.env.KEYCLOAK_URL || "https://auth.featherston.co.nz"}/realms/${process.env.KEYCLOAK_REALM || "featherston"}/protocol/openid-connect/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.KEYCLOAK_ADMIN_CLIENT_ID,
      client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Keycloak token error: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

router.get("/users", requireAuth, canAccess, async (req, res) => {
  try {
    const base = `${process.env.KEYCLOAK_ADMIN_URL || process.env.KEYCLOAK_URL || "https://auth.featherston.co.nz"}/admin/realms/${process.env.KEYCLOAK_REALM || "featherston"}`;
    const token = await getKeycloakAdminToken();

    const allUsersRes = await fetch(`${base}/users?max=500`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!allUsersRes.ok) throw new Error(`Keycloak users error: ${allUsersRes.status}`);
    const allUsers = await allUsersRes.json();

    const withRoles = await Promise.all(
      allUsers.map(async (u) => {
        const r = await fetch(`${base}/users/${u.id}/role-mappings/realm/composite`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return null;
        const roles = await r.json();
        return roles.some((role) => role.name === "team") ? u : null;
      })
    );

    const users = withRoles
      .filter(Boolean)
      .map((u) => ({
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(users);
  } catch (err) {
    console.error("Failed to fetch users from Keycloak:", err.message);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

export default router;
