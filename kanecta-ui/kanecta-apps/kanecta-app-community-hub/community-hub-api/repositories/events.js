// Data access for the `events` domain. Every method takes an explicit `db`
// handle as its first argument — pass the shared `pool` for a normal call, or a
// checked-out transaction `client` to enlist in a caller-owned BEGIN/COMMIT.
// This is the injected-dependency seam the repository swap needs: the image
// endpoints run several of these inside one transaction that ALSO interleaves
// Spaces (S3) uploads, so the route keeps ownership of that transaction and hands
// each statement the client; pure reads/writes just pass the pool.
// Part of the repository seam — see repositories/licences.js.
import pool from "../db.js";
import { USE_KANECTA } from "./backend.js";
import * as kanecta from "./kanecta/events.js";

// Hero + gallery file rows for a set of events (used to attach image URLs).
export async function getEventFiles(db, ids) {
  if (USE_KANECTA) return kanecta.getEventFiles(db, ids);
  const { rows } = await db.query(
    `SELECT ef.event_id, ef.role, ef.position, f.id AS file_id, f.storage_key, f.mime_type
     FROM event_files ef
     JOIN files f ON f.id = ef.file_id
     WHERE ef.event_id = ANY($1::uuid[]) AND f.deleted_at IS NULL
     ORDER BY ef.event_id, ef.role DESC, ef.position`,
    [ids]
  );
  return rows;
}

// Public list: approved, non-deleted, ending today or later.
export async function listUpcomingApprovedEvents(db) {
  if (USE_KANECTA) return kanecta.listUpcomingApprovedEvents(db);
  const { rows } = await db.query(
    `SELECT id, title, description, start_date, start_time, end_date, end_time,
            address, lat, lng, website, phone, email, area, submitted_at
     FROM events
     WHERE status = 'approved'
       AND deleted_at IS NULL
       AND COALESCE(end_date, start_date) >= CURRENT_DATE
     ORDER BY start_date ASC`
  );
  return rows;
}

export async function listMyEvents(db, userId) {
  if (USE_KANECTA) return kanecta.listMyEvents(db, userId);
  const { rows } = await db.query(
    `SELECT id, title, start_date, start_time, end_date, status, decline_reason, submitted_at
     FROM events
     WHERE submitted_by_id = $1
       AND deleted_at IS NULL
     ORDER BY submitted_at DESC`,
    [userId]
  );
  return rows;
}

export async function listPendingEvents(db) {
  if (USE_KANECTA) return kanecta.listPendingEvents(db);
  const { rows } = await db.query(
    `SELECT id, title, description, start_date, start_time, end_date, end_time,
            address, lat, lng, website, phone, email, area,
            organiser_name, organiser_email, organiser_phone,
            submitted_by_name, submitted_at
     FROM events
     WHERE status = 'pending'
       AND deleted_at IS NULL
     ORDER BY submitted_at ASC`
  );
  return rows;
}

// Full detail row for one non-deleted event, or null.
export async function getEventDetail(db, id) {
  if (USE_KANECTA) return kanecta.getEventDetail(db, id);
  const { rows } = await db.query(
    `SELECT id, title, description, start_date, start_time, end_date, end_time,
            address, lat, lng, website, phone, email, area, status,
            organiser_name, organiser_email, organiser_phone,
            submitted_by_id, submitted_at
     FROM events WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

// Ownership + deleted flag (for the delete endpoint). Null if the id is unknown.
export async function getEventForDelete(db, id) {
  if (USE_KANECTA) return kanecta.getEventForDelete(db, id);
  const { rows } = await db.query(
    "SELECT submitted_by_id, deleted_at FROM events WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

// Ownership + status (for image + patch endpoints). Null if the id is unknown.
export async function getEventOwnerStatus(db, id) {
  if (USE_KANECTA) return kanecta.getEventOwnerStatus(db, id);
  const { rows } = await db.query(
    "SELECT submitted_by_id, status FROM events WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function softDeleteEvent(db, id) {
  if (USE_KANECTA) return kanecta.softDeleteEvent(db, id);
  await db.query("UPDATE events SET deleted_at = NOW() WHERE id = $1", [id]);
}

export async function createEvent(db, {
  title, description, startDate, startTime, endDate, endTime,
  address, lat, lng, website, phone, email,
  organiserName, organiserEmail, organiserPhone, area, submittedById, submittedByName,
}) {
  if (USE_KANECTA) return kanecta.createEvent(db, { title, description, startDate, startTime, endDate, endTime, address, lat, lng, website, phone, email, organiserName, organiserEmail, organiserPhone, area, submittedById, submittedByName });
  const { rows } = await db.query(
    `INSERT INTO events
       (title, description, start_date, start_time, end_date, end_time,
        address, lat, lng, website, phone, email,
        organiser_name, organiser_email, organiser_phone, area,
        submitted_by_id, submitted_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      title, description, startDate, startTime, endDate, endTime,
      address, lat, lng, website, phone, email,
      organiserName, organiserEmail, organiserPhone, area, submittedById, submittedByName,
    ]
  );
  return rows[0];
}

