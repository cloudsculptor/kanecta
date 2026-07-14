// Data access for the `discussions` domain (threads, messages, replies,
// reactions, read state, message files, notification subscriptions). Intent-named
// methods own the SQL; everything else stays in the route: Keycloak admin lookups
// for @mention users, FCM / web-push realtime (notifyThreadSubscribers etc.),
// Spaces (S3) upload/download/delete, Socket.io emission, the SPACES_PUBLIC_URL
// URL construction on file rows, reaction map-grouping, and all validation +
// HTTP shaping. Discussions has NO multi-statement transaction, so — like
// notices/licences — every method runs on the shared pool directly (no explicit
// `db` seam; that is only needed for the S3-interleaved event/page writes).
// Part of the repository seam — see repositories/licences.js.
import pool from "../db.js";
import { USE_KANECTA } from "./backend.js";
import * as kanecta from "./kanecta/discussions.js";

// ── Message files ─────────────────────────────────────────────────────────────

// Attach already-uploaded files (owned by the uploader) to a message. No-op for
// an empty/absent file list so no query fires — preserves route call order.
export async function attachFilesToMessage(messageId, fileIds, uploaderId) {
  if (!fileIds?.length) return;
  await pool.query(
    `INSERT INTO discussions_message_files (message_id, file_id)
     SELECT $1, id FROM files
     WHERE id = ANY($2::uuid[]) AND uploaded_by_id = $3
     ON CONFLICT DO NOTHING`,
    [messageId, fileIds, uploaderId]
  );
}

// Raw (dmf + file) rows for one message, oldest attachment first. The route adds
// the public URL from SPACES_PUBLIC_URL.
export async function getMessageFiles(messageId) {
  const { rows } = await pool.query(
    `SELECT dmf.id, f.id AS file_id, f.name, f.mime_type, f.size_bytes, f.storage_key, dmf.show_preview
     FROM discussions_message_files dmf
     JOIN files f ON f.id = dmf.file_id
     WHERE dmf.message_id = $1
     ORDER BY dmf.created_at`,
    [messageId]
  );
  return rows;
}

// { name, storage_key, mime_type } for a file, or undefined (download endpoint).
export async function getFileForDownload(fileId) {
  const { rows } = await pool.query(
    "SELECT name, storage_key, mime_type FROM files WHERE id = $1",
    [fileId]
  );
  return rows[0];
}

// { id, storage_key, uploaded_by_id } for a file, or undefined (delete endpoint).
export async function getFileForDelete(fileId) {
  const { rows } = await pool.query(
    "SELECT id, storage_key, uploaded_by_id FROM files WHERE id = $1",
    [fileId]
  );
  return rows[0];
}

// Toggle a message file's preview flag, scoped to the message author. Returns the
// { id } row, or undefined if not found / not authorised.
export async function setMessageFilePreview(id, showPreview, userId) {
  const { rows } = await pool.query(
    `UPDATE discussions_message_files dmf
     SET show_preview = $1
     FROM discussions_messages m
     WHERE dmf.id = $2 AND dmf.message_id = m.id AND m.user_id = $3
     RETURNING dmf.id`,
    [showPreview, id, userId]
  );
  return rows[0];
}

// ── Threads ───────────────────────────────────────────────────────────────────

