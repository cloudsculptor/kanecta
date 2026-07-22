import { Router } from "express";
import multer from "multer";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadFile, deleteFile } from "../lib/spaces.js";
import { broadcastFcm } from "../lib/fcm.js";
import { notify } from "../lib/notification-templates.js";
import * as eventsRepo from "../repositories/events.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const requireModerator = requireRole("moderator", "admin");
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const PUBLIC_URL = process.env.SPACES_PUBLIC_URL;

// Attach file URLs to event rows
async function attachFiles(events) {
  if (!events.length) return events;
  const ids = events.map((e) => e.id);
  const rows = await eventsRepo.getEventFiles(pool, ids);
  const byEvent = new Map();
  for (const row of rows) {
    if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, { hero: null, gallery: [] });
    const entry = byEvent.get(row.event_id);
    const url = `${PUBLIC_URL}/${row.storage_key}`;
    if (row.role === "hero") {
      entry.hero = { file_id: row.file_id, url };
    } else {
      entry.gallery.push({ file_id: row.file_id, url, position: row.position });
    }
  }
  return events.map((e) => {
    const files = byEvent.get(e.id) ?? { hero: null, gallery: [] };
    return { ...e, hero_image: files.hero, gallery_images: files.gallery };
  });
}

// ── GET /api/events ────────────────────────────────────────────────────────────
// Public. Returns approved, non-deleted events whose end date is today or future.

router.get("/", wrap(async (req, res) => {
  const rows = await eventsRepo.listUpcomingApprovedEvents(pool);
  const events = await attachFiles(rows);
  res.json(events);
}));

// ── GET /api/events/mine ──────────────────────────────────────────────────────
// Auth. Returns all events submitted by the current user.

router.get("/mine", requireAuth, wrap(async (req, res) => {
  res.json(await eventsRepo.listMyEvents(pool, req.user.id));
}));

// ── DELETE /api/events/:id ─────────────────────────────────────────────────────
// Auth + owner (or moderator). Soft-deletes the event.

router.delete("/:id", requireAuth, wrap(async (req, res) => {
  const event = await eventsRepo.getEventForDelete(pool, req.params.id);
  if (!event || event.deleted_at) return res.status(404).json({ error: "Event not found" });

  const isModerator = req.user.roles.includes("moderator") || req.user.roles.includes("admin");
  if (event.submitted_by_id !== req.user.id && !isModerator) {
    return res.status(403).json({ error: "Not your event" });
  }

  await eventsRepo.softDeleteEvent(pool, req.params.id);
  res.json({ ok: true });
}));

// ── GET /api/events/pending ────────────────────────────────────────────────────
// Moderator only. Returns all pending events.

router.get("/pending", requireAuth, requireModerator, wrap(async (req, res) => {
  const rows = await eventsRepo.listPendingEvents(pool);
  const events = await attachFiles(rows);
  res.json(events);
}));

// ── GET /api/events/:id ───────────────────────────────────────────────────────
// Auth + owner or moderator. Returns full event data including files.

router.get("/:id", requireAuth, wrap(async (req, res) => {
  const detail = await eventsRepo.getEventDetail(pool, req.params.id);
  if (!detail) return res.status(404).json({ error: "Event not found" });
  const isModerator = req.user.roles.includes("moderator") || req.user.roles.includes("admin");
  if (detail.submitted_by_id !== req.user.id && !isModerator) {
    return res.status(403).json({ error: "Not your event" });
  }
  const [event] = await attachFiles([detail]);
  res.json(event);
}));

// ── POST /api/events ───────────────────────────────────────────────────────────
// Auth + email verified. Creates a pending event.

router.post("/", requireAuth, wrap(async (req, res) => {
  if (!req.user.email_verified) {
    return res.status(403).json({ error: "Email address not verified" });
  }
  const { title, description, start_date, start_time, end_date, end_time,
          address, lat, lng, website, phone, email,
          organiser_name, organiser_email, organiser_phone, area } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Title is required" });
  if (!start_date) return res.status(400).json({ error: "Start date is required" });
  const today = new Date().toISOString().slice(0, 10);
  if (start_date < today) return res.status(400).json({ error: "Start date cannot be in the past" });
  const desc = description?.trim() || "";
  if (desc.length < 50) return res.status(400).json({ error: "Description must be at least 50 characters" });
  if (desc.length > 1000) return res.status(400).json({ error: "Description must be 1000 characters or fewer" });
  const eventArea = area?.trim() || "Featherston";

  const row = await eventsRepo.createEvent(pool, {
    title: title.trim(), description: desc,
    startDate: start_date, startTime: start_time || null, endDate: end_date || null, endTime: end_time || null,
    address: address?.trim() || null,
    lat: lat != null ? parseFloat(lat) : null, lng: lng != null ? parseFloat(lng) : null,
    website: website?.trim() || null, phone: phone?.trim() || null, email: email?.trim() || null,
    organiserName: organiser_name?.trim() || null, organiserEmail: organiser_email?.trim() || null, organiserPhone: organiser_phone?.trim() || null,
    area: eventArea, submittedById: req.user.id, submittedByName: req.user.name,
  });
  ;(async () => {
    await broadcastFcm("events", req.user.id, notify.eventCreated({
      title: title.trim(),
      description: desc,
    }));
  })().catch(() => {});
  res.status(201).json({ id: row.id });
}));

// ── POST /api/events/:id/images ────────────────────────────────────────────────
// Auth + owner or moderator. Upload hero or gallery image.

