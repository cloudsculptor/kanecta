import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import pool from "../db.js";
import { notifyThreadSubscribers } from "./push.js";

const router = Router();
const canAccess = requireRole("team", "moderator");

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
       ORDER BY t.created_at ASC`,
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
      `SELECT id, thread_id, user_id, user_name, content, created_at, edited_at, deleted_at,
              (SELECT COUNT(*) FROM discussions_messages r WHERE r.parent_message_id = m.id)::int AS reply_count
       FROM discussions_messages m
       WHERE thread_id = $1
         AND parent_message_id IS NULL
         ${before ? "AND created_at < $3" : ""}
       ORDER BY created_at ASC
       LIMIT $2`,
      before ? [threadId, limit, before] : [threadId, limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/threads/:threadId/messages", requireAuth, canAccess, async (req, res) => {
  const { threadId } = req.params;
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Content is required" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO discussions_messages (thread_id, user_id, user_name, content)
       VALUES ($1, $2, $3, $4) RETURNING *, 0 AS reply_count`,
      [threadId, req.user.id, req.user.name, content.trim()]
    );
    const message = rows[0];
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
    req.io?.to(`thread:${threadId}`).emit("message:new", message);
    req.io?.emit("thread:activity", { thread_id: threadId });
    ;(async () => {
      const { rows: tr } = await pool.query("SELECT name FROM discussions_threads WHERE id = $1", [threadId]);
      await notifyThreadSubscribers(threadId, req.user.id, {
        title: `#${tr[0]?.name ?? "Featherston"}`,
        body: `${req.user.name}: ${message.content.slice(0, 100)}`,
        url: `/discussions#${threadId}`,
      });
    })().catch(() => {});
    res.status(201).json(message);
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
      `SELECT id, thread_id, parent_message_id, user_id, user_name, content, created_at, edited_at, deleted_at
       FROM discussions_messages
       WHERE parent_message_id = $1
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch replies" });
  }
});

router.post("/messages/:id/replies", requireAuth, canAccess, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Content is required" });
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
      [thread_id, req.params.id, req.user.id, req.user.name, content.trim()]
    );
    const reply = rows[0];
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
    req.io?.to(`replies:${req.params.id}`).emit("reply:new", reply);
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
    res.status(201).json(reply);
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

router.get("/users", requireAuth, canAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT user_id AS id, user_name AS name
       FROM discussions_messages
       WHERE deleted_at IS NULL
       ORDER BY user_name ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

export default router;
