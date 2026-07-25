// Phase B shadow-diff over HTTP: for each community-hub read, run the SOURCE SQL
// (featherston Postgres, :45433) and the KanectaRepository (which reads kanecta-api
// over HTTP against the backfilled copy), then compare with kind-aware
// normalisation (money→Number, date→YYYY-MM-DD, timestamp→epoch) so representation
// differences don't mask real data differences.
//
// Run (with kanecta-api up on :3001 pointed at communityhub_backfill):
//   SRC_PG=postgres://kanecta:kanecta@localhost:45433/communityhub \
//   KANECTA_API_URL=http://127.0.0.1:3001 \
//   node scripts/shadowdiff-kanecta-reads.js
import pg from "pg";
// Mirror db.js: return DATE (oid 1082) as a bare 'YYYY-MM-DD' string, not a
// local-midnight Date (whose toISOString would shift the calendar day across a
// +NN:NN offset). This is exactly what the production pool does, so the comparison
// reflects real response bytes.
pg.types.setTypeParser(1082, (v) => v);
import * as licences from "../repositories/kanecta/licences.js";
import * as notices from "../repositories/kanecta/notices.js";
import * as suggestions from "../repositories/kanecta/suggestions.js";
import * as finances from "../repositories/kanecta/finances.js";
import * as pages from "../repositories/kanecta/pages.js";
import * as discussions from "../repositories/kanecta/discussions.js";
import * as trust from "../repositories/kanecta/trust.js";
import * as push from "../repositories/kanecta/push.js";
import * as download from "../repositories/kanecta/download.js";
import * as disc from "../repositories/kanecta/discussions.js";
import * as events from "../repositories/kanecta/events.js";

const SRC = process.env.SRC_PG || "postgres://kanecta:kanecta@localhost:45433/communityhub";
const USER = "111f6452-1c13-4251-b937-4c7696906d50";
const src = new pg.Pool({ connectionString: SRC });

