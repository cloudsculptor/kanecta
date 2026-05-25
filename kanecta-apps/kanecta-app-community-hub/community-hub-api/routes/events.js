import { Router } from "express";
import multer from "multer";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadFile, deleteFile } from "../lib/spaces.js";
import { broadcastFcm } from "../lib/fcm.js";
import { notify } from "../lib/notification-templates.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const requireModerator = requireRole("moderator", "admin");
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const PUBLIC_URL = process.env.SPACES_PUBLIC_URL;

// Attach file URLs to event rows
async function attachFiles(events) {
  if (!events.length) return events;
  const ids = events.map((e) => e.id);
  const { rows } = await pool.query(
    `SELECT ef.event_id, ef.role, ef.position, f.id AS file_id, f.storage_key
     FROM event_files ef
     JOIN files f ON f.id = ef.file_id
     WHERE ef.event_id = ANY($1::uuid[]) AND f.deleted_at IS NULL
     ORDER BY ef.event_id, ef.role DESC, ef.position`,
    [ids]
  );
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
// Public. Returns approved events not yet soft-deleted (end_date + 30 days).

router.get("/", wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, description, start_date, start_time, end_date, end_time,
            address, lat, lng, website, phone, email, area, submitted_at
     FROM events
     WHERE status = 'approved'
       AND COALESCE(end_date, start_date) + INTERVAL '30 days' > CURRENT_DATE
     ORDER BY start_date ASC`
  );
  const events = await attachFiles(rows);
  res.json(events);
}));

// ── GET /api/events/mine ──────────────────────────────────────────────────────
// Auth. Returns all events submitted by the current user.

router.get("/mine", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, start_date, start_time, end_date, status, decline_reason, submitted_at
     FROM events
     WHERE submitted_by_id = $1
     ORDER BY submitted_at DESC`,
    [req.user.id]
  );
  res.json(rows);
}));

// ── DELETE /api/events/:id ─────────────────────────────────────────────────────
// Auth + owner (or moderator). Deletes the event and its files.

router.delete("/:id", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT submitted_by_id FROM events WHERE id = $1",
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Event not found" });

  const isModerator = req.user.roles.includes("moderator") || req.user.roles.includes("admin");
  if (rows[0].submitted_by_id !== req.user.id && !isModerator) {
    return res.status(403).json({ error: "Not your event" });
  }

  // Delete associated files from Spaces
  const { rows: fileRows } = await pool.query(
    `SELECT f.id, f.storage_key FROM event_files ef
     JOIN files f ON f.id = ef.file_id
     WHERE ef.event_id = $1`,
    [req.params.id]
  );
  for (const f of fileRows) {
    await deleteFile({ storageKey: f.storage_key, fileId: f.id, pool }).catch(() => {});
  }

  await pool.query("DELETE FROM events WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

// ── GET /api/events/pending ────────────────────────────────────────────────────
// Moderator only. Returns all pending events.

router.get("/pending", requireAuth, requireModerator, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, description, start_date, start_time, end_date, end_time,
            address, lat, lng, website, phone, email, area,
            organiser_name, organiser_email, organiser_phone,
            submitted_by_name, submitted_at
     FROM events
     WHERE status = 'pending'
     ORDER BY submitted_at ASC`
  );
  const events = await attachFiles(rows);
  res.json(events);
}));

// ── GET /api/events/:id ───────────────────────────────────────────────────────
// Auth + owner or moderator. Returns full event data including files.

router.get("/:id", requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, description, start_date, start_time, end_date, end_time,
            address, lat, lng, website, phone, email, area, status,
            organiser_name, organiser_email, organiser_phone,
            submitted_by_id, submitted_at
     FROM events WHERE id = $1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Event not found" });
  const isModerator = req.user.roles.includes("moderator") || req.user.roles.includes("admin");
  if (rows[0].submitted_by_id !== req.user.id && !isModerator) {
    return res.status(403).json({ error: "Not your event" });
  }
  const [event] = await attachFiles(rows);
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
  const desc = description?.trim() || "";
  if (desc.length < 50) return res.status(400).json({ error: "Description must be at least 50 characters" });
  if (desc.length > 1000) return res.status(400).json({ error: "Description must be 1000 characters or fewer" });
  const eventArea = area?.trim() || "Featherston";

  const { rows } = await pool.query(
    `INSERT INTO events
       (title, description, start_date, start_time, end_date, end_time,
        address, lat, lng, website, phone, email,
        organiser_name, organiser_email, organiser_phone, area,
        submitted_by_id, submitted_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      title.trim(), desc,
      start_date, start_time || null, end_date || null, end_time || null,
      address?.trim() || null,
      lat != null ? parseFloat(lat) : null, lng != null ? parseFloat(lng) : null,
      website?.trim() || null, phone?.trim() || null, email?.trim() || null,
      organiser_name?.trim() || null, organiser_email?.trim() || null, organiser_phone?.trim() || null,
      eventArea, req.user.id, req.user.name,
    ]
  );
  ;(async () => {
    await broadcastFcm("events", req.user.id, notify.eventCreated({
      title: title.trim(),
      description: desc,
    }));
  })().catch(() => {});
  res.status(201).json({ id: rows[0].id });
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

    const { rows: eventRows } = await pool.query(
      "SELECT submitted_by_id, status FROM events WHERE id = $1",
      [id]
    );
    if (!eventRows.length) return res.status(404).json({ error: "Event not found" });

    const isModerator = req.user.roles.includes("moderator") || req.user.roles.includes("admin");
    if (eventRows[0].submitted_by_id !== req.user.id && !isModerator) {
      return res.status(403).json({ error: "Not your event" });
    }

    if (!req.file) return res.status(400).json({ error: "No image provided" });
    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ error: "File must be an image" });
    }

    // Cap gallery at 3 images
    if (role === "gallery") {
      const { rows: existing } = await pool.query(
        "SELECT COUNT(*) FROM event_files WHERE event_id = $1 AND role = 'gallery'",
        [id]
      );
      if (parseInt(existing[0].count, 10) >= 3) {
        return res.status(400).json({ error: "Maximum 3 gallery images allowed" });
      }
    }

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
        const { rows: oldHero } = await client.query(
          `SELECT ef.file_id, f.storage_key
           FROM event_files ef JOIN files f ON f.id = ef.file_id
           WHERE ef.event_id = $1 AND ef.role = 'hero'`,
          [id]
        );
        if (oldHero.length) {
          await deleteFile({ storageKey: oldHero[0].storage_key, fileId: oldHero[0].file_id, pool: client });
          await client.query("DELETE FROM event_files WHERE event_id = $1 AND role = 'hero'", [id]);
        }
      }

      await client.query(
        "INSERT INTO event_files (event_id, file_id, role, position) VALUES ($1,$2,$3,$4)",
        [id, fileRow.id, role, parseInt(position, 10)]
      );
      if (eventRows[0].status === "approved") {
        await client.query("UPDATE events SET status = 'pending' WHERE id = $1", [id]);
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

  const { rows: eventRows } = await pool.query(
    "SELECT submitted_by_id, status FROM events WHERE id = $1",
    [id]
  );
  if (!eventRows.length) return res.status(404).json({ error: "Event not found" });

  const isModerator = req.user.roles.includes("moderator") || req.user.roles.includes("admin");
  if (eventRows[0].submitted_by_id !== req.user.id && !isModerator) {
    return res.status(403).json({ error: "Not your event" });
  }

  const { rows: efRows } = await pool.query(
    "SELECT ef.file_id, f.storage_key FROM event_files ef JOIN files f ON f.id = ef.file_id WHERE ef.event_id = $1 AND ef.file_id = $2",
    [id, fileId]
  );
  if (!efRows.length) return res.status(404).json({ error: "Image not found" });

  await deleteFile({ storageKey: efRows[0].storage_key, fileId: efRows[0].file_id, pool });
  await pool.query("DELETE FROM event_files WHERE event_id = $1 AND file_id = $2", [id, fileId]);
  if (eventRows[0].status === "approved") {
    await pool.query("UPDATE events SET status = 'pending' WHERE id = $1", [id]);
  }
  res.json({ ok: true });
}));

