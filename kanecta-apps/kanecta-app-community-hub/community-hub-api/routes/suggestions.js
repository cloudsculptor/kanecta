import { Router } from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const requireTeam = requireRole("team", "moderator", "admin");

router.post("/", requireAuth, wrap(async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== "string") {
    return res.status(400).json({ error: "content is required" });
  }
  const trimmed = content.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) {
    return res.status(400).json({ error: "content must be 1–2000 characters" });
  }
  const userId = req.user.sub;
  const userName = req.user.name || req.user.preferred_username || null;
  const { rows } = await pool.query(
    `INSERT INTO suggestions (content, submitted_by_id, submitted_by_name)
     VALUES ($1, $2, $3) RETURNING id`,
    [trimmed, userId, userName]
  );
  res.status(201).json({ id: rows[0].id });
}));

router.get("/", requireTeam, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, content, submitted_by_name, submitted_at
     FROM suggestions
     ORDER BY submitted_at DESC`
  );
  res.json(rows);
}));

export default router;