function normVal(v, kind) {
  if (v == null) return null;
  switch (kind) {
    case "money": return Number(v).toFixed(2);
    case "float": return v == null ? null : Number(v);
    case "int": return Number(v);
    case "bool": return Boolean(v);
    case "date": return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    case "timestamp": return v instanceof Date ? v.getTime() : Date.parse(v);
    case "json": return typeof v === "string" ? JSON.parse(v) : v;
    default: return String(v);
  }
}
// Normalise a row array to a comparable shape using a {col: kind} map.
function normRows(rows, kinds) {
  return rows.map((r) => {
    const o = {};
    for (const k of Object.keys(kinds)) o[k] = normVal(r[k], kinds[k]);
    return o;
  });
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ── deep normalisers for the discussions nested shapes (messages+files, reaction
// maps, unread rollups). Timestamps → epoch; file/user arrays sorted so
// unspecified pg array_agg / json_agg order doesn't mask a real difference.
const epoch = (v) => (v == null ? null : v instanceof Date ? v.getTime() : Date.parse(v));
const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : 1);
function normFile(f) {
  return { id: f.id, file_id: f.file_id, name: f.name, mime_type: f.mime_type,
    size_bytes: Number(f.size_bytes), storage_key: f.storage_key, show_preview: !!f.show_preview };
}
function normMsg(m) {
  const o = { id: m.id, thread_id: m.thread_id, user_id: m.user_id, user_name: m.user_name,
    content: m.content, created_at: epoch(m.created_at), edited_at: epoch(m.edited_at),
    deleted_at: epoch(m.deleted_at), files: (m.files || []).map(normFile).sort(byId) };
  if ("parent_message_id" in m) o.parent_message_id = m.parent_message_id ?? null;
  if (m.reply_count != null) o.reply_count = Number(m.reply_count);
  return o;
}
function normReaction(g) {
  const pairs = (g.user_ids || []).map((u, i) => [u, g.user_names[i]]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const o = { emoji: g.emoji, count: Number(g.count), user_ids: pairs.map((p) => p[0]), user_names: pairs.map((p) => p[1]) };
  if (g.message_id !== undefined) o.message_id = g.message_id;
  return o;
}
function normUnread(u) {
  return { thread_id: u.thread_id, name: u.name, last_read_at: epoch(u.last_read_at),
    messages: (u.messages || []).map(normMsg).sort(byId) };
}
const sortBy = (fn) => (arr) => [...arr].sort((a, b) => (fn(a) < fn(b) ? -1 : fn(a) > fn(b) ? 1 : 0));

const KIND = {
  licences: { id: "id", name: "text", url: "text", public_description: "text", private_details: "text", badge: "text", sort_order: "int" },
  noticesApproved: { id: "id", heading: "text", body: "text", notice_date: "date", submitted_by_name: "text", submitted_at: "timestamp" },
  suggActive: { id: "id", content: "text", submitted_by_name: "text", submitted_at: "timestamp" },
  suggArchived: { id: "id", content: "text", submitted_by_name: "text", submitted_at: "timestamp", archived_at: "timestamp", archived_by_id: "text" },
  expenses: { id: "id", supplier: "text", description: "text", category: "text", frequency: "text", currency: "text", amount: "money", nzd_amount: "money", url: "text", created_at: "timestamp" },
  transactions: { date: "date", description: "text", amount: "money", type: "text", category: "text", reference: "text", created_by_id: "text", created_by_name: "text", created_at: "timestamp", updated_at: "timestamp", sort_order: "int", id: "id", file_count: "int" },
  report: { type: "text", category: "text", total: "money" },
  publicPages: { id: "id", slug: "text", title: "text", created_by_name: "text", created_at: "timestamp", updated_at: "timestamp", public: "bool", licence_id: "id", version: "int", owner_type: "text", owner_id: "id" },
  threads: { id: "id", name: "text", description: "text", created_by_name: "text", created_by_user_id: "text", created_at: "timestamp", has_unread: "bool", is_notifications_enabled: "bool" },
  endorsement: { endorsed_by_id: "text", know_personally: "bool", trusted_by_someone: "bool", resilience_hui: "bool", other_reason: "text" },
  exportPages: { slug: "text", title: "text", content_json: "json" },
  prefs: { category: "text", enabled: "bool" },
  userSubs: { user_id: "text", subscription: "json" },
  pageHistory: { id: "id", action: "text", version: "int", user_name: "text", created_at: "timestamp", licence_name: "text" },
  pageVersion: { version: "int", action: "text", content_json: "json", user_name: "text", created_at: "timestamp", licence_name: "text" },
  eventsUpcoming: { id: "id", title: "text", description: "text", start_date: "date", start_time: "text", end_date: "date", end_time: "text", address: "text", lat: "float", lng: "float", website: "text", phone: "text", email: "text", area: "text", submitted_at: "timestamp" },
  eventsMine: { id: "id", title: "text", start_date: "date", start_time: "text", end_date: "date", status: "text", decline_reason: "text", submitted_at: "timestamp" },
  eventsPending: { id: "id", title: "text", description: "text", start_date: "date", start_time: "text", end_date: "date", end_time: "text", address: "text", lat: "float", lng: "float", website: "text", phone: "text", email: "text", area: "text", organiser_name: "text", organiser_email: "text", organiser_phone: "text", submitted_by_name: "text", submitted_at: "timestamp" },
  eventsDetail: { id: "id", title: "text", description: "text", start_date: "date", start_time: "text", end_date: "date", end_time: "text", address: "text", lat: "float", lng: "float", website: "text", phone: "text", email: "text", area: "text", status: "text", organiser_name: "text", organiser_email: "text", organiser_phone: "text", submitted_by_id: "text", submitted_at: "timestamp" },
};

// A known endorsed user in the source (chain non-root) and the chain root (has no
// endorsement) — for the trust point reads.
const ENDORSED_USER = "7ecbc138-eda1-4b36-a29d-f784c862f5d3";
const ROOT_USER = "aaf6b0da-af38-42aa-853d-bc0da2b377aa"; // the seed endorser (no row where user_id=them)
const SUBS_USER = "111f6452-1c13-4251-b937-4c7696906d50"; // a user with push subscriptions
const SUBS_THREAD = "c5719980-6a25-42a1-a886-783e4713c32c"; // a thread with 2 tns subscribers
const HISTORY_PAGE = "d4c75571-b97f-45fa-8ee7-7cce74822a6d"; // a page with 5 history rows
const DELETED_NOTICE = "d5d456ad-e9ce-4fc5-9bec-7ec11566a138"; // a soft-deleted notice
const MSG_THREAD = "dcba5793-8c51-4054-9140-4fdfe18e3d71"; // thread with 37 top-level messages
const REPLY_PARENT = "b83d43d5-5740-4db9-85a4-81a0e7722870"; // message with 9 replies
const REACT_MSG = "170a06f7-dcee-4d08-aad4-14a347eb5f51"; // message with reactions
const FILE_MSG = "3482fb00-ace5-4e44-bb63-8a017ebd8f63"; // message with a file attachment
const A_FILE = "41666c6d-32eb-46de-a9a0-bf8d3cdc9ffd"; // a live file
const A_THREAD = "e52652d6-11de-41d7-8407-43fe3f33b6bc"; // a live thread ('Constitution')
const READS_USER = "d8197299-34b1-4749-84ef-0ba9148adb62"; // a user with thread-read state
const EVENT_SUBMITTER = "636adc46-c05a-4977-ac3a-af52faded173"; // submitter with 3 events
const AN_EVENT = "1898f5e6-44bc-4432-83ec-cd515631b72b"; // an approved event
const FILE_EVENT = "c3f3a78e-1a36-4e54-af42-6607cb26c75a"; // event with hero + gallery files
const EVENT_FILE_ID = "2e9a4092-2b60-431a-9928-a5b86c6f2260"; // a gallery file on FILE_EVENT

const CASES = [
  { name: "licences.listLicences", kinds: KIND.licences,
    sql: "SELECT id,name,url,public_description,private_details,badge,sort_order FROM licences ORDER BY sort_order",
    fn: () => licences.listLicences() },
  { name: "notices.listApprovedNotices", kinds: KIND.noticesApproved,
    sql: "SELECT id,heading,body,notice_date,submitted_by_name,submitted_at FROM notices WHERE status='approved' AND deleted_at IS NULL ORDER BY submitted_at DESC",
    fn: () => notices.listApprovedNotices() },
  { name: "suggestions.listActiveSuggestions", kinds: KIND.suggActive,
    sql: "SELECT id,content,submitted_by_name,submitted_at FROM suggestions WHERE archived_at IS NULL ORDER BY submitted_at DESC",
    fn: () => suggestions.listActiveSuggestions() },
  { name: "suggestions.listArchivedSuggestions", kinds: KIND.suggArchived,
    sql: "SELECT id,content,submitted_by_name,submitted_at,archived_at,archived_by_id FROM suggestions WHERE archived_at IS NOT NULL ORDER BY archived_at DESC",
    fn: () => suggestions.listArchivedSuggestions() },
  { name: "finances.listExpenses", kinds: KIND.expenses,
    sql: "SELECT * FROM finances_expenses ORDER BY frequency, supplier, description",
    fn: () => finances.listExpenses() },
  { name: "finances.listTransactions", kinds: KIND.transactions,
    sql: `SELECT t.*, COUNT(tf.file_id)::int AS file_count FROM finances_transactions t
          LEFT JOIN finances_transaction_files tf ON tf.transaction_id=t.id
          GROUP BY t.id,t.date,t.description,t.amount,t.type,t.category,t.reference,t.sort_order,t.created_by_id,t.created_by_name,t.created_at,t.updated_at
          ORDER BY t.date ASC, t.sort_order ASC, t.id ASC`,
    fn: () => finances.listTransactions() },
  { name: "finances.getReport", kinds: KIND.report,
    sql: "SELECT type,category,SUM(amount)::NUMERIC(10,2) AS total FROM finances_transactions GROUP BY type,category ORDER BY type,category",
    fn: () => finances.getReport() },
  { name: "pages.listPublicPages", kinds: KIND.publicPages,
    sql: "SELECT p.id,p.slug,p.title,p.created_by_name,p.created_at,p.updated_at,p.public,p.licence_id,p.version,p.owner_type,p.owner_id FROM pages p WHERE p.public=TRUE AND p.deleted_at IS NULL ORDER BY p.updated_at DESC",
    fn: () => pages.listPublicPages() },
  { name: "discussions.listThreads(user)", kinds: KIND.threads,
    sql: `SELECT t.id,t.name,t.description,t.created_by_name,t.created_by_user_id,t.created_at,
            CASE WHEN t.latest_message_at IS NOT NULL AND (r.last_read_at IS NULL OR t.latest_message_at>r.last_read_at) THEN true ELSE false END AS has_unread,
            CASE WHEN tns.user_id IS NOT NULL THEN true ELSE false END AS is_notifications_enabled
          FROM discussions_threads t
          LEFT JOIN discussions_thread_reads r ON r.thread_id=t.id AND r.user_id=$1
          LEFT JOIN thread_notification_subscriptions tns ON tns.thread_id=t.id AND tns.user_id=$1
          WHERE t.archived_at IS NULL ORDER BY t.sort_order ASC NULLS LAST, t.name ASC`,
    params: [USER], fn: () => discussions.listThreads(USER) },

  // ── trust ──────────────────────────────────────────────────────────────────
  { name: "trust.getEndorsementFor(endorsed)",
    sql: "SELECT endorsed_by_id,know_personally,trusted_by_someone,resilience_hui,other_reason FROM trust WHERE user_id=$1 ORDER BY created_at ASC LIMIT 1",
    params: [ENDORSED_USER], fn: () => trust.getEndorsementFor(ENDORSED_USER),
    check: (rows, kres) => eq(normRows([rows[0]], KIND.endorsement)[0], normRows([kres], KIND.endorsement)[0]) },
  { name: "trust.isEndorsed(endorsed→true)",
    sql: "SELECT id FROM trust WHERE user_id=$1 LIMIT 1", params: [ENDORSED_USER],
    fn: () => trust.isEndorsed(ENDORSED_USER), check: (rows, kres) => kres === (rows.length > 0) && kres === true },
  { name: "trust.isEndorsed(root→false)",
    sql: "SELECT id FROM trust WHERE user_id=$1 LIMIT 1", params: [ROOT_USER],
    fn: () => trust.isEndorsed(ROOT_USER), check: (rows, kres) => kres === (rows.length > 0) && kres === false },

  // ── push / notifications ─────────────────────────────────────────────────────
  { name: "push.getUserSubscriptions",
    sql: "SELECT id, subscription FROM push_subscriptions WHERE user_id=$1", params: [SUBS_USER],
    fn: () => push.getUserSubscriptions(SUBS_USER),
    // Both return { id, subscription }. id is synthetic under Kanecta (source
    // bigint doesn't round-trip), so compare on subscription only, order-
    // independent (neither query orders rows).
    check: (rows, kres) => {
      const key = (r) => JSON.stringify(normVal(r.subscription, "json"));
      const a = rows.map(key).sort(); const b = kres.map(key).sort();
      return a.length === b.length && eq(a, b);
    } },
  { name: "push.getThreadSubscribers",
    sql: `SELECT DISTINCT ps.user_id, ps.id, ps.subscription
          FROM thread_notification_subscriptions tns
          JOIN push_subscriptions ps ON ps.user_id = tns.user_id
          WHERE tns.thread_id=$1 AND tns.user_id != $2`,
    params: [SUBS_THREAD, ROOT_USER], fn: () => push.getThreadSubscribers(SUBS_THREAD, ROOT_USER),
    // Compare on user_id + subscription (id synthetic), order-independent.
    check: (rows, kres) => {
      const key = (r) => normVal(r.user_id, "text") + "|" + JSON.stringify(normVal(r.subscription, "json"));
      const a = rows.map(key).sort(); const b = kres.map(key).sort();
      return a.length === b.length && eq(a, b);
    } },
  { name: "push.getPreferences(empty)",
    sql: "SELECT category, enabled FROM notification_preferences WHERE user_id=$1", params: [USER],
    fn: () => push.getPreferences(USER),
    check: (rows, kres) => eq(normRows(rows, KIND.prefs), normRows(kres, KIND.prefs)) },

  // ── pages history / notices owner ────────────────────────────────────────────
  { name: "pages.getPageHistory", kinds: KIND.pageHistory,
    sql: `SELECT ph.id, ph.action, ph.version, ph.user_name, ph.created_at, l.name AS licence_name
          FROM page_history ph LEFT JOIN licences l ON l.id=ph.licence_id
          WHERE ph.page_id=$1 ORDER BY ph.created_at DESC`,
    params: [HISTORY_PAGE], fn: () => pages.getPageHistory(HISTORY_PAGE) },
  { name: "pages.getPageVersion",
    sql: `SELECT ph.version, ph.action, ph.content_json, ph.user_name, ph.created_at, l.name AS licence_name
          FROM page_history ph LEFT JOIN licences l ON l.id=ph.licence_id
          WHERE ph.page_id=$1 AND ph.version=$2`,
    params: [HISTORY_PAGE, 1], fn: () => pages.getPageVersion(HISTORY_PAGE, 1),
    check: (rows, kres) => eq(normRows([rows[0]], KIND.pageVersion)[0], normRows([kres], KIND.pageVersion)[0]) },
  { name: "notices.getNoticeOwner(deleted→null)",
    sql: "SELECT submitted_by_id FROM notices WHERE id=$1 AND deleted_at IS NULL", params: [DELETED_NOTICE],
    fn: () => notices.getNoticeOwner(DELETED_NOTICE),
    check: (rows, kres) => kres === (rows[0]?.submitted_by_id ?? null) && kres === null },

  // ── discussions: messages / replies / reactions / unreads ────────────────────
  { name: "discussions.listThreadMessages",
    sql: `SELECT m.id, m.thread_id, m.user_id, m.user_name, m.content, m.created_at, m.edited_at, m.deleted_at,
            (SELECT COUNT(*) FROM discussions_messages r WHERE r.parent_message_id = m.id)::int AS reply_count,
            COALESCE((SELECT json_agg(json_build_object('id',dmf.id,'file_id',f.id,'name',f.name,'mime_type',f.mime_type,
              'size_bytes',f.size_bytes,'storage_key',f.storage_key,'show_preview',dmf.show_preview) ORDER BY dmf.created_at)
              FROM discussions_message_files dmf JOIN files f ON f.id=dmf.file_id WHERE dmf.message_id=m.id),'[]'::json) AS files
          FROM discussions_messages m WHERE thread_id=$1 AND parent_message_id IS NULL ORDER BY created_at ASC LIMIT $2`,
    params: [MSG_THREAD, 100], fn: () => disc.listThreadMessages(MSG_THREAD, 100),
    check: (rows, kres) => {
      const sk = sortBy((m) => `${epoch(m.created_at)}|${m.id}`);
      return eq(sk(rows).map(normMsg), sk(kres).map(normMsg));
    } },
  { name: "discussions.listReplies",
    sql: `SELECT m.id, m.thread_id, m.parent_message_id, m.user_id, m.user_name, m.content, m.created_at, m.edited_at, m.deleted_at,
            COALESCE((SELECT json_agg(json_build_object('id',dmf.id,'file_id',f.id,'name',f.name,'mime_type',f.mime_type,
              'size_bytes',f.size_bytes,'storage_key',f.storage_key,'show_preview',dmf.show_preview) ORDER BY dmf.created_at)
              FROM discussions_message_files dmf JOIN files f ON f.id=dmf.file_id WHERE dmf.message_id=m.id),'[]'::json) AS files
          FROM discussions_messages m WHERE parent_message_id=$1 ORDER BY created_at ASC`,
    params: [REPLY_PARENT], fn: () => disc.listReplies(REPLY_PARENT),
    check: (rows, kres) => {
      const sk = sortBy((m) => `${epoch(m.created_at)}|${m.id}`);
      return eq(sk(rows).map(normMsg), sk(kres).map(normMsg));
    } },
  { name: "discussions.getThreadReactions",
    sql: `SELECT dr.message_id, dr.emoji, COUNT(*) AS count, array_agg(dr.user_id) AS user_ids, array_agg(dr.user_name) AS user_names
          FROM discussions_reactions dr JOIN discussions_messages dm ON dm.id=dr.message_id
          WHERE dm.thread_id=$1 GROUP BY dr.message_id, dr.emoji`,
    params: [MSG_THREAD], fn: () => disc.getThreadReactions(MSG_THREAD),
    check: (rows, kres) => {
      const sk = sortBy((g) => `${g.message_id}|${g.emoji}`);
      return eq(sk(rows).map(normReaction), sk(kres).map(normReaction));
    } },
  { name: "discussions.getMessageReactions",
    sql: `SELECT emoji, COUNT(*) AS count, array_agg(user_id) AS user_ids, array_agg(user_name) AS user_names
          FROM discussions_reactions WHERE message_id=$1 GROUP BY emoji`,
    params: [REACT_MSG], fn: () => disc.getMessageReactions(REACT_MSG),
    check: (rows, kres) => {
      const sk = sortBy((g) => g.emoji);
      return eq(sk(rows).map(normReaction), sk(kres).map(normReaction));
    } },
  { name: "discussions.getParentMessage",
    sql: "SELECT id, thread_id FROM discussions_messages WHERE id=$1 AND parent_message_id IS NULL",
    params: [REPLY_PARENT], fn: () => disc.getParentMessage(REPLY_PARENT),
    check: (rows, kres) => eq({ id: rows[0]?.id, thread_id: rows[0]?.thread_id }, { id: kres?.id, thread_id: kres?.thread_id }) },
  { name: "discussions.getMessageThreadId",
    sql: "SELECT thread_id FROM discussions_messages WHERE id=$1", params: [REACT_MSG],
    fn: () => disc.getMessageThreadId(REACT_MSG),
    check: (rows, kres) => (rows[0]?.thread_id ?? null) === (kres?.thread_id ?? null) },
  { name: "discussions.getThreadName",
    sql: "SELECT name FROM discussions_threads WHERE id=$1", params: [A_THREAD],
    fn: () => disc.getThreadName(A_THREAD), check: (rows, kres) => (rows[0]?.name ?? null) === (kres?.name ?? null) },
  { name: "discussions.getThreadForArchive",
    sql: "SELECT created_by_user_id, created_by_name FROM discussions_threads WHERE id=$1 AND archived_at IS NULL",
    params: [A_THREAD], fn: () => disc.getThreadForArchive(A_THREAD),
    check: (rows, kres) => eq(rows[0] ? { created_by_user_id: rows[0].created_by_user_id, created_by_name: rows[0].created_by_name } : undefined, kres) },
  { name: "discussions.findDuplicateThreads",
    sql: "SELECT id, name, description FROM discussions_threads WHERE archived_at IS NULL AND LOWER(REGEXP_REPLACE(name,'\\s+','','g'))=$1",
    params: ["constitution"], fn: () => disc.findDuplicateThreads("constitution"),
    check: (rows, kres) => eq(sortBy((r) => r.id)(rows).map((r) => ({ id: r.id, name: r.name, description: r.description })), sortBy((r) => r.id)(kres)) },
  { name: "discussions.getFileForDelete",
    sql: "SELECT id, storage_key, uploaded_by_id FROM files WHERE id=$1", params: [A_FILE],
    fn: () => disc.getFileForDelete(A_FILE),
    check: (rows, kres) => eq(rows[0] ? { id: rows[0].id, storage_key: rows[0].storage_key, uploaded_by_id: rows[0].uploaded_by_id } : undefined, kres) },
  { name: "discussions.listUnreads",
    sql: `SELECT t.id AS thread_id, t.name, rd.last_read_at,
            COALESCE(json_agg(json_build_object('id',m.id,'thread_id',m.thread_id,'parent_message_id',m.parent_message_id,
              'user_id',m.user_id,'user_name',m.user_name,'content',m.content,'created_at',m.created_at,'edited_at',m.edited_at,
              'deleted_at',m.deleted_at,'reply_count',(SELECT COUNT(*)::int FROM discussions_messages rc WHERE rc.parent_message_id=m.id))
              ORDER BY m.created_at ASC) FILTER (WHERE m.id IS NOT NULL),'[]'::json) AS messages
          FROM discussions_threads t JOIN discussions_thread_reads rd ON rd.thread_id=t.id AND rd.user_id=$1
          LEFT JOIN discussions_messages m ON m.thread_id=t.id AND m.deleted_at IS NULL AND (
            (m.parent_message_id IS NULL AND m.created_at>rd.last_read_at AND m.user_id!=$1)
            OR (m.parent_message_id IS NOT NULL AND m.created_at>rd.last_read_at AND m.user_id!=$1)
            OR (m.parent_message_id IS NULL AND EXISTS (SELECT 1 FROM discussions_messages nr WHERE nr.parent_message_id=m.id AND nr.created_at>rd.last_read_at AND nr.deleted_at IS NULL AND nr.user_id!=$1)))
          WHERE t.archived_at IS NULL AND t.latest_message_at IS NOT NULL AND t.latest_message_at>rd.last_read_at
          GROUP BY t.id, t.name, rd.last_read_at ORDER BY t.created_at ASC`,
    params: [READS_USER], fn: () => disc.listUnreads(READS_USER),
    check: (rows, kres) => eq(sortBy((u) => u.thread_id)(rows).map(normUnread), sortBy((u) => u.thread_id)(kres).map(normUnread)) },

  // ── events ───────────────────────────────────────────────────────────────────
  { name: "events.listUpcomingApprovedEvents", kinds: KIND.eventsUpcoming,
    sql: `SELECT id,title,description,start_date,start_time,end_date,end_time,address,lat,lng,website,phone,email,area,submitted_at
          FROM events WHERE status='approved' AND deleted_at IS NULL AND COALESCE(end_date,start_date)>=CURRENT_DATE ORDER BY start_date ASC`,
    fn: () => events.listUpcomingApprovedEvents(null) },
  { name: "events.listMyEvents", kinds: KIND.eventsMine,
    sql: `SELECT id,title,start_date,start_time,end_date,status,decline_reason,submitted_at
          FROM events WHERE submitted_by_id=$1 AND deleted_at IS NULL ORDER BY submitted_at DESC`,
    params: [EVENT_SUBMITTER], fn: () => events.listMyEvents(null, EVENT_SUBMITTER) },
  { name: "events.listPendingEvents", kinds: KIND.eventsPending,
    sql: `SELECT id,title,description,start_date,start_time,end_date,end_time,address,lat,lng,website,phone,email,area,organiser_name,organiser_email,organiser_phone,submitted_by_name,submitted_at
          FROM events WHERE status='pending' AND deleted_at IS NULL ORDER BY submitted_at ASC`,
    fn: () => events.listPendingEvents(null) },
  { name: "events.getEventDetail",
    sql: `SELECT id,title,description,start_date,start_time,end_date,end_time,address,lat,lng,website,phone,email,area,status,organiser_name,organiser_email,organiser_phone,submitted_by_id,submitted_at
          FROM events WHERE id=$1 AND deleted_at IS NULL`,
    params: [AN_EVENT], fn: () => events.getEventDetail(null, AN_EVENT),
    check: (rows, kres) => eq(normRows([rows[0]], KIND.eventsDetail)[0], normRows([kres], KIND.eventsDetail)[0]) },
  { name: "events.getEventForDelete",
    sql: "SELECT submitted_by_id, deleted_at FROM events WHERE id=$1", params: [AN_EVENT],
    fn: () => events.getEventForDelete(null, AN_EVENT),
    check: (rows, kres) => eq({ submitted_by_id: rows[0]?.submitted_by_id, deleted_at: rows[0]?.deleted_at ? epoch(rows[0].deleted_at) : null },
      { submitted_by_id: kres?.submitted_by_id, deleted_at: kres?.deleted_at ? epoch(kres.deleted_at) : null }) },
  { name: "events.getEventOwnerStatus",
    sql: "SELECT submitted_by_id, status FROM events WHERE id=$1", params: [AN_EVENT],
    fn: () => events.getEventOwnerStatus(null, AN_EVENT),
    check: (rows, kres) => eq({ submitted_by_id: rows[0]?.submitted_by_id, status: rows[0]?.status }, kres) },
  { name: "events.countGalleryImages",
    sql: "SELECT COUNT(*)::int AS c FROM event_files WHERE event_id=$1 AND role='gallery'", params: [FILE_EVENT],
    fn: () => events.countGalleryImages(null, FILE_EVENT), check: (rows, kres) => Number(rows[0].c) === kres },
  { name: "events.getEventFile",
    sql: "SELECT ef.file_id, f.storage_key FROM event_files ef JOIN files f ON f.id=ef.file_id WHERE ef.event_id=$1 AND ef.file_id=$2",
    params: [FILE_EVENT, EVENT_FILE_ID], fn: () => events.getEventFile(null, FILE_EVENT, EVENT_FILE_ID),
    check: (rows, kres) => eq(rows[0] ? { file_id: rows[0].file_id, storage_key: rows[0].storage_key } : undefined, kres) },

  // ── file records (join tables + files metadata; no bytes) ────────────────────
  { name: "discussions.getMessageFiles",
    sql: `SELECT dmf.id, f.id AS file_id, f.name, f.mime_type, f.size_bytes, f.storage_key, dmf.show_preview
          FROM discussions_message_files dmf JOIN files f ON f.id=dmf.file_id WHERE dmf.message_id=$1 ORDER BY dmf.created_at`,
    params: [FILE_MSG], fn: () => disc.getMessageFiles(FILE_MSG),
    check: (rows, kres) => eq(rows.map(normFile).sort(byId), kres.map(normFile).sort(byId)) },
  { name: "discussions.getFileForDownload",
    sql: "SELECT name, storage_key, mime_type FROM files WHERE id=$1", params: [A_FILE],
    fn: () => disc.getFileForDownload(A_FILE),
    check: (rows, kres) => eq(rows[0] ? { name: rows[0].name, storage_key: rows[0].storage_key, mime_type: rows[0].mime_type } : undefined, kres) },
  { name: "download.getFilesByIds",
    sql: "SELECT id, name, storage_key FROM files WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL", params: [[A_FILE, EVENT_FILE_ID]],
    fn: () => download.getFilesByIds([A_FILE, EVENT_FILE_ID]),
    check: (rows, kres) => eq(sortBy((r) => r.id)(rows).map((r) => ({ id: r.id, name: r.name, storage_key: r.storage_key })), sortBy((r) => r.id)(kres)) },
  { name: "events.getEventFiles",
    sql: `SELECT ef.event_id, ef.role, ef.position, f.id AS file_id, f.storage_key
          FROM event_files ef JOIN files f ON f.id=ef.file_id WHERE ef.event_id=ANY($1::uuid[]) AND f.deleted_at IS NULL
          ORDER BY ef.event_id, ef.role DESC, ef.position`,
    params: [[FILE_EVENT]], fn: () => events.getEventFiles(null, [FILE_EVENT]),
    check: (rows, kres) => {
      const n = (r) => ({ event_id: r.event_id, role: r.role, position: Number(r.position), file_id: r.file_id, storage_key: r.storage_key });
      const sk = sortBy((r) => `${r.event_id}|${r.role}|${r.position}|${r.file_id}`);
      return eq(sk(rows).map(n), sk(kres).map(n));
    } },
  { name: "events.getHeroImage",
    sql: "SELECT ef.file_id, f.storage_key FROM event_files ef JOIN files f ON f.id=ef.file_id WHERE ef.event_id=$1 AND ef.role='hero'",
    params: [FILE_EVENT], fn: () => events.getHeroImage(null, FILE_EVENT),
    check: (rows, kres) => eq(rows[0] ? { file_id: rows[0].file_id, storage_key: rows[0].storage_key } : undefined, kres) },

  // ── download / export ────────────────────────────────────────────────────────
  { name: "download.listPublicPagesForExport", kinds: KIND.exportPages,
    sql: "SELECT slug, title, content_json FROM pages WHERE public=TRUE AND deleted_at IS NULL ORDER BY title",
    fn: () => download.listPublicPagesForExport() },
];

// Deep field-level diff: every leaf path where the two structures differ.
// Failing cases used to dump both payloads whole — megabytes for the
// file-bearing cases, where the ONLY acceptable diff is storage_key. This
// makes the pass-state check ("storage_key-only") readable at a glance.
function diffLeaves(a, b, path = "", out = []) {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push({ path: `${path}.length`, src: a.length, kan: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffLeaves(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !(a instanceof Date) && !(b instanceof Date)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffLeaves(a[k], b[k], path ? `${path}.${k}` : k, out);
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, src: a, kan: b });
  return out;
}
const short = (v) => { const s = JSON.stringify(v); return s && s.length > 80 ? s.slice(0, 77) + "..." : s; };
function reportDiff(name, a, b, extra = "") {
  const byField = new Map();
  for (const d of diffLeaves(a, b)) {
    const f = d.path.replace(/\[\d+\]/g, "[]");
    if (!byField.has(f)) byField.set(f, []);
    byField.get(f).push(d);
  }
  const fields = [...byField.entries()].map(([f, ds]) => `${f} (x${ds.length})`).join(", ");
  console.log(`  ✗ ${name}${extra}  differing fields: ${fields || "(none at leaf level)"}`);
  for (const [, ds] of byField) {
    for (const d of ds.slice(0, 2)) console.log(`      ${d.path}: src=${short(d.src)} kan=${short(d.kan)}`);
  }
}

let pass = 0, fail = 0;
for (const c of CASES) {
  try {
    const { rows } = await src.query(c.sql, c.params || []);
    const kres = await c.fn();
    // `check` cases compare a scalar/single-object result themselves (returns a
    // bool); row-array cases fall through to the kind-aware normalised compare.
    if (c.check) {
      const okc = c.check(rows, kres);
      if (okc) { console.log(`  ✓ ${c.name}`); pass++; }
      else { reportDiff(c.name, rows, kres); fail++; }
      continue;
    }
    const krows = kres;
    const a = normRows(rows, c.kinds);
    const b = normRows(krows, c.kinds);
    if (a.length === b.length && eq(a, b)) {
      console.log(`  ✓ ${c.name}  (${a.length} rows)`);
      pass++;
    } else {
      reportDiff(c.name, a, b, `  source=${a.length} kanecta=${b.length}`);
      fail++;
    }
  } catch (e) {
    console.log(`  ✗ ${c.name}  ERROR ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass}/${pass + fail} read cases reproduce over HTTP.`);
await src.end();
process.exit(fail ? 1 : 0);
