// KanectaRepository — discussions over kanecta-api (GraphQL). The multi-table,
// per-user joins (unread rollups, reaction maps, reply counts, file arrays) that
// GraphQL can't express as a single query are read from the projected obj_ tables
// and composed in JS — reproducing the pg SQL semantics exactly. File BYTES stay
// out of here; only the file RECORD metadata is read (native-file section handles
// the bytes).
import { graphql, transaction, createItem, updateObject, getItem, deleteItem, resolveTypeId, newId, ROOT_ID, OWNER } from "../../lib/kanectaClient.js";
import { coerceRow, selectionFor } from "../../lib/kanectaMap.js";

// Does this user have any thread-read rows yet? (First-visit seeding gate.)
// pg: SELECT 1 FROM discussions_thread_reads WHERE user_id=$1 LIMIT 1
export async function hasThreadReads(userId) {
  const data = await graphql(
    `query($u:String){ discussionsThreadReadses(where:{userId:{eq:$u}}, limit:1){ id } }`,
    { u: userId },
  );
  return data.discussionsThreadReadses.length > 0;
}

// Seed a first-time visitor's read state so they start with everything read.
// pg: INSERT (user_id, thread_id, last_read_at) SELECT ... FROM active threads
//     ON CONFLICT DO NOTHING. Here: create a thread-read item per active thread the
//     user has not already read, all in one atomic transaction.
export async function seedThreadReads(userId) {
  const typeId = await resolveTypeId("discussions-thread-reads");
  const data = await graphql(
    `query($u:String){
       discussionsThreadses(where:{archivedAt:{isNull:true}}, limit:500){ id latestMessageAt }
       discussionsThreadReadses(where:{userId:{eq:$u}}, limit:500){ threadId { id } }
     }`,
    { u: userId },
  );
  const already = new Set(data.discussionsThreadReadses.map((r) => r.threadId?.id));
  const now = new Date().toISOString();
  const ops = data.discussionsThreadses
    .filter((t) => !already.has(t.id))
    .map((t) => ({
      op: "create", id: newId(), type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
      objectData: { userId, threadId: t.id, lastReadAt: t.latestMessageAt || now },
    }));
  if (ops.length) await transaction(ops);
}

// pg (see repositories/pg/discussions.js listThreads):
//   threads LEFT JOIN thread_reads(user) LEFT JOIN subscriptions(user)
//   has_unread = latest_message_at IS NOT NULL AND (last_read_at IS NULL OR latest > last_read_at)
//   is_notifications_enabled = the user has a subscription row
//   WHERE archived_at IS NULL ORDER BY sort_order ASC NULLS LAST, name ASC
export async function listThreads(userId) {
  const data = await graphql(
    `query($u:String){
       discussionsThreadses(where:{archivedAt:{isNull:true}},
         sort:[{field:sortOrder,direction:ASC,nulls:LAST},{field:name,direction:ASC}], limit:500){
         id name description createdByName createdByUserId createdAt latestMessageAt }
       discussionsThreadReadses(where:{userId:{eq:$u}}, limit:500){ threadId { id } lastReadAt }
       threadNotificationSubscriptionses(where:{userId:{eq:$u}}, limit:500){ threadId { id } }
     }`,
    { u: userId },
  );

  const lastReadByThread = new Map(
    data.discussionsThreadReadses.map((r) => [r.threadId?.id, r.lastReadAt]),
  );
  const subscribed = new Set(
    data.threadNotificationSubscriptionses.map((s) => s.threadId?.id),
  );

  return data.discussionsThreadses.map((t) => {
    const lastRead = lastReadByThread.has(t.id) ? lastReadByThread.get(t.id) : null;
    const hasUnread =
      t.latestMessageAt != null &&
      (lastRead == null || new Date(t.latestMessageAt) > new Date(lastRead));
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      created_by_name: t.createdByName,
      created_by_user_id: t.createdByUserId,
      created_at: t.createdAt == null ? t.createdAt : new Date(t.createdAt).toISOString(),
      has_unread: hasUnread,
      is_notifications_enabled: subscribed.has(t.id),
    };
  });
}

