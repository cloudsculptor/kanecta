import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.js";
import pool from "../db.js";
import { notifyThreadSubscribers } from "./push.js";
import { broadcastFcm, notifyThreadSubscribersFcm } from "../lib/fcm.js";
import { uploadFile, deleteFile, getFileStream } from "../lib/spaces.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const PUBLIC_URL = process.env.SPACES_PUBLIC_URL;

const router = Router();
const canAccess = requireRole("team", "moderator");

async function attachFilesToMessage(messageId, fileIds, uploaderId) {
  if (!fileIds?.length) return;
  await pool.query(
    `INSERT INTO discussions_message_files (message_id, file_id)
     SELECT $1, id FROM files
     WHERE id = ANY($2::uuid[]) AND uploaded_by_id = $3
     ON CONFLICT DO NOTHING`,
    [messageId, fileIds, uploaderId]
  );
}

async function fetchMessageFiles(messageId) {
  if (!PUBLIC_URL) return [];
  const { rows } = await pool.query(
    `SELECT dmf.id, f.id AS file_id, f.name, f.mime_type, f.size_bytes, f.storage_key, dmf.show_preview
     FROM discussions_message_files dmf
     JOIN files f ON f.id = dmf.file_id
     WHERE dmf.message_id = $1
     ORDER BY dmf.created_at`,
    [messageId]
  );
  return rows.map(f => ({ ...f, url: `${PUBLIC_URL}/${f.storage_key}` }));
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
    const { rows } = await pool.query(
      "SELECT name, storage_key, mime_type FROM files WHERE id = $1",
      [req.params.fileId]
    );
    if (!rows.length) return res.status(404).json({ error: "File not found" });
    const { name, storage_key, mime_type } = rows[0];
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
    const { rows } = await pool.query(
      "SELECT id, storage_key, uploaded_by_id FROM files WHERE id = $1",
      [req.params.fileId]
    );
    if (!rows.length) return res.status(404).json({ error: "File not found" });
    const file = rows[0];
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
    const { rows } = await pool.query(
      `UPDATE discussions_message_files dmf
       SET show_preview = $1
       FROM discussions_messages m
       WHERE dmf.id = $2 AND dmf.message_id = m.id AND m.user_id = $3
       RETURNING dmf.id`,
      [show_preview, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found or not authorised" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update preview" });
  }
});

// ── Threads ──────────────────────────────────────────────────────────────────

router.get("/threads", requireAuth, canAccess, async (req, res) => {
  try {
    // Seed read state for first-time visitors so they start with everything read
    const { rows: existing } = await pool.query(
      "SELECT 1 FROM discussions_thread_reads WHERE user_id = $1 LIMIT 1",
      [req.user.id]
    );
    if (existing.length === 0) {
      await pool.query(
        `INSERT INTO discussions_thread_reads (user_id, thread_id, last_read_at)
         SELECT $1, id, COALESCE(latest_message_at, NOW())
         FROM discussions_threads WHERE archived_at IS NULL
         ON CONFLICT DO NOTHING`,
        [req.user.id]
      );
    }

    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.description, t.created_by_name, t.created_by_user_id, t.created_at,
              CASE WHEN t.latest_message_at IS NOT NULL
                        AND (r.last_read_at IS NULL OR t.latest_message_at > r.last_read_at)
                   THEN true ELSE false END AS has_unread,
              CASE WHEN tns.user_id IS NOT NULL THEN true ELSE false END AS is_notifications_enabled
       FROM discussions_threads t
       LEFT JOIN discussions_thread_reads r ON r.thread_id = t.id AND r.user_id = $1
       LEFT JOIN thread_notification_subscriptions tns ON tns.thread_id = t.id AND tns.user_id = $1
       WHERE t.archived_at IS NULL
       ORDER BY t.sort_order ASC NULLS LAST, t.name ASC`,
      [req.user.id]
    );
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
    const { rows: dupes } = await pool.query(
      `SELECT id, name, description FROM discussions_threads
       WHERE archived_at IS NULL
         AND LOWER(REGEXP_REPLACE(name, '\\s+', '', 'g')) = $1`,
      [normalized]
    );
    if (dupes.length > 0) {
      return res.status(409).json({ error: "A thread with this name already exists", existing: dupes[0] });
    }
    const { rows } = await pool.query(
      `INSERT INTO discussions_threads (name, description, created_by_user_id, created_by_name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), description?.trim() || null, req.user.id, req.user.name]
    );
    const thread = rows[0];
    req.io?.emit("thread:new", thread);
    ;(async () => {
      await broadcastFcm("discussions", req.user.id, {
        title: "New thread: " + thread.name,
        body: req.user.name + (thread.description ? ": " + thread.description.slice(0, 80) : ""),
        url: "/discussions#" + thread.id,
      });
    })().catch(() => {});
    res.status(201).json(thread);
  } catch (err) {
    res.status(500).json({ error: "Failed to create thread" });
  }
});

