import { Router } from "express";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { adminFetch } from "../lib/keycloakAdmin.js";

const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const ANONYMISED_NAME = "Former member";

// GET /api/account/deletion-preview
// What happens if the current user deletes their account: their own
// upcoming events get removed (nobody could follow up with an organiser
// who no longer has an account), so the UI can warn about those specifically
// before the user confirms.
router.get("/deletion-preview", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, start_date FROM events
     WHERE submitted_by_id = $1 AND deleted_at IS NULL AND start_date >= CURRENT_DATE
     ORDER BY start_date ASC`,
    [req.user.id]
  );
  res.json({ upcomingEvents: rows });
}));

// DELETE /api/account/me
// Deletes the current user's Keycloak account. Past contributions
// (discussion messages, notices, suggestions, pages, uploaded files) are
// kept but re-labelled "Former member" so other members' threads and
// records stay intact. Their own upcoming events are soft-deleted instead.
router.delete("/me", requireAuth, wrap(async (req, res) => {
  const userId = req.user.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE events SET deleted_at = NOW()
       WHERE submitted_by_id = $1 AND deleted_at IS NULL AND start_date >= CURRENT_DATE`,
      [userId]
    );

    await client.query(`UPDATE discussions_messages SET user_name = $2 WHERE user_id = $1`, [userId, ANONYMISED_NAME]);
    await client.query(`UPDATE discussions_threads SET created_by_name = $2 WHERE created_by_user_id = $1`, [userId, ANONYMISED_NAME]);
    await client.query(`UPDATE discussions_reactions SET user_name = $2 WHERE user_id = $1`, [userId, ANONYMISED_NAME]);
    await client.query(`UPDATE notices SET submitted_by_name = $2 WHERE submitted_by_id = $1`, [userId, ANONYMISED_NAME]);
    await client.query(`UPDATE notices SET reviewed_by_name = $2 WHERE reviewed_by_id = $1`, [userId, ANONYMISED_NAME]);
    await client.query(`UPDATE events SET submitted_by_name = $2 WHERE submitted_by_id = $1`, [userId, ANONYMISED_NAME]);
    await client.query(`UPDATE events SET reviewed_by_name = $2 WHERE reviewed_by_id = $1`, [userId, ANONYMISED_NAME]);
    await client.query(`UPDATE suggestions SET submitted_by_name = $2 WHERE submitted_by_id = $1`, [userId, ANONYMISED_NAME]);
    await client.query(`UPDATE pages SET created_by_name = $2 WHERE created_by_id = $1`, [userId, ANONYMISED_NAME]);
    await client.query(`UPDATE files SET uploaded_by_name = $2 WHERE uploaded_by_id = $1`, [userId, ANONYMISED_NAME]);

    await client.query(`DELETE FROM discussions_thread_reads WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM thread_notification_subscriptions WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM fcm_tokens WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM notification_preferences WHERE user_id = $1`, [userId]);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await adminFetch(`/users/${userId}`, { method: "DELETE" });

  res.json({ ok: true });
}));

export default router;