// ── PATCH /api/events/:id ─────────────────────────────────────────────────────
// Auth + owner or moderator. Updates event fields. Resets approved → pending.

router.patch("/:id", requireAuth, wrap(async (req, res) => {
  const { rows: existing } = await pool.query(
    "SELECT submitted_by_id, status FROM events WHERE id = $1",
    [req.params.id]
  );
  if (!existing.length) return res.status(404).json({ error: "Event not found" });
  const isModerator = req.user.roles.includes("moderator") || req.user.roles.includes("admin");
  if (existing[0].submitted_by_id !== req.user.id && !isModerator) {
    return res.status(403).json({ error: "Not your event" });
  }

  const { title, description, start_date, start_time, end_date, end_time,
          address, lat, lng, website, phone, email,
          organiser_name, organiser_email, organiser_phone, area } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Title is required" });
  if (!start_date) return res.status(400).json({ error: "Start date is required" });
  const eventArea = area?.trim() || "Featherston";

  const newStatus = existing[0].status === "approved" ? "pending" : existing[0].status;

  const { rows } = await pool.query(
    `UPDATE events
     SET title=$1, description=$2, start_date=$3, start_time=$4,
         end_date=$5, end_time=$6, address=$7, lat=$8, lng=$9,
         website=$10, phone=$11, email=$12,
         organiser_name=$13, organiser_email=$14, organiser_phone=$15,
         area=$16, status=$17
     WHERE id=$18
     RETURNING id, status`,
    [
      title.trim(), description?.trim() || null,
      start_date, start_time || null, end_date || null, end_time || null,
      address?.trim() || null,
      lat != null ? parseFloat(lat) : null, lng != null ? parseFloat(lng) : null,
      website?.trim() || null, phone?.trim() || null, email?.trim() || null,
      organiser_name?.trim() || null, organiser_email?.trim() || null, organiser_phone?.trim() || null,
      eventArea, newStatus, req.params.id,
    ]
  );
  res.json({ ok: true, status: rows[0].status });
}));

// ── PATCH /api/events/:id/approve ─────────────────────────────────────────────

router.patch("/:id/approve", requireAuth, requireModerator, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE events
     SET status = 'approved', reviewed_by_id = $1, reviewed_by_name = $2, reviewed_at = NOW()
     WHERE id = $3 AND status = 'pending'
     RETURNING id`,
    [req.user.id, req.user.name, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Event not found or not pending" });
  res.json({ ok: true });
}));

// ── PATCH /api/events/:id/decline ─────────────────────────────────────────────

router.patch("/:id/decline", requireAuth, requireModerator, wrap(async (req, res) => {
  const { decline_reason } = req.body;
  const { rows } = await pool.query(
    `UPDATE events
     SET status = 'declined', decline_reason = $1,
         reviewed_by_id = $2, reviewed_by_name = $3, reviewed_at = NOW()
     WHERE id = $4 AND status = 'pending'
     RETURNING id`,
    [decline_reason?.trim() || null, req.user.id, req.user.name, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Event not found or not pending" });
  res.json({ ok: true });
}));

// ── Error handler ─────────────────────────────────────────────────────────────

router.use((err, req, res, _next) => {
  console.error("[events]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

export default router;
