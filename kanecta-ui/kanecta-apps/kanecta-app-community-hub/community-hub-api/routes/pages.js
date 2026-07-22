import { Router } from "express";
import multer from "multer";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadFile } from "../lib/spaces.js";
import { broadcastFcm } from "../lib/fcm.js";
import { notify } from "../lib/notification-templates.js";
import * as pagesRepo from "../repositories/pages.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

// TODO: replace with a proper group-selection UI once multi-group support is built
const RESILIENCE_GROUP_ID = "94a7ad3b-89bb-49c6-a97d-228f8758517a";

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const requireTeam = requireRole("team", "moderator");

// ── List pages ────────────────────────────────────────────────────────────────
router.get("/", requireAuth, wrap(async (req, res) => {
  res.json(await pagesRepo.listPages());
}));

// ── Upload file (must come before /:slug to avoid conflict) ───────────────────
router.post("/upload", requireAuth, requireTeam, upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });
  const { file, url } = await uploadFile({
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
    originalName: req.file.originalname,
    uploadedById: req.user.id,
    uploadedByName: req.user.name,
    pool,
  });
  res.status(201).json({ id: file.id, url, name: file.name, mime_type: file.mime_type });
}));

// ── List public pages (no auth) ───────────────────────────────────────────────
router.get("/public", wrap(async (req, res) => {
  res.json(await pagesRepo.listPublicPages());
}));

// ── Get public page by slug (no auth) ─────────────────────────────────────────
router.get("/public/:slug", wrap(async (req, res) => {
  const page = await pagesRepo.getPublicPageBySlug(req.params.slug);
  if (!page) return res.status(404).json({ error: "Not found" });
  res.json(page);
}));

// ── Get page history (must come before /:slug) ────────────────────────────────
router.get("/:slug/history", requireAuth, requireTeam, wrap(async (req, res) => {
  const page = await pagesRepo.getPageIdBySlug(req.params.slug);
  if (!page) return res.status(404).json({ error: "Not found" });
  res.json(await pagesRepo.getPageHistory(page.id));
}));

// ── Get specific page version (must come before /:slug) ───────────────────────
router.get("/:slug/version/:version", requireAuth, requireTeam, wrap(async (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) return res.status(400).json({ error: "Invalid version" });

  const page = await pagesRepo.getPageIdTitleBySlug(req.params.slug);
  if (!page) return res.status(404).json({ error: "Not found" });

  const row = await pagesRepo.getPageVersion(page.id, version);
  if (!row) return res.status(404).json({ error: "Version not found" });
  res.json({ ...row, title: page.title });
}));

// ── Get page by slug ──────────────────────────────────────────────────────────
router.get("/:slug", requireAuth, wrap(async (req, res) => {
  const page = await pagesRepo.getPageBySlug(req.params.slug);
  if (!page) return res.status(404).json({ error: "Not found" });
  res.json(page);
}));

// ── Create page ───────────────────────────────────────────────────────────────
router.post("/", requireAuth, requireTeam, wrap(async (req, res) => {
  const { slug, title, content_json, licence_id, owner_type, owner_id } = req.body;
  if (!slug || !SLUG_RE.test(slug))
    return res.status(400).json({ error: "Invalid slug: use lowercase letters, numbers, and hyphens only (no leading or trailing hyphens)" });

  const page = await pagesRepo.createPageWithHistory({
    slug, title, contentJson: content_json,
    createdById: req.user.id, createdByName: req.user.name,
    licenceId: licence_id,
    ownerType: owner_type,
    ownerId: owner_id || RESILIENCE_GROUP_ID,
  });
  res.status(201).json(page);
}));

// ── Update page ───────────────────────────────────────────────────────────────
router.put("/:slug", requireAuth, requireTeam, wrap(async (req, res) => {
  const { title, content_json, new_slug, licence_id, public: isPublic, owner_type, owner_id } = req.body;
  const targetSlug = new_slug ?? req.params.slug;

  if (new_slug !== undefined && !SLUG_RE.test(new_slug))
    return res.status(400).json({ error: "Invalid slug" });

  const result = await pagesRepo.updatePageWithHistory({
    currentSlug: req.params.slug, targetSlug,
    title, contentJson: content_json, licenceId: licence_id, isPublic,
    ownerType: owner_type, ownerId: owner_id,
    userId: req.user.id, userName: req.user.name,
  });
  if (!result) return res.status(404).json({ error: "Not found" });

  const { row, action } = result;
  if (action === "Published") {
    ;(async () => {
      await broadcastFcm("pages", req.user.id, notify.pagePublished({
        title: title || row.title || "Untitled",
        authorName: req.user.name,
        slug: row.slug,
      }));
    })().catch(() => {});
  }
  res.json(row);
}));

// ── Delete page (soft delete) ─────────────────────────────────────────────────
router.delete("/:slug", requireAuth, requireTeam, wrap(async (req, res) => {
  const existing = await pagesRepo.getLivePageIdBySlug(req.params.slug);
  if (!existing) return res.status(404).json({ error: "Not found" });

  await pagesRepo.softDeletePage(req.params.slug);
  res.json({ deleted: existing.id });
}));

// ── Error handler ─────────────────────────────────────────────────────────────
router.use((err, req, res, _next) => {
  console.error("[pages]", err.message);
  if (err.code === "23505") return res.status(409).json({ error: "A page with that slug already exists" });
  res.status(500).json({ error: "Internal server error" });
});

export default router;
