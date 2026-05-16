import { Router } from "express";
import multer from "multer";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadFile } from "../lib/spaces.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const PUBLIC_URL = process.env.SPACES_PUBLIC_URL;

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
      const parts = node.src.slice(prefix.length).split("/");
      const hex = parts[2];
      if (hex && hex.length === 32) {
        ids.add(`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`);
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }

  walk(contentJson.root);
  return ids;
}

// Syncs page_files and soft-deletes files removed from a page.
async function syncPageFiles(client, pageId, oldFileIds, newFileIds) {
  const added   = [...newFileIds].filter(id => !oldFileIds.has(id));
  const removed = [...oldFileIds].filter(id => !newFileIds.has(id));

  if (added.length) {
    await Promise.all(added.map(fileId =>
      client.query(
        `INSERT INTO page_files (page_id, file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [pageId, fileId]
      )
    ));
  }

  if (removed.length) {
    await client.query(
      `DELETE FROM page_files WHERE page_id = $1 AND file_id = ANY($2::uuid[])`,
      [pageId, removed]
    );
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO pages (slug, title, content_json, created_by_id, created_by_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [slug, title || "", content_json || {}, req.user.id, req.user.name]
    );
    const page = rows[0];
    const newFileIds = extractFileIds(content_json);
    await syncPageFiles(client, page.id, new Set(), newFileIds);
    await client.query("COMMIT");
    res.status(201).json(page);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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

    // Fetch current page and its file references
    const { rows: existing } = await client.query(
      "SELECT id FROM pages WHERE slug = $1", [req.params.slug]
    );
    if (!existing.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }
    const pageId = existing[0].id;

    const { rows: oldFileRows } = await client.query(
      "SELECT file_id FROM page_files WHERE page_id = $1", [pageId]
    );
    const oldFileIds = new Set(oldFileRows.map(r => r.file_id));

    // Update the page
    const { rows } = await client.query(
      `UPDATE pages SET slug=$1, title=$2, content_json=$3, updated_at=NOW()
       WHERE slug=$4 RETURNING *`,
      [targetSlug, title || "", content_json || {}, req.params.slug]
    );

    // Sync file references
    const newFileIds = extractFileIds(content_json);
    await syncPageFiles(client, pageId, oldFileIds, newFileIds);

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
      "SELECT id FROM pages WHERE slug = $1", [req.params.slug]
    );
    if (!existing.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }
    const pageId = existing[0].id;

    // Soft-delete all files attached to this page
    const { rows: fileRows } = await client.query(
      "SELECT file_id FROM page_files WHERE page_id = $1", [pageId]
    );
    if (fileRows.length) {
      const fileIds = fileRows.map(r => r.file_id);
      await client.query(
        `UPDATE files SET deleted_at = NOW() WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [fileIds]
      );
    }

    await client.query("DELETE FROM pages WHERE slug = $1", [req.params.slug]);
    await client.query("COMMIT");
    res.json({ deleted: pageId });
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