// ─── Threads (CRUD + metadata) ───────────────────────────────────────────────

const THREAD_STAR = [
  ["id", "id"], ["name", "text"], ["description", "text"], ["created_by_user_id", "text"],
  ["created_by_name", "text"], ["created_at", "timestamp"], ["archived_at", "timestamp"],
  ["latest_message_at", "timestamp"], ["sort_order", "int"],
];

async function readThread(id) {
  const data = await graphql(
    `query($id:ID){ discussionsThreadses(where:{id:{eq:$id}}, limit:1){ ${selectionFor(THREAD_STAR)} } }`, { id },
  );
  return data.discussionsThreadses[0] ? coerceRow(data.discussionsThreadses[0], THREAD_STAR) : undefined;
}

// pg: WHERE archived_at IS NULL AND LOWER(REGEXP_REPLACE(name,whitespace,'','g'))=$1.
// GraphQL can't regexp; normalise the (already-lowercased, whitespace-stripped) name
// in JS over the live threads.
export async function findDuplicateThreads(normalized) {
  const data = await graphql(
    `{ discussionsThreadses(where:{archivedAt:{isNull:true}}, limit:500){ id name description } }`,
  );
  return data.discussionsThreadses
    .filter((t) => String(t.name).toLowerCase().replace(/\s+/g, "") === normalized)
    .map((t) => ({ id: t.id, name: t.name, description: t.description }));
}

// pg: INSERT INTO discussions_threads (...) RETURNING *. created_at defaults NOW();
//     archived_at/latest_message_at/sort_order are null.
export async function createThread({ name, description, createdByUserId, createdByName }) {
  const typeId = await resolveTypeId("discussions-threads");
  const id = newId();
  await createItem({
    id, type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: {
      name, description: description ?? null, createdByUserId, createdByName,
      createdAt: new Date().toISOString(), archivedAt: null, latestMessageAt: null, sortOrder: null,
    },
  });
  return readThread(id);
}

// pg: SELECT created_by_user_id, created_by_name WHERE id=$1 AND archived_at IS NULL
export async function getThreadForArchive(threadId) {
  const data = await graphql(
    `query($id:ID){ discussionsThreadses(where:{id:{eq:$id}, archivedAt:{isNull:true}}, limit:1){ createdByUserId createdByName } }`,
    { id: threadId },
  );
  const t = data.discussionsThreadses[0];
  return t ? { created_by_user_id: t.createdByUserId, created_by_name: t.createdByName } : undefined;
}

// pg: UPDATE discussions_threads SET archived_at=NOW() WHERE id=$1
export async function archiveThread(threadId) {
  const item = await getItem(threadId);
  if (!item?.payload) return;
  await updateObject(threadId, { ...item.payload, archivedAt: new Date().toISOString() });
}

// pg: SELECT name WHERE id=$1 -> { name } or undefined
export async function getThreadName(threadId) {
  const data = await graphql(
    `query($id:ID){ discussionsThreadses(where:{id:{eq:$id}}, limit:1){ name } }`, { id: threadId },
  );
  return data.discussionsThreadses[0] ? { name: data.discussionsThreadses[0].name } : undefined;
}

// pg: UPDATE discussions_threads SET latest_message_at=$1 WHERE id=$2
export async function touchThreadLatestMessage(threadId, at) {
  const item = await getItem(threadId);
  if (!item?.payload) return;
  await updateObject(threadId, {
    ...item.payload, latestMessageAt: at instanceof Date ? at.toISOString() : at,
  });
}

// ─── Messages / replies ──────────────────────────────────────────────────────

const MESSAGE_STAR = [
  ["id", "id"], ["thread_id", "ref"], ["parent_message_id", "ref"], ["user_id", "text"],
  ["user_name", "text"], ["content", "text"], ["created_at", "timestamp"],
  ["edited_at", "timestamp"], ["deleted_at", "timestamp"],
];

