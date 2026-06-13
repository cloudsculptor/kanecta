import admin from "firebase-admin";
import pool from "../db.js";

let messaging = null;

if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FCM_DISABLED !== "true") {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    messaging = app.messaging();
  } catch (err) {
    console.error("FCM init failed:", err.message);
  }
}

export async function sendFcmToUser(userId, { title, body, url }) {
  if (!messaging) return;
  let rows;
  try {
    ({ rows } = await pool.query(
      "SELECT id, token FROM fcm_tokens WHERE user_id = $1",
      [userId]
    ));
  } catch {
    return;
  }
  await Promise.all(
    rows.map(async (row) => {
      try {
        await messaging.send({
          token: row.token,
          notification: { title, body },
          webpush: url ? { fcmOptions: { link: url } } : undefined,
          android: { priority: "high" },
        });
      } catch (err) {
        if (
          err.code === "messaging/registration-token-not-registered" ||
          err.code === "messaging/invalid-registration-token"
        ) {
          await pool.query("DELETE FROM fcm_tokens WHERE id = $1", [row.id]);
        }
      }
    })
  );
}

// Send FCM to all subscribers of a thread (excluding the author)
export async function notifyThreadSubscribersFcm(threadId, authorUserId, payload) {
  if (!messaging) return;
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT DISTINCT ft.id, ft.token
       FROM thread_notification_subscriptions tns
       JOIN fcm_tokens ft ON ft.user_id = tns.user_id
       WHERE tns.thread_id = $1 AND tns.user_id != $2`,
      [threadId, authorUserId]
    ));
  } catch {
    return;
  }
  await Promise.all(
    rows.map(async (row) => {
      try {
        await messaging.send({
          token: row.token,
          notification: { title: payload.title, body: payload.body },
          webpush: payload.url ? { fcmOptions: { link: payload.url } } : undefined,
          android: { priority: "high" },
        });
      } catch (err) {
        if (
          err.code === "messaging/registration-token-not-registered" ||
          err.code === "messaging/invalid-registration-token"
        ) {
          await pool.query("DELETE FROM fcm_tokens WHERE id = $1", [row.id]);
        }
      }
    })
  );
}

// Send to all users who have a given notification category enabled (excluding author)
export async function broadcastFcm(category, excludeUserId, payload) {
  if (!messaging) return;
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT ft.id, ft.token
       FROM fcm_tokens ft
       LEFT JOIN notification_preferences np
         ON np.user_id = ft.user_id AND np.category = $1
       WHERE ft.user_id != $2
         AND (np.enabled IS NULL OR np.enabled = true)`,
      [category, excludeUserId]
    ));
  } catch {
    return;
  }
  await Promise.all(
    rows.map(async (row) => {
      try {
        await messaging.send({
          token: row.token,
          notification: { title: payload.title, body: payload.body },
          webpush: payload.url ? { fcmOptions: { link: payload.url } } : undefined,
          android: { priority: "high" },
        });
      } catch (err) {
        if (
          err.code === "messaging/registration-token-not-registered" ||
          err.code === "messaging/invalid-registration-token"
        ) {
          await pool.query("DELETE FROM fcm_tokens WHERE id = $1", [row.id]);
        }
      }
    })
  );
}
