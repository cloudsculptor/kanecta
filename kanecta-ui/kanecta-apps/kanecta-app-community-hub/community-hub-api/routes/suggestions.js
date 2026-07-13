import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { broadcastFcm } from "../lib/fcm.js";
import { notify } from "../lib/notification-templates.js";
import { adminFetch } from "../lib/keycloakAdmin.js";
import {
  createSuggestion,
  listActiveSuggestions,
  listArchivedSuggestions,
  archiveSuggestion,
} from "../repositories/suggestions.js";

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
  const row = await createSuggestion({ content: trimmed, submittedById: userId, submittedByName: userName });
  ;(async () => {
    await broadcastFcm("suggestions", req.user.id, notify.suggestionCreated({
      authorName: userName,
      content: trimmed,
    }));
  })().catch(() => {});
  res.status(201).json({ id: row.id });
}));

router.get("/", requireAuth, requireModerator, wrap(async (req, res) => {
  res.json(await listActiveSuggestions());
}));

router.get("/archived", requireAuth, requireModerator, wrap(async (req, res) => {
  const rows = await listArchivedSuggestions();

  const uniqueIds = [...new Set(rows.map((r) => r.archived_by_id).filter(Boolean))];
  const nameMap = {};
  await Promise.all(uniqueIds.map(async (id) => {
    try {
      const user = await adminFetch(`/users/${id}`);
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || null;
      nameMap[id] = name;
    } catch {
      nameMap[id] = null;
    }
  }));

  res.json(rows.map((r) => ({ ...r, archived_by_name: nameMap[r.archived_by_id] ?? null })));
}));

router.patch("/:id/archive", requireAuth, requireModerator, wrap(async (req, res) => {
  const rowCount = await archiveSuggestion({ id: req.params.id, archivedById: req.user.id });
  if (rowCount === 0) return res.status(404).json({ error: "Not found or already archived" });
  res.json({ ok: true });
}));

export default router;