async function readMessage(id) {
  const data = await graphql(
    `query($id:ID){ discussionsMessageses(where:{id:{eq:$id}}, limit:1){ ${selectionFor(MESSAGE_STAR)} } }`, { id },
  );
  return data.discussionsMessageses[0] ? coerceRow(data.discussionsMessageses[0], MESSAGE_STAR) : undefined;
}

// Attached files (dmf JOIN files) for a set of message ids, grouped by message id,
// each list ordered by dmf.created_at — mirrors the json_agg in the pg queries.
async function filesByMessage(messageIds) {
  const byMsg = new Map();
  if (!messageIds.length) return byMsg;
  const data = await graphql(
    `{ discussionsMessageFileses(limit:2000){ id messageId{id} fileId{id} showPreview createdAt } fileses(limit:2000){ id name mimeType sizeBytes storageKey } }`,
  );
  const idset = new Set(messageIds);
  const fileById = new Map(data.fileses.map((f) => [f.id, f]));
  const dmfs = data.discussionsMessageFileses
    .filter((d) => idset.has(d.messageId?.id))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const d of dmfs) {
    const f = fileById.get(d.fileId?.id);
    if (!f) continue;
    const entry = {
      id: d.id, file_id: f.id, name: f.name, mime_type: f.mimeType,
      size_bytes: f.sizeBytes, storage_key: f.storageKey, show_preview: d.showPreview,
    };
    if (!byMsg.has(d.messageId.id)) byMsg.set(d.messageId.id, []);
    byMsg.get(d.messageId.id).push(entry);
  }
  return byMsg;
}

// Reply counts (children) per parent, over all messages in a thread.
async function replyCountsFor(threadId) {
  const data = await graphql(
    `query($t:ID){ discussionsMessageses(where:{threadId:{eq:$t}}, limit:2000){ id parentMessageId{id} } }`, { t: threadId },
  );
  const counts = new Map();
  for (const m of data.discussionsMessageses) {
    const pid = m.parentMessageId?.id;
    if (pid) counts.set(pid, (counts.get(pid) || 0) + 1);
  }
  return counts;
}

// pg: top-level messages for a thread, oldest first, LIMIT, with reply_count + files.
export async function listThreadMessages(threadId, limit, before) {
  const where = before
    ? `where:{threadId:{eq:$t}, and:[{parentMessageId:{isNull:true}},{createdAt:{lt:$b}}]}`
    : `where:{threadId:{eq:$t}, parentMessageId:{isNull:true}}`;
  const data = await graphql(
    `query($t:ID${before ? ",$b:String" : ""}){ discussionsMessageses(${where},
        sort:[{field:createdAt,direction:ASC}], limit:${Number(limit) || 50}){ ${selectionFor(MESSAGE_STAR)} } }`,
    before ? { t: threadId, b: before } : { t: threadId },
  );
  const rows = data.discussionsMessageses.map((r) => coerceRow(r, MESSAGE_STAR));
  const counts = await replyCountsFor(threadId);
  const files = await filesByMessage(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, thread_id: r.thread_id, user_id: r.user_id, user_name: r.user_name,
    content: r.content, created_at: r.created_at, edited_at: r.edited_at, deleted_at: r.deleted_at,
    reply_count: counts.get(r.id) || 0, files: files.get(r.id) || [],
  }));
}

// pg: INSERT top-level message RETURNING *, 0 AS reply_count
export async function createMessage({ threadId, userId, userName, content }) {
  const typeId = await resolveTypeId("discussions-messages");
  const id = newId();
  await createItem({
    id, type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: {
      threadId, parentMessageId: null, userId, userName, content,
      createdAt: new Date().toISOString(), editedAt: null, deletedAt: null,
    },
  });
  const row = await readMessage(id);
  return { ...row, reply_count: 0 };
}