// Does this user have any thread-read rows yet? (First-visit seeding gate.)
export async function hasThreadReads(userId) {
  const { rows } = await pool.query(
    "SELECT 1 FROM discussions_thread_reads WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  return rows.length > 0;
}

// Seed a first-time visitor's read state so they start with everything read.
export async function seedThreadReads(userId) {
  await pool.query(
    `INSERT INTO discussions_thread_reads (user_id, thread_id, last_read_at)
     SELECT $1, id, COALESCE(latest_message_at, NOW())
     FROM discussions_threads WHERE archived_at IS NULL
     ON CONFLICT DO NOTHING`,
    [userId]
  );
}

// Live threads with per-user unread + notification-subscription flags.
export async function listThreads(userId) {
  if (USE_KANECTA) return kanecta.listThreads(userId);
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.description, t.created_by_name, t.created_by_user_id, t.created_at,
            CASE WHEN t.latest_message_at IS NOT NULL
                      AND (r.last_read_at IS NULL OR t.latest_message_at > r.last_read_at)
                 THEN true ELSE false END AS has_unread,
            CASE WHEN tns.user_id IS NOT NULL THEN true ELSE false END AS is_notifications_enabled
     FROM discussions_threads t
     LEFT JOIN discussions_thread_reads r ON r.thread_id = t.id AND r.user_id = $1
     LEFT JOIN thread_notification_subscriptions tns ON tns.thread_id = t.id AND tns.user_id = $1
     WHERE t.archived_at IS NULL
     ORDER BY t.sort_order ASC NULLS LAST, t.name ASC`,
    [userId]
  );
  return rows;
}

// Live threads whose whitespace-insensitive lowercased name matches `normalized`
// (duplicate-name guard). The route computes `normalized` from the input name.
export async function findDuplicateThreads(normalized) {
  const { rows } = await pool.query(
    `SELECT id, name, description FROM discussions_threads
     WHERE archived_at IS NULL
       AND LOWER(REGEXP_REPLACE(name, '\\s+', '', 'g')) = $1`,
    [normalized]
  );
  return rows;
}

export async function createThread({ name, description, createdByUserId, createdByName }) {
  const { rows } = await pool.query(
    `INSERT INTO discussions_threads (name, description, created_by_user_id, created_by_name)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, description, createdByUserId, createdByName]
  );
  return rows[0];
}

// { created_by_user_id, created_by_name } for a live thread, or undefined.
export async function getThreadForArchive(threadId) {
  const { rows } = await pool.query(
    `SELECT created_by_user_id, created_by_name FROM discussions_threads
     WHERE id = $1 AND archived_at IS NULL`,
    [threadId]
  );
  return rows[0];
}

export async function archiveThread(threadId) {
  await pool.query(
    "UPDATE discussions_threads SET archived_at = NOW() WHERE id = $1",
    [threadId]
  );
}

// The thread's display name, or undefined (used by realtime notifications).
export async function getThreadName(threadId) {
  const { rows } = await pool.query(
    "SELECT name FROM discussions_threads WHERE id = $1",
    [threadId]
  );
  return rows[0];
}

// Bump a thread's latest_message_at (drives unread + ordering).
export async function touchThreadLatestMessage(threadId, at) {
  await pool.query(
    "UPDATE discussions_threads SET latest_message_at = $1 WHERE id = $2",
    [at, threadId]
  );
}

// ── Messages ──────────────────────────────────────────────────────────────────

// Top-level messages for a thread, oldest first, with reply_count + attached
// files as a JSON array. Optional `before` (ISO timestamp) paginates backwards.
// The route adds public URLs to the returned files.
export async function listThreadMessages(threadId, limit, before) {
  const { rows } = await pool.query(
    `SELECT m.id, m.thread_id, m.user_id, m.user_name, m.content, m.created_at, m.edited_at, m.deleted_at,
            (SELECT COUNT(*) FROM discussions_messages r WHERE r.parent_message_id = m.id)::int AS reply_count,
            COALESCE(
              (SELECT json_agg(json_build_object(
                'id', dmf.id, 'file_id', f.id, 'name', f.name,
                'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
                'storage_key', f.storage_key, 'show_preview', dmf.show_preview
              ) ORDER BY dmf.created_at)
              FROM discussions_message_files dmf
              JOIN files f ON f.id = dmf.file_id
              WHERE dmf.message_id = m.id),
              '[]'::json
            ) AS files
     FROM discussions_messages m
     WHERE thread_id = $1
       AND parent_message_id IS NULL
       ${before ? "AND created_at < $3" : ""}
     ORDER BY created_at ASC
     LIMIT $2`,
    before ? [threadId, limit, before] : [threadId, limit]
  );
  return rows;
}

