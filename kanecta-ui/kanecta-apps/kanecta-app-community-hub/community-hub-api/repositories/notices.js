// Data access for the `notices` domain. Intent-named methods own the SQL;
// heading/body validation and email-verified checks stay in the route.
// Part of the repository seam — see repositories/licences.js.
import pool from "../db.js";
import { USE_KANECTA } from "./backend.js";
import * as kanecta from "./kanecta/notices.js";

export async function listApprovedNotices() {
  if (USE_KANECTA) return kanecta.listApprovedNotices();
  const { rows } = await pool.query(
    `SELECT id, heading, body, notice_date, submitted_by_name, submitted_at
     FROM notices
     WHERE status = 'approved' AND deleted_at IS NULL
     ORDER BY submitted_at DESC`
  );
  return rows;
}

export async function listMyNotices(userId) {
  if (USE_KANECTA) return kanecta.listMyNotices(userId);
  const { rows } = await pool.query(
    `SELECT id, heading, notice_date, status, decline_reason, submitted_at
     FROM notices
     WHERE submitted_by_id = $1 AND deleted_at IS NULL
     ORDER BY submitted_at DESC`,
    [userId]
  );
  return rows;
}

export async function listPendingNotices() {
  if (USE_KANECTA) return kanecta.listPendingNotices();
  const { rows } = await pool.query(
    `SELECT id, heading, body, notice_date, submitted_by_name, submitted_at
     FROM notices
     WHERE status = 'pending' AND deleted_at IS NULL
     ORDER BY submitted_at ASC`
  );
  return rows;
}

export async function createNotice({ heading, body, noticeDate, submittedById, submittedByName }) {
  const { rows } = await pool.query(
    `INSERT INTO notices (heading, body, notice_date, submitted_by_id, submitted_by_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [heading, body, noticeDate, submittedById, submittedByName]
  );
  return rows[0];
}

// The owner id of a live (non-deleted) notice, or null if it doesn't exist.
export async function getNoticeOwner(id) {
  const { rows } = await pool.query(
    "SELECT submitted_by_id FROM notices WHERE id = $1 AND deleted_at IS NULL",
    [id]
  );
  return rows[0]?.submitted_by_id ?? null;
}

export async function softDeleteNotice(id) {
  await pool.query("UPDATE notices SET deleted_at = NOW() WHERE id = $1", [id]);
}

// Approve a pending notice; returns the id row, or undefined if not found/not pending.
export async function approveNotice({ id, reviewedById, reviewedByName }) {
  const { rows } = await pool.query(
    `UPDATE notices
     SET status = 'approved', reviewed_by_id = $1, reviewed_by_name = $2, reviewed_at = NOW()
     WHERE id = $3 AND status = 'pending' AND deleted_at IS NULL
     RETURNING id`,
    [reviewedById, reviewedByName, id]
  );
  return rows[0];
}

// Decline a pending notice; returns the id row, or undefined if not found/not pending.
export async function declineNotice({ id, declineReason, reviewedById, reviewedByName }) {
  const { rows } = await pool.query(
    `UPDATE notices
     SET status = 'declined', decline_reason = $1,
         reviewed_by_id = $2, reviewed_by_name = $3, reviewed_at = NOW()
     WHERE id = $4 AND status = 'pending' AND deleted_at IS NULL
     RETURNING id`,
    [declineReason, reviewedById, reviewedByName, id]
  );
  return rows[0];
}