// pg: UPDATE SET content, edited_at=NOW() WHERE id AND user_id AND deleted_at IS NULL
//     RETURNING * -> row or undefined
export async function updateMessage(id, content, userId) {
  const item = await getItem(id);
  const p = item?.payload;
  if (!p || p.userId !== userId || p.deletedAt != null) return undefined;
  await updateObject(id, { ...normalizeMessagePayload(p), content, editedAt: new Date().toISOString() });
  return readMessage(id);
}

// pg: soft-delete (deleted_at=NOW(), content='') WHERE id [AND user_id unless mod]
//     AND deleted_at IS NULL RETURNING * -> row or undefined
export async function deleteMessage(id, userId, isModerator) {
  const item = await getItem(id);
  const p = item?.payload;
  if (!p || p.deletedAt != null) return undefined;
  if (!isModerator && p.userId !== userId) return undefined;
  await updateObject(id, { ...normalizeMessagePayload(p), deletedAt: new Date().toISOString(), content: "" });
  return readMessage(id);
}

// A message payload from GET /items/:id carries its FK columns as resolved { id }
// objects; writeObjectJson wants the scalar ids back.
function normalizeMessagePayload(p) {
  return {
    ...p,
    threadId: p.threadId?.id ?? p.threadId,
    parentMessageId: p.parentMessageId?.id ?? p.parentMessageId ?? null,
  };
}

// pg: replies (parent_message_id=$1), oldest first, with files array
export async function listReplies(parentId) {
  const data = await graphql(
    `query($p:ID){ discussionsMessageses(where:{parentMessageId:{eq:$p}},
        sort:[{field:createdAt,direction:ASC}], limit:2000){ ${selectionFor(MESSAGE_STAR)} } }`, { p: parentId },
  );
  const rows = data.discussionsMessageses.map((r) => coerceRow(r, MESSAGE_STAR));
  const files = await filesByMessage(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, thread_id: r.thread_id, parent_message_id: r.parent_message_id,
    user_id: r.user_id, user_name: r.user_name, content: r.content,
    created_at: r.created_at, edited_at: r.edited_at, deleted_at: r.deleted_at,
    files: files.get(r.id) || [],
  }));
}

// pg: SELECT id, thread_id WHERE id=$1 AND parent_message_id IS NULL -> row or undefined
export async function getParentMessage(id) {
  const data = await graphql(
    `query($id:ID){ discussionsMessageses(where:{id:{eq:$id}, parentMessageId:{isNull:true}}, limit:1){ id threadId{id} } }`,
    { id },
  );
  const m = data.discussionsMessageses[0];
  return m ? { id: m.id, thread_id: m.threadId?.id ?? null } : undefined;
}

// pg: INSERT reply RETURNING *
export async function createReply({ threadId, parentMessageId, userId, userName, content }) {
  const typeId = await resolveTypeId("discussions-messages");
  const id = newId();
  await createItem({
    id, type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: {
      threadId, parentMessageId, userId, userName, content,
      createdAt: new Date().toISOString(), editedAt: null, deletedAt: null,
    },
  });
  return readMessage(id);
}

// pg: SELECT thread_id WHERE id=$1 -> { thread_id } or undefined
export async function getMessageThreadId(messageId) {
  const data = await graphql(
    `query($id:ID){ discussionsMessageses(where:{id:{eq:$id}}, limit:1){ threadId{id} } }`, { id: messageId },
  );
  const m = data.discussionsMessageses[0];
  return m ? { thread_id: m.threadId?.id ?? null } : undefined;
}

// ─── Read state + notification subscriptions ─────────────────────────────────

async function findThreadRead(userId, threadId) {
  const data = await graphql(
    `query($u:String,$t:ID){ discussionsThreadReadses(where:{userId:{eq:$u}, threadId:{eq:$t}}, limit:1){ id lastReadAt } }`,
    { u: userId, t: threadId },
  );
  return data.discussionsThreadReadses[0];
}

