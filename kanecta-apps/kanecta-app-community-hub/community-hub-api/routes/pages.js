import { Router } from "express";
import multer from "multer";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadFile } from "../lib/spaces.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const PUBLIC_URL = process.env.SPACES_PUBLIC_URL;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const requireTeam = requireRole("team", "moderator");

// Walks a Lexical JSON tree and returns all file UUIDs referenced by image nodes.
function extractFileIds(contentJson) {
  const ids = new Set();
  if (!PUBLIC_URL || !contentJson?.root) return ids;
  const prefix = PUBLIC_URL + "/";

  function walk(node) {
    if (!node) return;
    if (node.type === "image" && typeof node.src === "string" && node.src.startsWith(prefix)) {
      const id = node.src.slice(prefix.length).split("/")[2];
      if (id && UUID_RE.test(id)) ids.add(id);
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }

  walk(contentJson.root);
  return ids;
}

// Soft-deletes files that were in oldIds but not in newIds.
async function softDeleteRemovedFiles(client, oldIds, newIds) {
  const removed = [...oldIds].filter(id => !newIds.has(id));
  if (removed.length) {
    await client.query(
      `UPDATE files SET deleted_at = NOW() WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [removed]
    );
  }
}

// ── List pages ────────────────────────────────────────────────────────────────
router.get("/", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, slug, title, created_by_name, created_at, updated_at FROM pages ORDER BY updated_at DESC"
  );
  res.json(rows);
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

// ── Get page by slug ──────────────────────────────────────────────────────────
router.get("/:slug", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM pages WHERE slug = $1", [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
}));

// ── Create page ───────────────────────────────────────────────────────────────
router.post("/", requireAuth, requireTeam, wrap(async (req, res) => {
  const { slug, title, content_json } = req.body;
  if (!slug || !SLUG_RE.test(slug))
    return res.status(400).json({ error: "Invalid slug: use lowercase letters, numbers, and hyphens only (no leading or trailing hyphens)" });

  const { rows } = await pool.query(
    `INSERT INTO pages (slug, title, content_json, created_by_id, created_by_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [slug, title || "", content_json || {}, req.user.id, req.user.name]
  );
  res.status(201).json(rows[0]);
}));

// ── Update page ───────────────────────────────────────────────────────────────
router.put("/:slug", requireAuth, requireTeam, wrap(async (req, res) => {
  const { title, content_json, new_slug } = req.body;
  const targetSlug = new_slug ?? req.params.slug;

  if (new_slug !== undefined && !SLUG_RE.test(new_slug))
    return res.status(400).json({ error: "Invalid slug" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query(
      "SELECT content_json FROM pages WHERE slug = $1", [req.params.slug]
    );
    if (!existing.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }

    const oldFileIds = extractFileIds(existing[0].content_json);
    const newFileIds = extractFileIds(content_json);

    const { rows } = await client.query(
      `UPDATE pages SET slug=$1, title=$2, content_json=$3, updated_at=NOW()
       WHERE slug=$4 RETURNING *`,
      [targetSlug, title || "", content_json || {}, req.params.slug]
    );

    await softDeleteRemovedFiles(client, oldFileIds, newFileIds);

    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

// ── Delete page ───────────────────────────────────────────────────────────────
router.delete("/:slug", requireAuth, requireTeam, wrap(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query(
      "SELECT id, content_json FROM pages WHERE slug = $1", [req.params.slug]
    );
    if (!existing.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }

    const fileIds = [...extractFileIds(existing[0].content_json)];
    if (fileIds.length) {
      await client.query(
        `UPDATE files SET deleted_at = NOW() WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [fileIds]
      );
    }

    await client.query("DELETE FROM pages WHERE slug = $1", [req.params.slug]);
    await client.query("COMMIT");
    res.json({ deleted: existing[0].id });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

// ── Error handler ─────────────────────────────────────────────────────────────
router.use((err, req, res, _next) => {
  console.error("[pages]", err.message);
  if (err.code === "23505") return res.status(409).json({ error: "A page with that slug already exists" });
  res.status(500).json({ error: "Internal server error" });
});

export default router;