export async function countGalleryImages(db, eventId) {
  if (USE_KANECTA) return kanecta.countGalleryImages(db, eventId);
  const { rows } = await db.query(
    "SELECT COUNT(*) FROM event_files WHERE event_id = $1 AND role = 'gallery'",
    [eventId]
  );
  return parseInt(rows[0].count, 10);
}

// The current hero image row for an event (file_id + storage_key), or undefined.
export async function getHeroImage(db, eventId) {
  if (USE_KANECTA) return kanecta.getHeroImage(db, eventId);
  const { rows } = await db.query(
    `SELECT ef.file_id, f.storage_key
     FROM event_files ef JOIN files f ON f.id = ef.file_id
     WHERE ef.event_id = $1 AND ef.role = 'hero'`,
    [eventId]
  );
  return rows[0];
}

export async function deleteHeroEventFile(db, eventId) {
  if (USE_KANECTA) return kanecta.deleteHeroEventFile(db, eventId);
  await db.query("DELETE FROM event_files WHERE event_id = $1 AND role = 'hero'", [eventId]);
}

export async function insertEventFile(db, { eventId, fileId, role, position }) {
  if (USE_KANECTA) return kanecta.insertEventFile(db, { eventId, fileId, role, position });
  await db.query(
    "INSERT INTO event_files (event_id, file_id, role, position) VALUES ($1,$2,$3,$4)",
    [eventId, fileId, role, position]
  );
}

export async function setEventPendingIfApproved(db, eventId) {
  if (USE_KANECTA) return kanecta.setEventPendingIfApproved(db, eventId);
  await db.query("UPDATE events SET status = 'pending' WHERE id = $1", [eventId]);
}

// The (event_file → file) row for a specific attachment, or undefined.
export async function getEventFile(db, eventId, fileId) {
  if (USE_KANECTA) return kanecta.getEventFile(db, eventId, fileId);
  const { rows } = await db.query(
    "SELECT ef.file_id, f.storage_key FROM event_files ef JOIN files f ON f.id = ef.file_id WHERE ef.event_id = $1 AND ef.file_id = $2",
    [eventId, fileId]
  );
  return rows[0];
}

export async function deleteEventFile(db, eventId, fileId) {
  if (USE_KANECTA) return kanecta.deleteEventFile(db, eventId, fileId);
  await db.query("DELETE FROM event_files WHERE event_id = $1 AND file_id = $2", [eventId, fileId]);
}

// Update event fields; returns { id, status }.
export async function updateEvent(db, {
  id, title, description, startDate, startTime, endDate, endTime,
  address, lat, lng, website, phone, email,
  organiserName, organiserEmail, organiserPhone, area, status,
}) {
  if (USE_KANECTA) return kanecta.updateEvent(db, { id, title, description, startDate, startTime, endDate, endTime, address, lat, lng, website, phone, email, organiserName, organiserEmail, organiserPhone, area, status });
  const { rows } = await db.query(
    `UPDATE events
     SET title=$1, description=$2, start_date=$3, start_time=$4,
         end_date=$5, end_time=$6, address=$7, lat=$8, lng=$9,
         website=$10, phone=$11, email=$12,
         organiser_name=$13, organiser_email=$14, organiser_phone=$15,
         area=$16, status=$17
     WHERE id=$18
     RETURNING id, status`,
    [
      title, description, startDate, startTime, endDate, endTime,
      address, lat, lng, website, phone, email,
      organiserName, organiserEmail, organiserPhone, area, status, id,
    ]
  );
  return rows[0];
}

// Approve a pending event; returns the id row or undefined.
export async function approveEvent(db, { id, reviewedById, reviewedByName }) {
  if (USE_KANECTA) return kanecta.approveEvent(db, { id, reviewedById, reviewedByName });
  const { rows } = await db.query(
    `UPDATE events
     SET status = 'approved', reviewed_by_id = $1, reviewed_by_name = $2, reviewed_at = NOW()
     WHERE id = $3 AND status = 'pending' AND deleted_at IS NULL
     RETURNING id`,
    [reviewedById, reviewedByName, id]
  );
  return rows[0];
}

// Decline a pending event; returns the id row or undefined.
export async function declineEvent(db, { id, declineReason, reviewedById, reviewedByName }) {
  if (USE_KANECTA) return kanecta.declineEvent(db, { id, declineReason, reviewedByName, reviewedById });
  const { rows } = await db.query(
    `UPDATE events
     SET status = 'declined', decline_reason = $1,
         reviewed_by_id = $2, reviewed_by_name = $3, reviewed_at = NOW()
     WHERE id = $4 AND status = 'pending' AND deleted_at IS NULL
     RETURNING id`,
    [declineReason, reviewedById, reviewedByName, id]
  );
  return rows[0];
}