// pg: INSERT ... ON CONFLICT (user_id,thread_id) DO UPDATE SET last_read_at=EXCLUDED
//     WHERE EXCLUDED.last_read_at > existing.last_read_at (never moves backwards).
export async function upsertThreadRead(userId, threadId, at) {
  const atIso = at instanceof Date ? at.toISOString() : at;
  const existing = await findThreadRead(userId, threadId);
  if (existing) {
    if (new Date(atIso) > new Date(existing.lastReadAt)) {
      await updateObject(existing.id, { userId, threadId, lastReadAt: atIso });
    }
    return;
  }
  const typeId = await resolveTypeId("discussions-thread-reads");
  await createItem({
    type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: { userId, threadId, lastReadAt: atIso },
  });
}

// pg: last_read_at = MAX(message.created_at in thread) or NOW(); unconditional upsert.
export async function markThreadRead(userId, threadId) {
  const data = await graphql(
    `query($t:ID){ discussionsMessageses(where:{threadId:{eq:$t}},
        sort:[{field:createdAt,direction:DESC}], limit:1){ createdAt } }`, { t: threadId },
  );
  const max = data.discussionsMessageses[0]?.createdAt;
  const at = max ? new Date(max).toISOString() : new Date().toISOString();
  const existing = await findThreadRead(userId, threadId);
  if (existing) {
    await updateObject(existing.id, { userId, threadId, lastReadAt: at });
    return;
  }
  const typeId = await resolveTypeId("discussions-thread-reads");
  await createItem({
    type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: { userId, threadId, lastReadAt: at },
  });
}

// pg: INSERT thread_notification_subscriptions ON CONFLICT DO NOTHING
export async function subscribeThreadNotifications(userId, threadId) {
  const data = await graphql(
    `query($u:String,$t:ID){ threadNotificationSubscriptionses(where:{userId:{eq:$u}, threadId:{eq:$t}}, limit:1){ id } }`,
    { u: userId, t: threadId },
  );
  if (data.threadNotificationSubscriptionses.length) return;
  const typeId = await resolveTypeId("thread-notification-subscriptions");
  await createItem({
    type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: { userId, threadId, createdAt: new Date().toISOString() },
  });
}

// pg: DELETE thread_notification_subscriptions WHERE user_id AND thread_id
export async function unsubscribeThreadNotifications(userId, threadId) {
  const data = await graphql(
    `query($u:String,$t:ID){ threadNotificationSubscriptionses(where:{userId:{eq:$u}, threadId:{eq:$t}}, limit:500){ id } }`,
    { u: userId, t: threadId },
  );
  for (const s of data.threadNotificationSubscriptionses) await deleteItem(s.id, { force: true });
}

// pg: threads the user has read-state for, with new messages from others (top-level,
// replies, and parents-of-new-replies), grouped per thread. Reconstructed in JS.
export async function listUnreads(userId) {
  const data = await graphql(
    `query($u:String){
       discussionsThreadses(where:{archivedAt:{isNull:true}}, limit:500){ id name createdAt latestMessageAt }
       discussionsThreadReadses(where:{userId:{eq:$u}}, limit:500){ threadId{id} lastReadAt }
       discussionsMessageses(where:{deletedAt:{isNull:true}}, limit:5000){ ${selectionFor(MESSAGE_STAR)} }
     }`,
    { u: userId },
  );
  const readByThread = new Map(data.discussionsThreadReadses.map((r) => [r.threadId?.id, r.lastReadAt]));
  const msgs = data.discussionsMessageses.map((r) => coerceRow(r, MESSAGE_STAR));
  const byThread = new Map();
  for (const m of msgs) {
    if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, []);
    byThread.get(m.thread_id).push(m);
  }
  const replyCounts = new Map();
  for (const m of msgs) if (m.parent_message_id) replyCounts.set(m.parent_message_id, (replyCounts.get(m.parent_message_id) || 0) + 1);

  const out = [];
  const liveThreads = data.discussionsThreadses
    .filter((t) => readByThread.has(t.id))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); // ORDER BY t.created_at ASC
  for (const t of liveThreads) {
    const lastRead = readByThread.get(t.id);
    if (t.latestMessageAt == null || !(new Date(t.latestMessageAt) > new Date(lastRead))) continue;
    const tmsgs = byThread.get(t.id) || [];
    const newer = (m) => new Date(m.created_at) > new Date(lastRead) && m.user_id !== userId;
    const childrenNewerFromOthers = (pid) =>
      tmsgs.some((r) => r.parent_message_id === pid && new Date(r.created_at) > new Date(lastRead) && r.user_id !== userId);
    const selected = tmsgs.filter((m) => {
      if (m.parent_message_id == null) return newer(m) || childrenNewerFromOthers(m.id);
      return newer(m);
    }).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (!selected.length) continue;
    out.push({
      thread_id: t.id, name: t.name, last_read_at: new Date(lastRead).toISOString(),
      messages: selected.map((m) => ({
        id: m.id, thread_id: m.thread_id, parent_message_id: m.parent_message_id,
        user_id: m.user_id, user_name: m.user_name, content: m.content,
        created_at: m.created_at, edited_at: m.edited_at, deleted_at: m.deleted_at,
        reply_count: replyCounts.get(m.id) || 0,
      })),
    });
  }
  return out;
}

