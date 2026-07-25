// Data access for the site-export ("download") feature. Only the two reads it
// needs live here — the Lexical→Markdown serialisation, zip building, and Spaces
// streaming are transport/formatting logic that stays in the route.
// Part of the repository seam — see repositories/licences.js.
import pool from "../db.js";
import { USE_KANECTA } from "./backend.js";
import * as kanecta from "./kanecta/download.js";

// Public, non-deleted pages with the fields the export needs (its own projection,
// distinct from the pages route's reads).
export async function listPublicPagesForExport() {
  if (USE_KANECTA) return kanecta.listPublicPagesForExport();
  const { rows } = await pool.query(
    `SELECT slug, title, content_json FROM pages
     WHERE public = TRUE AND deleted_at IS NULL
     ORDER BY title`
  );
  return rows;
}

// Original filename + storage key for the given file ids (skips deleted files).
export async function getFilesByIds(ids) {
  if (USE_KANECTA) return kanecta.getFilesByIds(ids);
  const { rows } = await pool.query(
    `SELECT id, name, storage_key FROM files
     WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [ids]
  );
  return rows;
}