// Insert a top-level message; RETURNING includes a literal 0 reply_count.
export async function createMessage({ threadId, userId, userName, content }) {
  const { rows } = await pool.query(
    `INSERT INTO discussions_messages (thread_id, user_id, user_name, content)
     VALUES ($1, $2, $3, $4) RETURNING *, 0 AS reply_count`,
    [threadId, userId, userName, content]
  );
  return rows[0];
}

// Advance a user's read marker for a thread, but never move it backwards.
export async function upsertThreadRead(userId, threadId, at) {
  await pool.query(
    `INSERT INTO discussions_thread_reads (user_id, thread_id, last_read_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at
     WHERE EXCLUDED.last_read_at > discussions_thread_reads.last_read_at`,
    [userId, threadId, at]
  );
}

// Edit a message's content, scoped to its author + not-deleted. Returns the
// updated row, or undefined if not found / not owned.
export async function updateMessage(id, content, userId) {
  const { rows } = await pool.query(
    `UPDATE discussions_messages
     SET content = $1, edited_at = NOW()
     WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL
     RETURNING *`,
    [content, id, userId]
  );
  return rows[0];
}

// Soft-delete a message (blanks content). Moderators skip the author filter;
// team members can only delete their own. Returns the row, or undefined.
export async function deleteMessage(id, userId, isModerator) {
  const { rows } = await pool.query(
    `UPDATE discussions_messages
     SET deleted_at = NOW(), content = ''
     WHERE id = $1 ${isModerator ? "" : "AND user_id = $2"} AND deleted_at IS NULL
     RETURNING *`,
    isModerator ? [id] : [id, userId]
  );
  return rows[0];
}

// ── Replies ───────────────────────────────────────────────────────────────────

// Replies to a message, oldest first, with attached files as a JSON array. The
// route adds public URLs.
export async function listReplies(parentId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.thread_id, m.parent_message_id, m.user_id, m.user_name, m.content,
            m.created_at, m.edited_at, m.deleted_at,
            COALESCE(
              (SELECT json_agg(json_build_object(
                'id', dmf.id, 'file_id', f.id, 'name', f.name,
                'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
                'storage_key', f.storage_key, 'show_preview', dmf.show_preview
              ) ORDER BY dmf.created_at)
              FROM discussions_message_files dmf
              JOIN files f ON f.id = dmf.file_id
              WHERE dmf.message_id = m.id),
              '[]'::json
            ) AS files
     FROM discussions_messages m
     WHERE parent_message_id = $1
     ORDER BY created_at ASC`,
    [parentId]
  );
  return rows;
}

// { id, thread_id } for a top-level (non-reply) message, or undefined.
export async function getParentMessage(id) {
  const { rows } = await pool.query(
    "SELECT id, thread_id FROM discussions_messages WHERE id = $1 AND parent_message_id IS NULL",
    [id]
  );
  return rows[0];
}

export async function createReply({ threadId, parentMessageId, userId, userName, content }) {
  const { rows } = await pool.query(
    `INSERT INTO discussions_messages (thread_id, parent_message_id, user_id, user_name, content)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [threadId, parentMessageId, userId, userName, content]
  );
  return rows[0];
}

// ── Notification subscriptions ────────────────────────────────────────────────

