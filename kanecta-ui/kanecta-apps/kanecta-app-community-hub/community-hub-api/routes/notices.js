import { Router } from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const requireModerator = requireRole("moderator", "admin");
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ── GET /api/notices ───────────────────────────────────────────────────────────
// Public. Returns approved non-deleted notices, newest first.

router.get("/", wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, heading, body, notice_date, submitted_by_name, submitted_at
     FROM notices
     WHERE status = 'approved' AND deleted_at IS NULL
     ORDER BY submitted_at DESC`
  );
  res.json(rows);
}));

// ── GET /api/notices/mine ──────────────────────────────────────────────────────
// Auth. Returns current user's non-deleted notices.

router.get("/mine", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, heading, notice_date, status, decline_reason, submitted_at
     FROM notices
     WHERE submitted_by_id = $1 AND deleted_at IS NULL
     ORDER BY submitted_at DESC`,
    [req.user.id]
  );
  res.json(rows);
}));

// ── GET /api/notices/pending ───────────────────────────────────────────────────
// Moderator only. Returns all pending non-deleted notices.

router.get("/pending", requireAuth, requireModerator, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, heading, body, notice_date, submitted_by_name, submitted_at
     FROM notices
     WHERE status = 'pending' AND deleted_at IS NULL
     ORDER BY submitted_at ASC`
  );
  res.json(rows);
}));

// ── POST /api/notices ──────────────────────────────────────────────────────────
// Auth + email verified. Creates a pending notice.

router.post("/", requireAuth, wrap(async (req, res) => {
  if (!req.user.email_verified) {
    return res.status(403).json({ error: "Email address not verified" });
  }
  const { heading, body, notice_date } = req.body;
  if (!heading?.trim()) return res.status(400).json({ error: "Heading is required" });
  if (heading.trim().length > 120) return res.status(400).json({ error: "Heading must be 120 characters or fewer" });
  const bodyText = body?.trim() || "";
  if (!bodyText) return res.status(400).json({ error: "Body is required" });
  if (bodyText.length > 2000) return res.status(400).json({ error: "Body must be 2000 characters or fewer" });

  const { rows } = await pool.query(
    `INSERT INTO notices (heading, body, notice_date, submitted_by_id, submitted_by_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [heading.trim(), bodyText, notice_date || null, req.user.id, req.user.name]
  );
  res.status(201).json({ id: rows[0].id });
}));

// ── DELETE /api/notices/:id ────────────────────────────────────────────────────
// Auth + owner. Soft-deletes the notice.

router.delete("/:id", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT submitted_by_id FROM notices WHERE id = $1 AND deleted_at IS NULL",
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Notice not found" });
  if (rows[0].submitted_by_id !== req.user.id) {
    return res.status(403).json({ error: "Not your notice" });
  }
  await pool.query("UPDATE notices SET deleted_at = NOW() WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

// ── PATCH /api/notices/:id/approve ────────────────────────────────────────────

router.patch("/:id/approve", requireAuth, requireModerator, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE notices
     SET status = 'approved', reviewed_by_id = $1, reviewed_by_name = $2, reviewed_at = NOW()
     WHERE id = $3 AND status = 'pending' AND deleted_at IS NULL
     RETURNING id`,
    [req.user.id, req.user.name, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Notice not found or not pending" });
  res.json({ ok: true });
}));

// ── PATCH /api/notices/:id/decline ────────────────────────────────────────────

router.patch("/:id/decline", requireAuth, requireModerator, wrap(async (req, res) => {
  const { decline_reason } = req.body;
  const { rows } = await pool.query(
    `UPDATE notices
     SET status = 'declined', decline_reason = $1,
         reviewed_by_id = $2, reviewed_by_name = $3, reviewed_at = NOW()
     WHERE id = $4 AND status = 'pending' AND deleted_at IS NULL
     RETURNING id`,
    [decline_reason?.trim() || null, req.user.id, req.user.name, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Notice not found or not pending" });
  res.json({ ok: true });
}));

// ── Error handler ─────────────────────────────────────────────────────────────

router.use((err, req, res, _next) => {
  console.error("[notices]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

export default router;
