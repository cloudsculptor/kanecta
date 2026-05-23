import { Router } from "express";
import multer from "multer";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadFile, deleteFile } from "../lib/spaces.js";

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
            address, lat, lng, website, phone, email, submitted_at
     FROM events
     WHERE status = 'approved'
       AND COALESCE(end_date, start_date) + INTERVAL '30 days' > CURRENT_DATE
     ORDER BY start_date ASC`
  );
  const events = await attachFiles(rows);
  res.json(events);
}));

// ── GET /api/events/pending ────────────────────────────────────────────────────
// Moderator only. Returns all pending events.

router.get("/pending", requireAuth, requireModerator, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, description, start_date, start_time, end_date, end_time,
            address, lat, lng, website, phone, email, submitted_by_name, submitted_at
     FROM events
     WHERE status = 'pending'
     ORDER BY submitted_at ASC`
  );
  const events = await attachFiles(rows);
  res.json(events);
}));

// ── POST /api/events ───────────────────────────────────────────────────────────
// Auth + email verified. Creates a pending event.

router.post("/", requireAuth, wrap(async (req, res) => {
  if (!req.user.email_verified) {
    return res.status(403).json({ error: "Email address not verified" });
  }
  const { title, description, start_date, start_time, end_date, end_time,
          address, lat, lng, website, phone, email } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Title is required" });
  if (!start_date) return res.status(400).json({ error: "Start date is required" });

  const { rows } = await pool.query(
    `INSERT INTO events
       (title, description, start_date, start_time, end_date, end_time,
        address, lat, lng, website, phone, email, submitted_by_id, submitted_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      title.trim(),
      description?.trim() || null,
      start_date,
      start_time || null,
      end_date || null,
      end_time || null,
      address?.trim() || null,
      lat != null ? parseFloat(lat) : null,
      lng != null ? parseFloat(lng) : null,
      website?.trim() || null,
      phone?.trim() || null,
      email?.trim() || null,
      req.user.id,
      req.user.name,
    ]
  );
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
    if (eventRows[0].status === "approved") {
      return res.status(400).json({ error: "Cannot modify an approved event" });
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
  if (eventRows[0].status === "approved") {
    return res.status(400).json({ error: "Cannot modify an approved event" });
  }

  const { rows: efRows } = await pool.query(
    "SELECT ef.file_id, f.storage_key FROM event_files ef JOIN files f ON f.id = ef.file_id WHERE ef.event_id = $1 AND ef.file_id = $2",
    [id, fileId]
  );
  if (!efRows.length) return res.status(404).json({ error: "Image not found" });

  await deleteFile({ storageKey: efRows[0].storage_key, fileId: efRows[0].file_id, pool });
  await pool.query("DELETE FROM event_files WHERE event_id = $1 AND file_id = $2", [id, fileId]);
  res.json({ ok: true });
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
