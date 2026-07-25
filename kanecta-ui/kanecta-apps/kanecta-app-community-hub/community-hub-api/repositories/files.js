// Data access for the public file-serving route (routes/files.js).
// Part of the repository seam — see repositories/licences.js.
import pool from "../db.js";
import { USE_KANECTA } from "./backend.js";
import * as kanecta from "./kanecta/files.js";

// Record for a single file by id. Deliberately NO deleted_at filter: page-history
// versions reference images later removed from the page (soft-deleted records),
// and the old public Spaces URLs kept serving those bytes — the proxy preserves
// that behaviour.
export async function getFileById(id) {
  if (USE_KANECTA) return kanecta.getFileById(id);
  const { rows } = await pool.query(
    `SELECT name, storage_key, mime_type, size_bytes FROM files WHERE id = $1`,
    [id]
  );
  return rows[0];
}
