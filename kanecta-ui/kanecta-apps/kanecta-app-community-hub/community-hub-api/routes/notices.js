import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listApprovedNotices,
  listMyNotices,
  listPendingNotices,
  createNotice,
  getNoticeOwner,
  softDeleteNotice,
  approveNotice,
  declineNotice,
} from "../repositories/notices.js";

const router = Router();
const requireModerator = requireRole("moderator", "admin");
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ── GET /api/notices ───────────────────────────────────────────────────────────
// Public. Returns approved non-deleted notices, newest first.

router.get("/", wrap(async (req, res) => {
  res.json(await listApprovedNotices());
}));

// ── GET /api/notices/mine ──────────────────────────────────────────────────────
// Auth. Returns current user's non-deleted notices.

router.get("/mine", requireAuth, wrap(async (req, res) => {
  res.json(await listMyNotices(req.user.id));
}));

// ── GET /api/notices/pending ───────────────────────────────────────────────────
// Moderator only. Returns all pending non-deleted notices.

router.get("/pending", requireAuth, requireModerator, wrap(async (req, res) => {
  res.json(await listPendingNotices());
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

  const row = await createNotice({
    heading: heading.trim(), body: bodyText, noticeDate: notice_date || null,
    submittedById: req.user.id, submittedByName: req.user.name,
  });
  res.status(201).json({ id: row.id });
}));

// ── DELETE /api/notices/:id ────────────────────────────────────────────────────
// Auth + owner. Soft-deletes the notice.

router.delete("/:id", requireAuth, wrap(async (req, res) => {
  const ownerId = await getNoticeOwner(req.params.id);
  if (ownerId === null) return res.status(404).json({ error: "Notice not found" });
  if (ownerId !== req.user.id) {
    return res.status(403).json({ error: "Not your notice" });
  }
  await softDeleteNotice(req.params.id);
  res.json({ ok: true });
}));

// ── PATCH /api/notices/:id/approve ────────────────────────────────────────────

router.patch("/:id/approve", requireAuth, requireModerator, wrap(async (req, res) => {
  const row = await approveNotice({ id: req.params.id, reviewedById: req.user.id, reviewedByName: req.user.name });
  if (!row) return res.status(404).json({ error: "Notice not found or not pending" });
  res.json({ ok: true });
}));

// ── PATCH /api/notices/:id/decline ────────────────────────────────────────────

router.patch("/:id/decline", requireAuth, requireModerator, wrap(async (req, res) => {
  const { decline_reason } = req.body;
  const row = await declineNotice({
    id: req.params.id, declineReason: decline_reason?.trim() || null,
    reviewedById: req.user.id, reviewedByName: req.user.name,
  });
  if (!row) return res.status(404).json({ error: "Notice not found or not pending" });
  res.json({ ok: true });
}));

// ── Error handler ─────────────────────────────────────────────────────────────

router.use((err, req, res, _next) => {
  console.error("[notices]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

export default router;
