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
};

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
];

let pass = 0, fail = 0;
for (const c of CASES) {
  try {
    const { rows } = await src.query(c.sql, c.params || []);
    const krows = await c.fn();
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