// ─── Reactions ───────────────────────────────────────────────────────────────

// Group reaction rows into { emoji, count, user_ids[], user_names[] }, keyed by an
// extra `message_id` when grouping a whole thread. array_agg order in pg is
// unspecified, so callers that shadow-compare should sort the user arrays.
function groupReactions(rows, withMessageId) {
  const groups = new Map();
  for (const r of rows) {
    const key = withMessageId ? `${r.message_id} ${r.emoji}` : r.emoji;
    if (!groups.has(key)) groups.set(key, { message_id: r.message_id, emoji: r.emoji, user_ids: [], user_names: [] });
    const g = groups.get(key);
    g.user_ids.push(r.user_id);
    g.user_names.push(r.user_name);
  }
  return [...groups.values()].map((g) => {
    const base = { emoji: g.emoji, count: String(g.user_ids.length), user_ids: g.user_ids, user_names: g.user_names };
    return withMessageId ? { message_id: g.message_id, ...base } : base;
  });
}

// pg: reactions for every message in a thread, grouped by (message_id, emoji).
export async function getThreadReactions(threadId) {
  const msgs = await graphql(
    `query($t:ID){ discussionsMessageses(where:{threadId:{eq:$t}}, limit:2000){ id } }`, { t: threadId },
  );
  const ids = new Set(msgs.discussionsMessageses.map((m) => m.id));
  if (!ids.size) return [];
  const data = await graphql(
    `{ discussionsReactionses(limit:5000){ messageId{id} userId userName emoji } }`,
  );
  const rows = data.discussionsReactionses
    .filter((r) => ids.has(r.messageId?.id))
    .map((r) => ({ message_id: r.messageId.id, user_id: r.userId, user_name: r.userName, emoji: r.emoji }));
  return groupReactions(rows, true);
}

// pg: INSERT reaction ON CONFLICT DO NOTHING (unique message_id+user_id+emoji)
export async function addReaction(messageId, userId, userName, emoji) {
  const data = await graphql(
    `query($m:ID,$u:String,$e:String){ discussionsReactionses(where:{messageId:{eq:$m}, userId:{eq:$u}, emoji:{eq:$e}}, limit:1){ id } }`,
    { m: messageId, u: userId, e: emoji },
  );
  if (data.discussionsReactionses.length) return;
  const typeId = await resolveTypeId("discussions-reactions");
  await createItem({
    type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: { messageId, userId, userName: userName ?? "", emoji, createdAt: new Date().toISOString() },
  });
}

// pg: DELETE reaction WHERE message_id AND user_id AND emoji
export async function removeReaction(messageId, userId, emoji) {
  const data = await graphql(
    `query($m:ID,$u:String,$e:String){ discussionsReactionses(where:{messageId:{eq:$m}, userId:{eq:$u}, emoji:{eq:$e}}, limit:500){ id } }`,
    { m: messageId, u: userId, e: emoji },
  );
  for (const r of data.discussionsReactionses) await deleteItem(r.id, { force: true });
}