export async function subscribeThreadNotifications(userId, threadId) {
  await pool.query(
    `INSERT INTO thread_notification_subscriptions (user_id, thread_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, threadId]
  );
}

export async function unsubscribeThreadNotifications(userId, threadId) {
  await pool.query(
    "DELETE FROM thread_notification_subscriptions WHERE user_id = $1 AND thread_id = $2",
    [userId, threadId]
  );
}

// ── Read state ────────────────────────────────────────────────────────────────

// Threads with messages the user hasn't read (own messages excluded), each with
// its unread messages (and parents of new replies) as a JSON array.
export async function listUnreads(userId) {
  const { rows } = await pool.query(
    `SELECT t.id AS thread_id, t.name, rd.last_read_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', m.id,
                  'thread_id', m.thread_id,
                  'parent_message_id', m.parent_message_id,
                  'user_id', m.user_id,
                  'user_name', m.user_name,
                  'content', m.content,
                  'created_at', m.created_at,
                  'edited_at', m.edited_at,
                  'deleted_at', m.deleted_at,
                  'reply_count', (SELECT COUNT(*)::int FROM discussions_messages rc WHERE rc.parent_message_id = m.id)
                ) ORDER BY m.created_at ASC
              ) FILTER (WHERE m.id IS NOT NULL),
              '[]'::json
            ) AS messages
     FROM discussions_threads t
     JOIN discussions_thread_reads rd ON rd.thread_id = t.id AND rd.user_id = $1
     LEFT JOIN discussions_messages m ON m.thread_id = t.id
       AND m.deleted_at IS NULL
       AND (
         -- New top-level messages from others
         (m.parent_message_id IS NULL AND m.created_at > rd.last_read_at AND m.user_id != $1)
         OR
         -- New replies from others
         (m.parent_message_id IS NOT NULL AND m.created_at > rd.last_read_at AND m.user_id != $1)
         OR
         -- Parent messages of new replies from others (shown as context)
         (m.parent_message_id IS NULL AND EXISTS (
           SELECT 1 FROM discussions_messages nr
           WHERE nr.parent_message_id = m.id
             AND nr.created_at > rd.last_read_at
             AND nr.deleted_at IS NULL
             AND nr.user_id != $1
         ))
       )
     WHERE t.archived_at IS NULL
       AND t.latest_message_at IS NOT NULL
       AND t.latest_message_at > rd.last_read_at
     GROUP BY t.id, t.name, rd.last_read_at
     ORDER BY t.created_at ASC`,
    [userId]
  );
  return rows;
}

// Mark a thread read up to its latest message (or now if empty).
export async function markThreadRead(userId, threadId) {
  await pool.query(
    `INSERT INTO discussions_thread_reads (user_id, thread_id, last_read_at)
     VALUES ($1, $2, COALESCE(
       (SELECT MAX(created_at) FROM discussions_messages WHERE thread_id = $2),
       NOW()
     ))
     ON CONFLICT (user_id, thread_id)
     DO UPDATE SET last_read_at = EXCLUDED.last_read_at`,
    [userId, threadId]
  );
}

// ── Reactions ─────────────────────────────────────────────────────────────────

// Reaction rows for every message in a thread (route groups them by message_id).
export async function getThreadReactions(threadId) {
  const { rows } = await pool.query(
    `SELECT dr.message_id, dr.emoji, COUNT(*) AS count,
            array_agg(dr.user_id) AS user_ids, array_agg(dr.user_name) AS user_names
     FROM discussions_reactions dr
     JOIN discussions_messages dm ON dm.id = dr.message_id
     WHERE dm.thread_id = $1
     GROUP BY dr.message_id, dr.emoji`,
    [threadId]
  );
  return rows;
}

export async function addReaction(messageId, userId, userName, emoji) {
  await pool.query(
    `INSERT INTO discussions_reactions (message_id, user_id, user_name, emoji) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [messageId, userId, userName, emoji]
  );
}

export async function removeReaction(messageId, userId, emoji) {
  await pool.query(
    "DELETE FROM discussions_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
    [messageId, userId, emoji]
  );
}

// Aggregated reaction counts (emoji → count + user arrays) for one message.
export async function getMessageReactions(messageId) {
  const { rows } = await pool.query(
    `SELECT emoji, COUNT(*) AS count, array_agg(user_id) AS user_ids, array_agg(user_name) AS user_names
     FROM discussions_reactions WHERE message_id = $1 GROUP BY emoji`,
    [messageId]
  );
  return rows;
}

// The thread a message belongs to (for scoping realtime reaction updates).
export async function getMessageThreadId(messageId) {
  const { rows } = await pool.query(
    "SELECT thread_id FROM discussions_messages WHERE id = $1",
    [messageId]
  );
  return rows[0];
}
