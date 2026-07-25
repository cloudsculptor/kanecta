import { Router } from "express";
import webpush from "web-push";
import { requireAuth } from "../middleware/auth.js";
import {
  upsertPushSubscription,
  deletePushSubscription,
  getUserSubscriptions,
  getThreadSubscribers,
  deleteSubscriptionById,
  upsertFcmToken,
  deleteFcmToken,
  getPreferences,
  upsertPreference,
} from "../repositories/push.js";

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
    await upsertPushSubscription(req.user.id, subscription);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save push subscription" });
  }
});

router.delete("/device", requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });
  try {
    await deletePushSubscription(req.user.id, endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove push subscription" });
  }
});

// ── Send a push notification to a single user ─────────────────────────────────

export async function sendPushToUser(userId, payload) {
  let rows;
  try {
    rows = await getUserSubscriptions(userId);
  } catch {
    return;
  }
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await deleteSubscriptionById(row.id);
        }
      }
    })
  );
}

// ── Send a push notification to all subscribers of a thread ──────────────────

export async function notifyThreadSubscribers(threadId, authorUserId, payload) {
  let rows;
  try {
    rows = await getThreadSubscribers(threadId, authorUserId);
  } catch {
    return;
  }
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await deleteSubscriptionById(row.id);
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
    await upsertFcmToken(req.user.id, token);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to save FCM token" });
  }
});

router.delete("/fcm-token", requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token required" });
  try {
    await deleteFcmToken(req.user.id, token);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to remove FCM token" });
  }
});

// ── Notification preferences ──────────────────────────────────────────────────

router.get("/preferences", requireAuth, async (req, res) => {
  try {
    const rows = await getPreferences(req.user.id);
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
      updates.map((category) => upsertPreference(req.user.id, category, req.body[category]))
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to save preferences" });
  }
});

export default router;
