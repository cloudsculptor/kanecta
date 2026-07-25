// Data access for push/FCM subscriptions and notification preferences. The
// web-push / FCM *transport* stays in routes/push.js (and its exported helpers
// used by other routes); only the SQL lives here. Part of the repository seam —
// see repositories/licences.js.
import pool from "../db.js";
import { USE_KANECTA } from "./backend.js";
import * as kanecta from "./kanecta/push.js";

export async function upsertPushSubscription(userId, subscription) {
  if (USE_KANECTA) return kanecta.upsertPushSubscription(userId, subscription);
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, subscription)
     VALUES ($1, $2)
     ON CONFLICT (user_id, (subscription->>'endpoint'))
     DO UPDATE SET subscription = EXCLUDED.subscription`,
    [userId, JSON.stringify(subscription)]
  );
}

export async function deletePushSubscription(userId, endpoint) {
  if (USE_KANECTA) return kanecta.deletePushSubscription(userId, endpoint);
  await pool.query(
    `DELETE FROM push_subscriptions WHERE user_id = $1 AND subscription->>'endpoint' = $2`,
    [userId, endpoint]
  );
}

export async function getUserSubscriptions(userId) {
  if (USE_KANECTA) return kanecta.getUserSubscriptions(userId);
  const { rows } = await pool.query(
    "SELECT id, subscription FROM push_subscriptions WHERE user_id = $1",
    [userId]
  );
  return rows;
}

export async function getThreadSubscribers(threadId, authorUserId) {
  if (USE_KANECTA) return kanecta.getThreadSubscribers(threadId, authorUserId);
  const { rows } = await pool.query(
    `SELECT DISTINCT ps.user_id, ps.id, ps.subscription
     FROM thread_notification_subscriptions tns
     JOIN push_subscriptions ps ON ps.user_id = tns.user_id
     WHERE tns.thread_id = $1 AND tns.user_id != $2`,
    [threadId, authorUserId]
  );
  return rows;
}

export async function deleteSubscriptionById(id) {
  if (USE_KANECTA) return kanecta.deleteSubscriptionById(id);
  await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [id]);
}

export async function upsertFcmToken(userId, token) {
  if (USE_KANECTA) return kanecta.upsertFcmToken(userId, token);
  await pool.query(
    `INSERT INTO fcm_tokens (user_id, token)
     VALUES ($1, $2)
     ON CONFLICT (user_id, token) DO NOTHING`,
    [userId, token]
  );
}

export async function deleteFcmToken(userId, token) {
  if (USE_KANECTA) return kanecta.deleteFcmToken(userId, token);
  await pool.query(
    "DELETE FROM fcm_tokens WHERE user_id = $1 AND token = $2",
    [userId, token]
  );
}

export async function getPreferences(userId) {
  if (USE_KANECTA) return kanecta.getPreferences(userId);
  const { rows } = await pool.query(
    "SELECT category, enabled FROM notification_preferences WHERE user_id = $1",
    [userId]
  );
  return rows;
}

export async function upsertPreference(userId, category, enabled) {
  if (USE_KANECTA) return kanecta.upsertPreference(userId, category, enabled);
  await pool.query(
    `INSERT INTO notification_preferences (user_id, category, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, category) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [userId, category, enabled]
  );
}
