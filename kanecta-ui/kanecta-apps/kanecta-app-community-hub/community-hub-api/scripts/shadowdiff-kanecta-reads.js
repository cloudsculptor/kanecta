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

const SRC = process.env.SRC_PG || "postgres://kanecta:kanecta@localhost:45433/communityhub";
const USER = "111f6452-1c13-4251-b937-4c7696906d50";
const src = new pg.Pool({ connectionString: SRC });

function normVal(v, kind) {
  if (v == null) return null;
  switch (kind) {
    case "money": return Number(v).toFixed(2);
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
};

// A known endorsed user in the source (chain non-root) and the chain root (has no
// endorsement) — for the trust point reads.
const ENDORSED_USER = "7ecbc138-eda1-4b36-a29d-f784c862f5d3";
const ROOT_USER = "aaf6b0da-af38-42aa-853d-bc0da2b377aa"; // the seed endorser (no row where user_id=them)
const SUBS_USER = "111f6452-1c13-4251-b937-4c7696906d50"; // a user with push subscriptions
const SUBS_THREAD = "c5719980-6a25-42a1-a886-783e4713c32c"; // a thread with 2 tns subscribers
const HISTORY_PAGE = "d4c75571-b97f-45fa-8ee7-7cce74822a6d"; // a page with 5 history rows
const DELETED_NOTICE = "d5d456ad-e9ce-4fc5-9bec-7ec11566a138"; // a soft-deleted notice

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

  // ── download / export ────────────────────────────────────────────────────────
  { name: "download.listPublicPagesForExport", kinds: KIND.exportPages,
    sql: "SELECT slug, title, content_json FROM pages WHERE public=TRUE AND deleted_at IS NULL ORDER BY title",
    fn: () => download.listPublicPagesForExport() },
];

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
      else { console.log(`  ✗ ${c.name}  src=${JSON.stringify(rows)} kan=${JSON.stringify(kres)}`); fail++; }
      continue;
    }
    const krows = kres;
    const a = normRows(rows, c.kinds);
    const b = normRows(krows, c.kinds);
    if (a.length === b.length && eq(a, b)) {
      console.log(`  ✓ ${c.name}  (${a.length} rows)`);
      pass++;
    } else {
      console.log(`  ✗ ${c.name}  source=${a.length} kanecta=${b.length}`);
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (!eq(a[i], b[i])) { console.log(`      row ${i} SRC: ${JSON.stringify(a[i])}`); console.log(`      row ${i} KAN: ${JSON.stringify(b[i])}`); break; }
      }
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