router.post(
  "/:id/images",
  requireAuth,
  upload.single("image"),
  wrap(async (req, res) => {
    const { id } = req.params;
    const { role = "gallery", position = 0 } = req.body;

    if (!["hero", "gallery"].includes(role)) {
      return res.status(400).json({ error: "role must be hero or gallery" });
    }

    const event = await eventsRepo.getEventOwnerStatus(pool, id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const isModerator = req.user.roles.includes("moderator") || req.user.roles.includes("admin");
    if (event.submitted_by_id !== req.user.id && !isModerator) {
      return res.status(403).json({ error: "Not your event" });
    }

    if (!req.file) return res.status(400).json({ error: "No image provided" });
    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ error: "File must be an image" });
    }

    // Cap gallery at 3 images
    if (role === "gallery") {
      if (await eventsRepo.countGalleryImages(pool, id) >= 3) {
        return res.status(400).json({ error: "Maximum 3 gallery images allowed" });
      }
    }

    // This transaction spans Spaces (S3) uploads AND several event tables, so the
    // route owns the BEGIN/COMMIT and hands the client to each repo statement.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { file: fileRow, url } = await uploadFile({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
        uploadedById: req.user.id,
        uploadedByName: req.user.name,
        pool: client,
      });

      // Replace existing hero if uploading a new one
      if (role === "hero") {
        const oldHero = await eventsRepo.getHeroImage(client, id);
        if (oldHero) {
          await deleteFile({ storageKey: oldHero.storage_key, fileId: oldHero.file_id, pool: client });
          await eventsRepo.deleteHeroEventFile(client, id);
        }
      }

      await eventsRepo.insertEventFile(client, { eventId: id, fileId: fileRow.id, role, position: parseInt(position, 10) });
      if (event.status === "approved") {
        await eventsRepo.setEventPendingIfApproved(client, id);
      }
      await client.query("COMMIT");
      res.status(201).json({ file_id: fileRow.id, url });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

// ── DELETE /api/events/:id/images/:fileId ─────────────────────────────────────
// Auth + owner or moderator. Remove an image before approval.

router.delete("/:id/images/:fileId", requireAuth, wrap(async (req, res) => {
  const { id, fileId } = req.params;

  const event = await eventsRepo.getEventOwnerStatus(pool, id);
  if (!event) return res.status(404).json({ error: "Event not found" });

  const isModerator = req.user.roles.includes("moderator") || req.user.roles.includes("admin");
  if (event.submitted_by_id !== req.user.id && !isModerator) {
    return res.status(403).json({ error: "Not your event" });
  }

  const ef = await eventsRepo.getEventFile(pool, id, fileId);
  if (!ef) return res.status(404).json({ error: "Image not found" });

  await deleteFile({ storageKey: ef.storage_key, fileId: ef.file_id, pool });
  await eventsRepo.deleteEventFile(pool, id, fileId);
  if (event.status === "approved") {
    await eventsRepo.setEventPendingIfApproved(pool, id);
  }
  res.json({ ok: true });
}));

// ── PATCH /api/events/:id ─────────────────────────────────────────────────────
// Auth + owner or moderator. Updates event fields. Resets approved → pending.

router.patch("/:id", requireAuth, wrap(async (req, res) => {
  const existing = await eventsRepo.getEventOwnerStatus(pool, req.params.id);
  if (!existing) return res.status(404).json({ error: "Event not found" });
  const isModerator = req.user.roles.includes("moderator") || req.user.roles.includes("admin");
  if (existing.submitted_by_id !== req.user.id && !isModerator) {
    return res.status(403).json({ error: "Not your event" });
  }

  const { title, description, start_date, start_time, end_date, end_time,
          address, lat, lng, website, phone, email,
          organiser_name, organiser_email, organiser_phone, area } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Title is required" });
  if (!start_date) return res.status(400).json({ error: "Start date is required" });
  const eventArea = area?.trim() || "Featherston";

  const newStatus = existing.status === "approved" ? "pending" : existing.status;

  const row = await eventsRepo.updateEvent(pool, {
    id: req.params.id,
    title: title.trim(), description: description?.trim() || null,
    startDate: start_date, startTime: start_time || null, endDate: end_date || null, endTime: end_time || null,
    address: address?.trim() || null,
    lat: lat != null ? parseFloat(lat) : null, lng: lng != null ? parseFloat(lng) : null,
    website: website?.trim() || null, phone: phone?.trim() || null, email: email?.trim() || null,
    organiserName: organiser_name?.trim() || null, organiserEmail: organiser_email?.trim() || null, organiserPhone: organiser_phone?.trim() || null,
    area: eventArea, status: newStatus,
  });
  res.json({ ok: true, status: row.status });
}));

// ── PATCH /api/events/:id/approve ─────────────────────────────────────────────

router.patch("/:id/approve", requireAuth, requireModerator, wrap(async (req, res) => {
  const row = await eventsRepo.approveEvent(pool, { id: req.params.id, reviewedById: req.user.id, reviewedByName: req.user.name });
  if (!row) return res.status(404).json({ error: "Event not found or not pending" });
  res.json({ ok: true });
}));

// ── PATCH /api/events/:id/decline ─────────────────────────────────────────────

router.patch("/:id/decline", requireAuth, requireModerator, wrap(async (req, res) => {
  const { decline_reason } = req.body;
  const row = await eventsRepo.declineEvent(pool, {
    id: req.params.id, declineReason: decline_reason?.trim() || null,
    reviewedById: req.user.id, reviewedByName: req.user.name,
  });
  if (!row) return res.status(404).json({ error: "Event not found or not pending" });
  res.json({ ok: true });
}));

// ── Error handler ─────────────────────────────────────────────────────────────

router.use((err, req, res, _next) => {
  console.error("[events]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

export default router;
