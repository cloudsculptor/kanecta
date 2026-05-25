import { Router } from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { broadcastFcm } from "../lib/fcm.js";
import { notify } from "../lib/notification-templates.js";

const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const requireModerator = requireRole("moderator", "admin");

router.post("/", requireAuth, wrap(async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== "string") {
    return res.status(400).json({ error: "content is required" });
  }
  const trimmed = content.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) {
    return res.status(400).json({ error: "content must be 1–2000 characters" });
  }
  const userId = req.user.id;
  const userName = req.user.name || null;
  const { rows } = await pool.query(
    `INSERT INTO suggestions (content, submitted_by_id, submitted_by_name)
     VALUES ($1, $2, $3) RETURNING id`,
    [trimmed, userId, userName]
  );
  ;(async () => {
    await broadcastFcm("suggestions", req.user.id, notify.suggestionCreated({
      authorName: userName,
      content: trimmed,
    }));
  })().catch(() => {});
  res.status(201).json({ id: rows[0].id });
}));

router.get("/", requireAuth, requireModerator, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, content, submitted_by_name, submitted_at
     FROM suggestions
     WHERE archived_at IS NULL
     ORDER BY submitted_at DESC`
  );
  res.json(rows);
}));

router.get("/archived", requireAuth, requireModerator, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, content, submitted_by_name, submitted_at, archived_at, archived_by_id
     FROM suggestions
     WHERE archived_at IS NOT NULL
     ORDER BY archived_at DESC`
  );
  res.json(rows);
}));

router.patch("/:id/archive", requireAuth, requireModerator, wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE suggestions SET archived_at = NOW(), archived_by_id = $1
     WHERE id = $2 AND archived_at IS NULL`,
    [req.user.id, req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: "Not found or already archived" });
  res.json({ ok: true });
}));

export default router;
