// Data access for the `pages` domain. Reads are plain methods on the shared
// pool; the two multi-statement writes (create + update, each with a
// page_history row and — for update — file cleanup) are PURE-DB transactions, so
// the repository owns their BEGIN/COMMIT (unlike events, whose image transaction
// interleaves S3 and stays in the route). These are the `createPageWithHistory` /
// `updatePageWithHistory` methods the swap plan calls for.
// Part of the repository seam — see repositories/licences.js.
import pool from "../db.js";
import { USE_KANECTA } from "./backend.js";
import * as kanecta from "./kanecta/pages.js";

const PUBLIC_URL = process.env.SPACES_PUBLIC_URL;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Soft-deletes files that were in oldIds but not in newIds, on the given client.
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

export async function listPages() {
  if (USE_KANECTA) return kanecta.listPages();
  const { rows } = await pool.query(
    `SELECT p.id, p.slug, p.title, p.created_by_name, p.created_at, p.updated_at,
            p.public, p.licence_id, p.version, p.owner_type, p.owner_id
     FROM pages p
     WHERE p.deleted_at IS NULL
     ORDER BY p.updated_at DESC`
  );
  return rows;
}

export async function listPublicPages() {
  if (USE_KANECTA) return kanecta.listPublicPages();
  const { rows } = await pool.query(
    `SELECT p.id, p.slug, p.title, p.created_by_name, p.created_at, p.updated_at,
            p.public, p.licence_id, p.version, p.owner_type, p.owner_id
     FROM pages p
     WHERE p.public = TRUE AND p.deleted_at IS NULL
     ORDER BY p.updated_at DESC`
  );
  return rows;
}

export async function getPublicPageBySlug(slug) {
  if (USE_KANECTA) return kanecta.getPublicPageBySlug(slug);
  const { rows } = await pool.query(
    `SELECT p.*, l.name AS licence_name, g.name AS group_name
     FROM pages p
     LEFT JOIN licences l ON l.id = p.licence_id
     LEFT JOIN groups g ON g.id = p.owner_id
     WHERE p.slug = $1 AND p.public = TRUE AND p.deleted_at IS NULL`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function getPageBySlug(slug) {
  if (USE_KANECTA) return kanecta.getPageBySlug(slug);
  const { rows } = await pool.query(
    `SELECT p.*, l.name AS licence_name, g.name AS group_name
     FROM pages p
     LEFT JOIN licences l ON l.id = p.licence_id
     LEFT JOIN groups g ON g.id = p.owner_id
     WHERE p.slug = $1 AND p.deleted_at IS NULL`,
    [slug]
  );
  return rows[0] ?? null;
}

// { id } for any page with this slug (history lookup), or null.
export async function getPageIdBySlug(slug) {
  if (USE_KANECTA) return kanecta.getPageIdBySlug(slug);
  const { rows } = await pool.query("SELECT id FROM pages WHERE slug = $1", [slug]);
  return rows[0] ?? null;
}

// { id, title } for any page with this slug (version lookup), or null.
export async function getPageIdTitleBySlug(slug) {
  if (USE_KANECTA) return kanecta.getPageIdTitleBySlug(slug);
  const { rows } = await pool.query("SELECT id, title FROM pages WHERE slug = $1", [slug]);
  return rows[0] ?? null;
}

// { id } for a LIVE (non-deleted) page with this slug (delete lookup), or null.
export async function getLivePageIdBySlug(slug) {
  if (USE_KANECTA) return kanecta.getLivePageIdBySlug(slug);
  const { rows } = await pool.query(
    "SELECT id FROM pages WHERE slug = $1 AND deleted_at IS NULL", [slug]
  );
  return rows[0] ?? null;
}

export async function getPageHistory(pageId) {
  const { rows } = await pool.query(
    `SELECT ph.id, ph.action, ph.version, ph.user_name, ph.created_at,
            l.name AS licence_name
     FROM page_history ph
     LEFT JOIN licences l ON l.id = ph.licence_id
     WHERE ph.page_id = $1
     ORDER BY ph.created_at DESC`,
    [pageId]
  );
  return rows;
}

export async function getPageVersion(pageId, version) {
  const { rows } = await pool.query(
    `SELECT ph.version, ph.action, ph.content_json, ph.user_name, ph.created_at,
            l.name AS licence_name
     FROM page_history ph
     LEFT JOIN licences l ON l.id = ph.licence_id
     WHERE ph.page_id = $1 AND ph.version = $2`,
    [pageId, version]
  );
  return rows[0] ?? null;
}

export async function softDeletePage(slug) {
  await pool.query("UPDATE pages SET deleted_at = NOW() WHERE slug = $1", [slug]);
}

// Create a page and its initial "Created" history row atomically. Returns the
// created page row.
export async function createPageWithHistory({
  slug, title, contentJson, createdById, createdByName, licenceId, ownerType, ownerId,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO pages (slug, title, content_json, created_by_id, created_by_name,
                          licence_id, public, version, owner_type, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, 1, $7, $8) RETURNING *`,
      [slug, title || "", contentJson || {}, createdById, createdByName, licenceId || null, ownerType || "group", ownerId]
    );

    await insertHistory(client, {
      pageId: rows[0].id, action: "Created", version: 1,
      contentJson: contentJson || {}, licenceId: licenceId || null,
      userId: createdById, userName: createdByName,
    });

    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Update a page, soft-delete any removed image files, and append a history row —
// all atomically. Returns { row, action }, or null if no page has `currentSlug`.
// `action` (Updated | Published | Unpublished) is derived from the public flag
// transition so the caller can drive a post-commit notification.
export async function updatePageWithHistory({
  currentSlug, targetSlug, title, contentJson, licenceId, isPublic, ownerType, ownerId, userId, userName,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query(
      "SELECT id, content_json, public, version FROM pages WHERE slug = $1", [currentSlug]
    );
    if (!existing.length) {
      await client.query("ROLLBACK");
      return null;
    }

    const oldPublic = existing[0].public;
    const newPublic = isPublic !== undefined ? isPublic : oldPublic;
    const newVersion = existing[0].version + 1;

    let action = "Updated";
    if (!oldPublic && newPublic) action = "Published";
    else if (oldPublic && !newPublic) action = "Unpublished";

    const oldFileIds = extractFileIds(existing[0].content_json);
    const newFileIds = extractFileIds(contentJson);

    const { rows } = await client.query(
      `UPDATE pages
       SET slug=$1, title=$2, content_json=$3, updated_at=NOW(),
           licence_id=$4, public=$5, version=$6,
           owner_type=COALESCE($7, owner_type), owner_id=$8
       WHERE slug=$9 RETURNING *`,
      [
        targetSlug, title || "", contentJson || {},
        licenceId !== undefined ? (licenceId || null) : null,
        newPublic, newVersion,
        ownerType || null,
        ownerId !== undefined ? (ownerId || null) : null,
        currentSlug,
      ]
    );

    await softDeleteRemovedFiles(client, oldFileIds, newFileIds);

    await insertHistory(client, {
      pageId: existing[0].id, action, version: newVersion,
      contentJson: contentJson || {},
      licenceId: licenceId !== undefined ? (licenceId || null) : null,
      userId, userName,
    });

    await client.query("COMMIT");
    return { row: rows[0], action };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