// pg: reactions for one message, grouped by emoji.
export async function getMessageReactions(messageId) {
  const data = await graphql(
    `query($m:ID){ discussionsReactionses(where:{messageId:{eq:$m}}, limit:2000){ userId userName emoji } }`, { m: messageId },
  );
  const rows = data.discussionsReactionses.map((r) => ({ user_id: r.userId, user_name: r.userName, emoji: r.emoji }));
  return groupReactions(rows, false);
}

// ─── Message files (records only; bytes handled by the native-file section) ──

// pg: dmf JOIN files WHERE dmf.message_id=$1 ORDER BY dmf.created_at (record read;
// the route adds public URLs). Reuses the same join helper as listThreadMessages.
export async function getMessageFiles(messageId) {
  return (await filesByMessage([messageId])).get(messageId) || [];
}

// pg: SELECT name, storage_key, mime_type FROM files WHERE id=$1 -> row or undefined
// (record-only; the route streams bytes from storage_key).
export async function getFileForDownload(fileId) {
  const data = await graphql(
    `query($id:ID){ fileses(where:{id:{eq:$id}}, limit:1){ name storageKey mimeType } }`, { id: fileId },
  );
  const f = data.fileses[0];
  return f ? { name: f.name, storage_key: f.storageKey, mime_type: f.mimeType } : undefined;
}

// pg: INSERT INTO discussions_message_files (message_id, file_id) SELECT $1, id FROM
//     files WHERE id=ANY($2) AND uploaded_by_id=$3 ON CONFLICT DO NOTHING. Only the
//     uploader's own files attach; duplicates skipped.
export async function attachFilesToMessage(messageId, fileIds, uploaderId) {
  if (!fileIds?.length) return;
  const filesData = await graphql(
    `query($ids:[ID!]){ fileses(where:{id:{in:$ids}}, limit:500){ id uploadedById } }`, { ids: fileIds },
  );
  const owned = filesData.fileses.filter((f) => f.uploadedById === uploaderId).map((f) => f.id);
  if (!owned.length) return;
  const existing = await graphql(
    `query($m:ID){ discussionsMessageFileses(where:{messageId:{eq:$m}}, limit:500){ fileId{id} } }`, { m: messageId },
  );
  const already = new Set(existing.discussionsMessageFileses.map((d) => d.fileId?.id));
  const typeId = await resolveTypeId("discussions-message-files");
  for (const fid of owned) {
    if (already.has(fid)) continue;
    await createItem({
      type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
      objectData: { messageId, fileId: fid, showPreview: true, createdAt: new Date().toISOString() },
    });
  }
}

// pg: SELECT id, storage_key, uploaded_by_id FROM files WHERE id=$1 -> row or undefined
export async function getFileForDelete(fileId) {
  const data = await graphql(
    `query($id:ID){ fileses(where:{id:{eq:$id}}, limit:1){ id storageKey uploadedById } }`, { id: fileId },
  );
  const f = data.fileses[0];
  return f ? { id: f.id, storage_key: f.storageKey, uploaded_by_id: f.uploadedById } : undefined;
}

// pg: UPDATE discussions_message_files SET show_preview=$1 FROM discussions_messages m
//     WHERE dmf.id=$2 AND dmf.message_id=m.id AND m.user_id=$3 RETURNING dmf.id
//     -> { id } or undefined (not found / not the message author)
export async function setMessageFilePreview(id, showPreview, userId) {
  const item = await getItem(id);
  const p = item?.payload;
  if (!p) return undefined;
  const messageId = p.messageId?.id ?? p.messageId;
  const msg = await graphql(
    `query($m:ID){ discussionsMessageses(where:{id:{eq:$m}}, limit:1){ userId } }`, { m: messageId },
  );
  if (msg.discussionsMessageses[0]?.userId !== userId) return undefined;
  await updateObject(id, { ...p, messageId, fileId: p.fileId?.id ?? p.fileId, showPreview });
  return { id };
}