router.patch("/threads/:threadId/archive", requireAuth, canAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT created_by_user_id, created_by_name FROM discussions_threads
       WHERE id = $1 AND archived_at IS NULL`,
      [req.params.threadId]
    );
    if (!rows.length) return res.status(404).json({ error: "Thread not found" });

    const isModerator = req.user.roles.includes("moderator");
    if (!isModerator && rows[0].created_by_user_id !== req.user.id) {
      return res.status(403).json({
        error: "Only the thread creator or an admin can archive this thread",
        created_by_name: rows[0].created_by_name,
      });
    }

    await pool.query(
      "UPDATE discussions_threads SET archived_at = NOW() WHERE id = $1",
      [req.params.threadId]
    );
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
    const { rows } = await pool.query(
      `SELECT m.id, m.thread_id, m.user_id, m.user_name, m.content, m.created_at, m.edited_at, m.deleted_at,
              (SELECT COUNT(*) FROM discussions_messages r WHERE r.parent_message_id = m.id)::int AS reply_count,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', dmf.id, 'file_id', f.id, 'name', f.name,
                  'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
                  'storage_key', f.storage_key, 'show_preview', dmf.show_preview
                ) ORDER BY dmf.created_at)
                FROM discussions_message_files dmf
                JOIN files f ON f.id = dmf.file_id
                WHERE dmf.message_id = m.id),
                '[]'::json
              ) AS files
       FROM discussions_messages m
       WHERE thread_id = $1
         AND parent_message_id IS NULL
         ${before ? "AND created_at < $3" : ""}
       ORDER BY created_at ASC
       LIMIT $2`,
      before ? [threadId, limit, before] : [threadId, limit]
    );
    const publicUrl = PUBLIC_URL || "";
    res.json(rows.map(m => ({
      ...m,
      files: (m.files || []).map(f => ({ ...f, url: `${publicUrl}/${f.storage_key}` })),
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
    const { rows } = await pool.query(
      `INSERT INTO discussions_messages (thread_id, user_id, user_name, content)
       VALUES ($1, $2, $3, $4) RETURNING *, 0 AS reply_count`,
      [threadId, req.user.id, req.user.name, content?.trim() ?? ""]
    );
    const message = rows[0];
    await attachFilesToMessage(message.id, fileIds, req.user.id);
    await pool.query(
      "UPDATE discussions_threads SET latest_message_at = $1 WHERE id = $2",
      [message.created_at, threadId]
    );
    await pool.query(
      `INSERT INTO discussions_thread_reads (user_id, thread_id, last_read_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at
       WHERE EXCLUDED.last_read_at > discussions_thread_reads.last_read_at`,
      [req.user.id, threadId, message.created_at]
    );
    const files = await fetchMessageFiles(message.id);
    req.io?.to(`thread:${threadId}`).emit("message:new", { ...message, files });
    req.io?.emit("thread:activity", { thread_id: threadId });
    ;(async () => {
      const { rows: tr } = await pool.query("SELECT name FROM discussions_threads WHERE id = $1", [threadId]);
      const notifPayload = {
        title: `#${tr[0]?.name ?? "Featherston"}`,
        body: `${req.user.name}: ${message.content.slice(0, 100)}`,
        url: `/discussions#${threadId}`,
      };
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
    const { rows } = await pool.query(
      `UPDATE discussions_messages
       SET content = $1, edited_at = NOW()
       WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL
       RETURNING *`,
      [content.trim(), req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Message not found or not yours" });
    const message = rows[0];
    req.io?.to(`thread:${message.thread_id}`).emit("message:edit", message);
    res.json(message);
  } catch (err) {
    res.status(500).json({ error: "Failed to edit message" });
  }
});

