// Phase B shadow-diff: prove a Kanecta read reproduces the featherston-api pg read
// byte-for-byte (shape included). For each featherston repository read we run the
// original SQL against the source (:45433) and reconstruct the SAME result through
// the Kanecta read path (adapter query + object payloads, camelCase→snake_case
// mapping, column subsetting, filtering, ordering) against the backfilled schema,
// then deep-diff. This is the methodology the real KanectaRepository read methods
// will follow — the mapping proven here is what they encode.
//
//   tsx kanecta-core/kanecta-converter/scripts/shadowdiff-community-hub.ts [--schema=NAME]
import pg from 'pg';
import { PostgresAdapter } from '../../kanecta-storage-adapters/kanecta-postgres/src/adapter.ts';

const SOURCE = { host: 'localhost', port: 45433, database: 'communityhub', user: 'kanecta', password: 'kanecta' };
const TARGET_CONN = process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const argSchema = process.argv.find((a) => a.startsWith('--schema='));
const SCHEMA = argSchema ? argSchema.split('=')[1] : 'communityhub_backfill';

const snake = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[A-Z]/g, (m) => m.toLowerCase());

// Canonical value form so pure REPRESENTATION differences don't read as data diffs.
// Two are expected between the pg path and the Kanecta read path, and are exactly the
// type-coercions the real KanectaRepository read methods must replicate to match
// featherston byte-for-byte:
//   • timestamps — pg returns Date (→ UTC "…Z"); the Kanecta object payload carries a
//     TZ-offset string ("…+12:00"). Same instant, so canonicalise to epoch ms.
//   • NUMERIC — pg returns it as a string ("45.42"); the typed object field is a number
//     (45.42). Same value, so canonicalise numeric strings/numbers together.
// `norm` (used for sort keys) keeps timestamps comparable; `canon` (used for the diff)
// collapses both representations.
const norm = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);
function canon(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return `T${v.getTime()}`;
  if (typeof v === 'number') return `N${v}`;
  if (typeof v === 'string') {
    if (/^\d{4}-\d\d-\d\dT/.test(v)) { const t = Date.parse(v); if (!Number.isNaN(t)) return `T${t}`; }
    if (/^-?\d+(\.\d+)?$/.test(v)) return `N${Number(v)}`;
    return `S${v}`;
  }
  return JSON.stringify(v);
}
const rowKey = (r: Record<string, unknown>, cols: string[]) => JSON.stringify(cols.map((c) => canon(r[c])));

// A featherston read to reproduce: the original SQL (pg path) + how to rebuild it
// from Kanecta items (kanecta path).
interface ReadSpec {
  name: string;
  typeValue: string;                                   // Kanecta type to query
  cols: string[];                                       // featherston SELECT list (snake_case)
  sql: string;                                          // featherston SQL (pg path)
  keep: (o: Record<string, any>) => boolean;            // WHERE, over camelCase object fields
  order: (a: Record<string, any>, b: Record<string, any>) => number; // ORDER BY (snake_case rows)
}

const READS: ReadSpec[] = [
  {
    name: 'licences.listLicences',
    typeValue: 'licences',
    cols: ['id', 'name', 'url', 'public_description', 'private_details', 'badge', 'sort_order'],
    sql: 'SELECT id, name, url, public_description, private_details, badge, sort_order FROM licences ORDER BY sort_order',
    keep: () => true,
    order: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  },
  {
    // All 8 notices are soft-deleted in the snapshot → both sides 0 (proves the
    // deleted_at filter). Kept as a filter-correctness check.
    name: 'notices.listApprovedNotices',
    typeValue: 'notices',
    cols: ['id', 'heading', 'body', 'notice_date', 'submitted_by_name', 'submitted_at'],
    sql: `SELECT id, heading, body, notice_date, submitted_by_name, submitted_at FROM notices
          WHERE status = 'approved' AND deleted_at IS NULL ORDER BY submitted_at DESC`,
    keep: (o) => o.status === 'approved' && o.deletedAt == null,
    order: (a, b) => String(norm(b.submitted_at)).localeCompare(String(norm(a.submitted_at))),
  },
  {
    name: 'suggestions.listArchivedSuggestions',
    typeValue: 'suggestions',
    cols: ['id', 'content', 'submitted_by_name', 'submitted_at', 'archived_at', 'archived_by_id'],
    sql: `SELECT id, content, submitted_by_name, submitted_at, archived_at, archived_by_id FROM suggestions
          WHERE archived_at IS NOT NULL ORDER BY archived_at DESC`,
    keep: (o) => o.archivedAt != null,
    order: (a, b) => String(norm(b.archived_at)).localeCompare(String(norm(a.archived_at))),
  },
  {
    name: 'finances.listExpenses',
    typeValue: 'finances-expenses',
    cols: ['id', 'supplier', 'description', 'category', 'frequency', 'currency', 'amount', 'nzd_amount', 'url', 'created_at'],
    sql: `SELECT id, supplier, description, category, frequency, currency, amount, nzd_amount, url, created_at
          FROM finances_expenses ORDER BY frequency, supplier, description`,
    keep: () => true,
    order: (a, b) => String(a.frequency ?? '').localeCompare(String(b.frequency ?? ''))
      || String(a.supplier ?? '').localeCompare(String(b.supplier ?? ''))
      || String(a.description ?? '').localeCompare(String(b.description ?? '')),
  },
];

