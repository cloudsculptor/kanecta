import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import pool from "../db.js";

const router = Router();
const canAccess = requireRole("team", "moderator");

// ── Threads ──────────────────────────────────────────────────────────────────

router.get("/threads", requireAuth, canAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, created_by_name, created_at
       FROM discussions_threads
       WHERE archived_at IS NULL
       ORDER BY created_at ASC`
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

// ── Messages ─────────────────────────────────────────────────────────────────

router.get("/threads/:threadId/messages", requireAuth, canAccess, async (req, res) => {
  const { threadId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before;
  try {
    const { rows } = await pool.query(
      `SELECT id, thread_id, user_id, user_name, content, created_at, edited_at, deleted_at,
              (SELECT COUNT(*) FROM discussions_messages r WHERE r.parent_message_id = m.id) AS reply_count
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
    req.io?.to(`thread:${threadId}`).emit("message:new", message);
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
    req.io?.to(`replies:${req.params.id}`).emit("reply:new", reply);
    req.io?.to(`thread:${thread_id}`).emit("message:reply_count", { message_id: req.params.id });
    res.status(201).json(reply);
  } catch (err) {
    res.status(500).json({ error: "Failed to post reply" });
  }
});

// ── Reactions ─────────────────────────────────────────────────────────────────

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
