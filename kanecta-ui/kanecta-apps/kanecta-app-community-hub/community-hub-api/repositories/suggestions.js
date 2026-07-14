// Data access for the `suggestions` domain. Intent-named methods own the SQL;
// non-DB concerns (FCM broadcast, Keycloak name resolution) stay in the route.
// Part of the repository seam — see repositories/licences.js.
import pool from "../db.js";
import { USE_KANECTA } from "./backend.js";
import * as kanecta from "./kanecta/suggestions.js";

export async function createSuggestion({ content, submittedById, submittedByName }) {
  const { rows } = await pool.query(
    `INSERT INTO suggestions (content, submitted_by_id, submitted_by_name)
     VALUES ($1, $2, $3) RETURNING id`,
    [content, submittedById, submittedByName]
  );
  return rows[0];
}

export async function listActiveSuggestions() {
  if (USE_KANECTA) return kanecta.listActiveSuggestions();
  const { rows } = await pool.query(
    `SELECT id, content, submitted_by_name, submitted_at
     FROM suggestions
     WHERE archived_at IS NULL
     ORDER BY submitted_at DESC`
  );
  return rows;
}

export async function listArchivedSuggestions() {
  if (USE_KANECTA) return kanecta.listArchivedSuggestions();
  const { rows } = await pool.query(
    `SELECT id, content, submitted_by_name, submitted_at, archived_at, archived_by_id
     FROM suggestions
     WHERE archived_at IS NOT NULL
     ORDER BY archived_at DESC`
  );
  return rows;
}

// Returns the number of rows archived (0 if not found or already archived).
export async function archiveSuggestion({ id, archivedById }) {
  const { rowCount } = await pool.query(
    `UPDATE suggestions SET archived_at = NOW(), archived_by_id = $1
     WHERE id = $2 AND archived_at IS NULL`,
    [archivedById, id]
  );
  return rowCount;
}
