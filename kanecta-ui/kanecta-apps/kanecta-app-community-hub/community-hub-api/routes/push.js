import { Router } from "express";
import webpush from "web-push";
import { requireAuth } from "../middleware/auth.js";
import pool from "../db.js";

const router = Router();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_SUBJECT || "admin@featherston.co.nz"}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ── Device token management ───────────────────────────────────────────────────

router.post("/device", requireAuth, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: "Invalid subscription" });
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, subscription)
       VALUES ($1, $2)
       ON CONFLICT (user_id, (subscription->>'endpoint'))
       DO UPDATE SET subscription = EXCLUDED.subscription`,
      [req.user.id, JSON.stringify(subscription)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save push subscription" });
  }
});

router.delete("/device", requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });
  try {
    await pool.query(
      `DELETE FROM push_subscriptions WHERE user_id = $1 AND subscription->>'endpoint' = $2`,
      [req.user.id, endpoint]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove push subscription" });
  }
});

// ── Send a push notification to a single user ─────────────────────────────────

export async function sendPushToUser(userId, payload) {
  let rows;
  try {
    ({ rows } = await pool.query(
      "SELECT id, subscription FROM push_subscriptions WHERE user_id = $1",
      [userId]
    ));
  } catch {
    return;
  }
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [row.id]);
        }
      }
    })
  );
}

// ── Send a push notification to all subscribers of a thread ──────────────────

export async function notifyThreadSubscribers(threadId, authorUserId, payload) {
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT DISTINCT ps.user_id, ps.id, ps.subscription
       FROM thread_notification_subscriptions tns
       JOIN push_subscriptions ps ON ps.user_id = tns.user_id
       WHERE tns.thread_id = $1 AND tns.user_id != $2`,
      [threadId, authorUserId]
    ));
  } catch {
    return;
  }
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [row.id]);
        }
      }
    })
  );
}

// ── FCM token management (Android native push) ────────────────────────────────

router.post("/fcm-token", requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token required" });
  try {
    await pool.query(
      `INSERT INTO fcm_tokens (user_id, token)
       VALUES ($1, $2)
       ON CONFLICT (user_id, token) DO NOTHING`,
      [req.user.id, token]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to save FCM token" });
  }
});

router.delete("/fcm-token", requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token required" });
  try {
    await pool.query(
      "DELETE FROM fcm_tokens WHERE user_id = $1 AND token = $2",
      [req.user.id, token]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to remove FCM token" });
  }
});

// ── Notification preferences ──────────────────────────────────────────────────

router.get("/preferences", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT category, enabled FROM notification_preferences WHERE user_id = $1",
      [req.user.id]
    );
    const defaults = { events: true, discussions: true, suggestions: true, pages: true };
    for (const row of rows) defaults[row.category] = row.enabled;
    res.json(defaults);
  } catch {
    res.status(500).json({ error: "Failed to load preferences" });
  }
});

router.put("/preferences", requireAuth, async (req, res) => {
  const categories = ["events", "discussions", "suggestions", "pages"];
  const updates = categories.filter((c) => typeof req.body[c] === "boolean");
  if (!updates.length) return res.status(400).json({ error: "No valid preferences" });
  try {
    await Promise.all(
      updates.map((category) =>
        pool.query(
          `INSERT INTO notification_preferences (user_id, category, enabled)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, category) DO UPDATE SET enabled = EXCLUDED.enabled`,
          [req.user.id, category, req.body[category]]
        )
      )
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to save preferences" });
  }
});

export default router;