router.delete("/messages/:id", requireAuth, canAccess, async (req, res) => {
  const isModerator = req.user.roles.includes("moderator");
  try {
    const { rows } = await pool.query(
      `UPDATE discussions_messages
       SET deleted_at = NOW(), content = ''
       WHERE id = $1 ${isModerator ? "" : "AND user_id = $2"} AND deleted_at IS NULL
       RETURNING *`,
      isModerator ? [req.params.id] : [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Message not found" });
    const message = rows[0];
    req.io?.to(`thread:${message.thread_id}`).emit("message:delete", { id: message.id, thread_id: message.thread_id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// ── Replies ───────────────────────────────────────────────────────────────────

router.get("/messages/:id/replies", requireAuth, canAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.thread_id, m.parent_message_id, m.user_id, m.user_name, m.content,
              m.created_at, m.edited_at, m.deleted_at,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', dmf.id, 'file_id', f.id, 'name', f.name,
                  'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
                  'storage_key', f.storage_key, 'show_preview', dmf.show_preview
                ) ORDER BY dmf.created_at)
                FROM discussions_message_files dmf
                JOIN files f ON f.id = dmf.file_id
                WHERE dmf.message_id = m.id),
                '[]'::json
              ) AS files
       FROM discussions_messages m
       WHERE parent_message_id = $1
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    const publicUrl = PUBLIC_URL || "";
    res.json(rows.map(m => ({
      ...m,
      files: (m.files || []).map(f => ({ ...f, url: `${publicUrl}/${f.storage_key}` })),
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch replies" });
  }
});

router.post("/messages/:id/replies", requireAuth, canAccess, async (req, res) => {
  const { content, fileIds } = req.body;
  if (!content?.trim() && !fileIds?.length) return res.status(400).json({ error: "Content or a file is required" });
  try {
    const parent = await pool.query(
      "SELECT id, thread_id FROM discussions_messages WHERE id = $1 AND parent_message_id IS NULL",
      [req.params.id]
    );
    if (!parent.rows.length) return res.status(404).json({ error: "Parent message not found" });
    const { thread_id } = parent.rows[0];
    const { rows } = await pool.query(
      `INSERT INTO discussions_messages (thread_id, parent_message_id, user_id, user_name, content)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [thread_id, req.params.id, req.user.id, req.user.name, content?.trim() ?? ""]
    );
    const reply = rows[0];
    await attachFilesToMessage(reply.id, fileIds, req.user.id);
    await pool.query(
      "UPDATE discussions_threads SET latest_message_at = $1 WHERE id = $2",
      [reply.created_at, thread_id]
    );
    await pool.query(
      `INSERT INTO discussions_thread_reads (user_id, thread_id, last_read_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at
       WHERE EXCLUDED.last_read_at > discussions_thread_reads.last_read_at`,
      [req.user.id, thread_id, reply.created_at]
    );
    const files = await fetchMessageFiles(reply.id);
    req.io?.to(`replies:${req.params.id}`).emit("reply:new", { ...reply, files });
    req.io?.to(`thread:${thread_id}`).emit("message:reply_count", { message_id: req.params.id });
    req.io?.emit("thread:activity", { thread_id });
    ;(async () => {
      const { rows: tr } = await pool.query("SELECT name FROM discussions_threads WHERE id = $1", [thread_id]);
      await notifyThreadSubscribers(thread_id, req.user.id, {
        title: `#${tr[0]?.name ?? "Featherston"}`,
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
    await pool.query(
      `INSERT INTO thread_notification_subscriptions (user_id, thread_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, req.params.threadId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to subscribe to notifications" });
  }
});

router.delete("/threads/:threadId/notifications", requireAuth, canAccess, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM thread_notification_subscriptions WHERE user_id = $1 AND thread_id = $2",
      [req.user.id, req.params.threadId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to unsubscribe from notifications" });
  }
});

// ── Read state ────────────────────────────────────────────────────────────────

router.get("/unreads", requireAuth, canAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id AS thread_id, t.name, rd.last_read_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', m.id,
                    'thread_id', m.thread_id,
                    'parent_message_id', m.parent_message_id,
                    'user_id', m.user_id,
                    'user_name', m.user_name,
                    'content', m.content,
                    'created_at', m.created_at,
                    'edited_at', m.edited_at,
                    'deleted_at', m.deleted_at,
                    'reply_count', (SELECT COUNT(*)::int FROM discussions_messages rc WHERE rc.parent_message_id = m.id)
                  ) ORDER BY m.created_at ASC
                ) FILTER (WHERE m.id IS NOT NULL),
                '[]'::json
              ) AS messages
       FROM discussions_threads t
       JOIN discussions_thread_reads rd ON rd.thread_id = t.id AND rd.user_id = $1
       LEFT JOIN discussions_messages m ON m.thread_id = t.id
         AND m.deleted_at IS NULL
         AND (
           -- New top-level messages from others
           (m.parent_message_id IS NULL AND m.created_at > rd.last_read_at AND m.user_id != $1)
           OR
           -- New replies from others
           (m.parent_message_id IS NOT NULL AND m.created_at > rd.last_read_at AND m.user_id != $1)
           OR
           -- Parent messages of new replies from others (shown as context)
           (m.parent_message_id IS NULL AND EXISTS (
             SELECT 1 FROM discussions_messages nr
             WHERE nr.parent_message_id = m.id
               AND nr.created_at > rd.last_read_at
               AND nr.deleted_at IS NULL
               AND nr.user_id != $1
           ))
         )
       WHERE t.archived_at IS NULL
         AND t.latest_message_at IS NOT NULL
         AND t.latest_message_at > rd.last_read_at
       GROUP BY t.id, t.name, rd.last_read_at
       ORDER BY t.created_at ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch unreads" });
  }
});

router.post("/threads/:threadId/reads", requireAuth, canAccess, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO discussions_thread_reads (user_id, thread_id, last_read_at)
       VALUES ($1, $2, COALESCE(
         (SELECT MAX(created_at) FROM discussions_messages WHERE thread_id = $2),
         NOW()
       ))
       ON CONFLICT (user_id, thread_id)
       DO UPDATE SET last_read_at = EXCLUDED.last_read_at`,
      [req.user.id, req.params.threadId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark thread as read" });
  }
});

// ── Reactions ─────────────────────────────────────────────────────────────────

router.get("/threads/:threadId/reactions", requireAuth, canAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT dr.message_id, dr.emoji, COUNT(*) AS count,
              array_agg(dr.user_id) AS user_ids, array_agg(dr.user_name) AS user_names
       FROM discussions_reactions dr
       JOIN discussions_messages dm ON dm.id = dr.message_id
       WHERE dm.thread_id = $1
       GROUP BY dr.message_id, dr.emoji`,
      [req.params.threadId]
    );
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
    await pool.query(
      `INSERT INTO discussions_reactions (message_id, user_id, user_name, emoji) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.id, req.user.name, emoji]
    );
    const { rows } = await pool.query(
      `SELECT emoji, COUNT(*) AS count, array_agg(user_id) AS user_ids, array_agg(user_name) AS user_names
       FROM discussions_reactions WHERE message_id = $1 GROUP BY emoji`,
      [req.params.id]
    );
    const msg = await pool.query("SELECT thread_id FROM discussions_messages WHERE id = $1", [req.params.id]);
    req.io?.to(`thread:${msg.rows[0]?.thread_id}`).emit("reaction:update", { message_id: req.params.id, reactions: rows });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to add reaction" });
  }
});

router.delete("/messages/:id/reactions/:emoji", requireAuth, canAccess, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM discussions_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
      [req.params.id, req.user.id, req.params.emoji]
    );
    const { rows } = await pool.query(
      `SELECT emoji, COUNT(*) AS count, array_agg(user_id) AS user_ids, array_agg(user_name) AS user_names
       FROM discussions_reactions WHERE message_id = $1 GROUP BY emoji`,
      [req.params.id]
    );
    const msg = await pool.query("SELECT thread_id FROM discussions_messages WHERE id = $1", [req.params.id]);
    req.io?.to(`thread:${msg.rows[0]?.thread_id}`).emit("reaction:update", { message_id: req.params.id, reactions: rows });
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