async function main() {
  const source = new pg.Pool(SOURCE);
  const pool = new pg.Pool({ connectionString: TARGET_CONN, options: `-c search_path="${SCHEMA}"` });
  const ds = await PostgresAdapter.open(pool);

  let fail = 0;
  for (const spec of READS) {
    // pg path — the featherston result, exactly.
    const { rows: pgRows } = await source.query(spec.sql);

    // kanecta path — reconstruct from Kanecta items.
    const res: any = await ds.query({ type: spec.typeValue });
    const items = Array.isArray(res) ? res : res.items ?? [];
    const kRows: Record<string, any>[] = [];
    for (const it of items) {
      const obj: any = (await ds.readObjectJson(it.id, it.typeId)) ?? {};
      if (!spec.keep(obj)) continue;
      const row: Record<string, any> = { id: it.id };
      for (const [k, v] of Object.entries(obj)) row[snake(k)] = v;
      const picked: Record<string, any> = {};
      for (const c of spec.cols) picked[c] = row[c] ?? null;
      kRows.push(picked);
    }
    kRows.sort(spec.order);

    // diff — count, then row-by-row on the projected columns.
    const pgKeys = pgRows.map((r) => rowKey(r, spec.cols));
    const kKeys = kRows.map((r) => rowKey(r, spec.cols));
    let ok = pgKeys.length === kKeys.length;
    let firstDiff = '';
    for (let i = 0; ok && i < pgKeys.length; i++) {
      if (pgKeys[i] !== kKeys[i]) { ok = false; firstDiff = `\n      pg[${i}]=${pgKeys[i]}\n      k [${i}]=${kKeys[i]}`; }
    }
    if (!ok) fail++;
    console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${spec.name.padEnd(30)} pg=${pgRows.length} kanecta=${kRows.length}${ok ? '' : firstDiff}`);
  }

  // ── Aggregation reads (G2 pushdown over the obj_ projection table) ────────────
  // The swap plan flags aggregations as the key read uncertainty (G2 SQL pushdown vs
  // JS reconstruction). Prove the G2 path: run the featherston GROUP BY on the source
  // AND the identical aggregation on obj_<typeId>, then diff. The obj_ columns are
  // already snake_case, so the report SQL is the same modulo the table name.
  console.log('\nAggregation reads (G2 pushdown over obj_<typeId>):');
  const objTableFor = async (typeValue: string): Promise<string | null> => {
    const { rows } = await pool.query(`SELECT id FROM items WHERE type='type' AND value=$1`, [typeValue]);
    return rows[0] ? `obj_${rows[0].id.replace(/-/g, '_')}` : null;
  };
  const AGG = [{
    name: 'finances.getReport',
    typeValue: 'finances-transactions',
    cols: ['type', 'category', 'total'],
    srcSql: `SELECT type, category, SUM(amount)::NUMERIC(10,2) AS total FROM finances_transactions
             GROUP BY type, category ORDER BY type, category`,
    objSql: (tbl: string) => `SELECT type, category, SUM(amount)::NUMERIC(10,2) AS total FROM "${tbl}"
             GROUP BY type, category ORDER BY type, category`,
  }];
  for (const a of AGG) {
    const tbl = await objTableFor(a.typeValue);
    const { rows: pgRows } = await source.query(a.srcSql);
    const { rows: kRows } = tbl ? await pool.query(a.objSql(tbl)) : { rows: [] };
    const pgKeys = pgRows.map((r) => rowKey(r, a.cols));
    const kKeys = kRows.map((r: any) => rowKey(r, a.cols));
    const ok = pgKeys.length === kKeys.length && pgKeys.every((k, i) => k === kKeys[i]);
    if (!ok) fail++;
    console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${a.name.padEnd(30)} pg=${pgRows.length} kanecta=${kRows.length}${ok ? '' : `\n      pg=${JSON.stringify(pgKeys)}\n      k =${JSON.stringify(kKeys)}`}`);
  }

  // ── Per-user join read — discussions.listThreads (the harder residue) ─────────
  // Reconstructs has_unread / is_notifications_enabled for a given user by joining
  // three Kanecta types in JS (threads + the user's thread-reads + subscriptions),
  // computing the booleans, and applying NULLS-LAST ordering — the shape featherston
  // builds with two LEFT JOINs + CASE expressions.
  console.log('\nPer-user join read (discussions.listThreads):');
  const USER = '111f6452-1c13-4251-b937-4c7696906d50';
  {
    const cols = ['id', 'name', 'description', 'created_by_name', 'created_by_user_id', 'created_at', 'has_unread', 'is_notifications_enabled'];
    const { rows: pgRows } = await source.query(
      `SELECT t.id, t.name, t.description, t.created_by_name, t.created_by_user_id, t.created_at,
              CASE WHEN t.latest_message_at IS NOT NULL
                        AND (r.last_read_at IS NULL OR t.latest_message_at > r.last_read_at)
                   THEN true ELSE false END AS has_unread,
              CASE WHEN tns.user_id IS NOT NULL THEN true ELSE false END AS is_notifications_enabled
       FROM discussions_threads t
       LEFT JOIN discussions_thread_reads r ON r.thread_id = t.id AND r.user_id = $1
       LEFT JOIN thread_notification_subscriptions tns ON tns.thread_id = t.id AND tns.user_id = $1
       WHERE t.archived_at IS NULL
       ORDER BY t.sort_order ASC NULLS LAST, t.name ASC`, [USER]);

    // Kanecta path: build the user's read-map and subscription-set, then per thread.
    const objectsOf = async (typeValue: string) => {
      // query() defaults to limit 50 — pass a high limit so >50-row types (196
      // thread-reads) return in full, else joins silently miss rows.
      const res: any = await ds.query({ type: typeValue, limit: 100000 });
      const its = Array.isArray(res) ? res : res.items ?? [];
      return Promise.all(its.map(async (it: any) => ({ id: it.id, o: (await ds.readObjectJson(it.id, it.typeId)) ?? {} })));
    };
    const lastReadByThread = new Map<string, unknown>();
    for (const { o } of await objectsOf('discussions-thread-reads'))
      if ((o as any).userId === USER) lastReadByThread.set((o as any).threadId, (o as any).lastReadAt);
    const subThreads = new Set<string>();
    for (const { o } of await objectsOf('thread-notification-subscriptions'))
      if ((o as any).userId === USER) subThreads.add((o as any).threadId);

    const ms = (v: unknown) => (v == null ? null : Date.parse(String(v)));
    const kRows = (await objectsOf('discussions-threads'))
      .filter(({ o }) => (o as any).archivedAt == null)
      .map(({ id, o }) => {
        const t: any = o;
        const latest = ms(t.latestMessageAt);
        const lastRead = ms(lastReadByThread.get(id));
        return {
          id,
          name: t.name ?? null, description: t.description ?? null,
          created_by_name: t.createdByName ?? null, created_by_user_id: t.createdByUserId ?? null,
          created_at: t.createdAt ?? null,
          has_unread: latest != null && (lastRead == null || latest > lastRead),
          is_notifications_enabled: subThreads.has(id),
          _sort: t.sortOrder, _name: t.name ?? '',
        };
      })
      .sort((a, b) => {
        const as = a._sort == null, bs = b._sort == null;         // NULLS LAST
        if (as !== bs) return as ? 1 : -1;
        if (!as && a._sort !== b._sort) return a._sort - b._sort;
        return String(a._name).localeCompare(String(b._name));
      });

    const pgKeys = pgRows.map((r) => rowKey(r, cols));
    const kKeys = kRows.map((r) => rowKey(r, cols));
    let ok = pgKeys.length === kKeys.length;
    let firstDiff = '';
    for (let i = 0; ok && i < pgKeys.length; i++)
      if (pgKeys[i] !== kKeys[i]) { ok = false; firstDiff = `\n      pg[${i}]=${pgKeys[i]}\n      k [${i}]=${kKeys[i]}`; }
    if (!ok) fail++;
    console.log(`  ${ok ? '✓' : '✗ FAIL'}  discussions.listThreads(user)   pg=${pgRows.length} kanecta=${kRows.length}${ok ? '' : firstDiff}`);
  }

  console.log(`\n${fail === 0 ? '✅ ALL SHADOW-DIFFS MATCH — Kanecta reads reproduce the pg reads' : `❌ ${fail} shadow-diff(s) diverged`}`);
  await source.end(); await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
