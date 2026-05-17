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

// TODO: replace with a proper group-selection UI once multi-group support is built
const RESILIENCE_GROUP_ID = "94a7ad3b-89bb-49c6-a97d-228f8758517a";

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

// Inserts a page_history row within an existing transaction client.
async function insertHistory(client, { pageId, action, version, contentJson, licenceId, userId, userName }) {
  await client.query(
    `INSERT INTO page_history (page_id, action, version, content_json, licence_id, user_id, user_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [pageId, action, version, contentJson || {}, licenceId || null, userId, userName]
  );
}

// ── List pages ────────────────────────────────────────────────────────────────
router.get("/", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.slug, p.title, p.created_by_name, p.created_at, p.updated_at,
            p.public, p.licence_id, p.version, p.owner_type, p.owner_id
     FROM pages p
     ORDER BY p.updated_at DESC`
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

// ── Get page history (must come before /:slug) ────────────────────────────────
router.get("/:slug/history", requireAuth, requireTeam, wrap(async (req, res) => {
  const { rows: pageRows } = await pool.query(
    "SELECT id FROM pages WHERE slug = $1", [req.params.slug]
  );
  if (!pageRows.length) return res.status(404).json({ error: "Not found" });

  const { rows } = await pool.query(
    `SELECT ph.id, ph.action, ph.version, ph.user_name, ph.created_at,
            l.name AS licence_name
     FROM page_history ph
     LEFT JOIN licences l ON l.id = ph.licence_id
     WHERE ph.page_id = $1
     ORDER BY ph.created_at DESC`,
    [pageRows[0].id]
  );
  res.json(rows);
}));

// ── Get specific page version (must come before /:slug) ───────────────────────
router.get("/:slug/version/:version", requireAuth, requireTeam, wrap(async (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) return res.status(400).json({ error: "Invalid version" });

  const { rows: pageRows } = await pool.query(
    "SELECT id, title FROM pages WHERE slug = $1", [req.params.slug]
  );
  if (!pageRows.length) return res.status(404).json({ error: "Not found" });

  const { rows } = await pool.query(
    `SELECT ph.version, ph.action, ph.content_json, ph.user_name, ph.created_at,
            l.name AS licence_name
     FROM page_history ph
     LEFT JOIN licences l ON l.id = ph.licence_id
     WHERE ph.page_id = $1 AND ph.version = $2`,
    [pageRows[0].id, version]
  );
  if (!rows.length) return res.status(404).json({ error: "Version not found" });
  res.json({ ...rows[0], title: pageRows[0].title });
}));

// ── Get page by slug ──────────────────────────────────────────────────────────
router.get("/:slug", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*, l.name AS licence_name, g.name AS group_name
     FROM pages p
     LEFT JOIN licences l ON l.id = p.licence_id
     LEFT JOIN groups g ON g.id = p.owner_id
     WHERE p.slug = $1`,
    [req.params.slug]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
}));

// ── Create page ───────────────────────────────────────────────────────────────
router.post("/", requireAuth, requireTeam, wrap(async (req, res) => {
  const { slug, title, content_json, licence_id, owner_type, owner_id } = req.body;
  if (!slug || !SLUG_RE.test(slug))
    return res.status(400).json({ error: "Invalid slug: use lowercase letters, numbers, and hyphens only (no leading or trailing hyphens)" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO pages (slug, title, content_json, created_by_id, created_by_name,
                          licence_id, public, version, owner_type, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, 1, $7, $8) RETURNING *`,
      [
        slug, title || "", content_json || {},
        req.user.id, req.user.name,
        licence_id || null,
        owner_type || "group",
        owner_id || RESILIENCE_GROUP_ID,
      ]
    );

    await insertHistory(client, {
      pageId: rows[0].id,
      action: "Created",
      version: 1,
      contentJson: content_json || {},
      licenceId: licence_id || null,
      userId: req.user.id,
      userName: req.user.name,
    });

    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

// ── Update page ───────────────────────────────────────────────────────────────
router.put("/:slug", requireAuth, requireTeam, wrap(async (req, res) => {
  const { title, content_json, new_slug, licence_id, public: isPublic, owner_type, owner_id } = req.body;
  const targetSlug = new_slug ?? req.params.slug;

  if (new_slug !== undefined && !SLUG_RE.test(new_slug))
    return res.status(400).json({ error: "Invalid slug" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query(
      "SELECT id, content_json, public, version FROM pages WHERE slug = $1", [req.params.slug]
    );
    if (!existing.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }

    const oldPublic = existing[0].public;
    const newPublic = isPublic !== undefined ? isPublic : oldPublic;
    const newVersion = existing[0].version + 1;

    let action = "Updated";
    if (!oldPublic && newPublic) action = "Published";
    else if (oldPublic && !newPublic) action = "Unpublished";

    const oldFileIds = extractFileIds(existing[0].content_json);
    const newFileIds = extractFileIds(content_json);

    const { rows } = await client.query(
      `UPDATE pages
       SET slug=$1, title=$2, content_json=$3, updated_at=NOW(),
           licence_id=$4, public=$5, version=$6,
           owner_type=COALESCE($7, owner_type), owner_id=$8
       WHERE slug=$9 RETURNING *`,
      [
        targetSlug, title || "", content_json || {},
        licence_id !== undefined ? (licence_id || null) : null,
        newPublic, newVersion,
        owner_type || null,
        owner_id !== undefined ? (owner_id || null) : null,
        req.params.slug,
      ]
    );

    await softDeleteRemovedFiles(client, oldFileIds, newFileIds);

    await insertHistory(client, {
      pageId: existing[0].id,
      action,
      version: newVersion,
      contentJson: content_json || {},
      licenceId: licence_id !== undefined ? (licence_id || null) : null,
      userId: req.user.id,
      userName: req.user.name,
    });

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
