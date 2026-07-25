// Data access for the `trust` table. All trust-record reads and writes live here
// regardless of which route triggers them (the members route creates an
// endorsement when granting the team role; the trust route walks the chain), so
// the Kanecta mapping later has a single place that owns trust items.
// Part of the repository seam — see repositories/licences.js.
import pool from "../db.js";
import { USE_KANECTA } from "./backend.js";
import * as kanecta from "./kanecta/trust.js";

// The most recent trust record naming who endorsed `userId` and why (null at the
// root of the chain, who has no endorsement).
export async function getEndorsementFor(userId) {
  if (USE_KANECTA) return kanecta.getEndorsementFor(userId);
  const { rows } = await pool.query(
    `SELECT endorsed_by_id, know_personally, trusted_by_someone, resilience_hui, other_reason
     FROM trust WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

// True if `userId` was themselves endorsed (i.e. not the chain root).
export async function isEndorsed(userId) {
  if (USE_KANECTA) return kanecta.isEndorsed(userId);
  const { rows } = await pool.query(
    `SELECT id FROM trust WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

// Record an endorsement when a user is granted the team role.
export async function createEndorsement({
  userId, endorsedById, knowPersonally, trustedBySomeone, resilienceHui, otherReason, locality,
}) {
  if (USE_KANECTA) return kanecta.createEndorsement({ userId, endorsedById, knowPersonally, trustedBySomeone, resilienceHui, otherReason, locality });
  await pool.query(
    `INSERT INTO trust (user_id, endorsed_by_id, know_personally, trusted_by_someone, resilience_hui, other_reason, locality)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, endorsedById, knowPersonally, trustedBySomeone, resilienceHui, otherReason, locality]
  );
}
