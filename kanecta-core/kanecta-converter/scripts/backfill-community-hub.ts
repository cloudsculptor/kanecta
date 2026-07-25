// Backfill the community-hub data (source: communityhub-pg :45433) into a Kanecta
// datastore in the four-table format, using the converter's introspect + planBackfill
// + applyBackfillPlan and the verified type manifest.
//
// TARGET: a fresh, isolated schema on the Kanecta dev pg :45432 (default
// `communityhub_backfill`) — non-polluting, droppable/rebuildable. Read-only against
// the source; owner triggers any prod work separately.
//
// Run from the repo root so workspace packages resolve:
//   KANECTA_ALLOW_SCHEMA_CHANGES=1 tsx kanecta-core/kanecta-converter/scripts/backfill-community-hub.ts [--drop] [--schema=NAME]
//
// Idempotent: re-running upserts by (sourceSystem, sourceExternalId). `--drop`
// recreates the target schema first for a clean run.
import pg from 'pg';
import { readPgCatalog } from '../src/catalog-pg.ts';
import { introspect } from '../src/introspect.ts';
import { planBackfill } from '../src/backfill.ts';
import { applyBackfillPlan } from '../src/backfill-executor.ts';
import { PostgresAdapter } from '../../kanecta-storage-adapters/kanecta-postgres/src/adapter.ts';

// Source defaults to the LOCAL prod-copy container (:45433). For the real
// cutover run, point SOURCE_PG_* at the production database (read-only use).
const SOURCE = {
  host:     process.env.SOURCE_PG_HOST     || 'localhost',
  port:     Number(process.env.SOURCE_PG_PORT || 45433),
  database: process.env.SOURCE_PG_DATABASE || 'communityhub',
  user:     process.env.SOURCE_PG_USER     || 'kanecta',
  password: process.env.SOURCE_PG_PASSWORD || 'kanecta',
  ...(process.env.SOURCE_PG_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
};
const TARGET_CONN = process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const SOURCE_SYSTEM = 'community-hub';
const OWNER = 'community-hub-backfill';

const argSchema = process.argv.find((a) => a.startsWith('--schema='));
const SCHEMA = argSchema ? argSchema.split('=')[1] : 'communityhub_backfill';
const DROP = process.argv.includes('--drop');

// Load parents before children so FK reference edges resolve (from the manifest FK graph).
const TIERS: string[][] = [
  ['files', 'licences', 'events', 'finances_transactions', 'finances_expenses', 'notices',
   'suggestions', 'trust', 'discussions_threads', 'fcm_tokens', 'push_subscriptions', 'notification_preferences'],
  ['groups', 'event_files', 'finances_transaction_files', 'discussions_messages',
   'discussions_thread_reads', 'thread_notification_subscriptions'],
  ['pages', 'discussions_message_files', 'discussions_reactions'],
  ['page_history', 'site_nodes'],
  ['site_node_history'],
];

// Gap-C natural idempotency keys for the serial-PK tables (composite-PK tables key
// on their PK by default, which is already their natural key).
const IDEMPOTENCY: Record<string, string[]> = {
  fcm_tokens: ['user_id', 'token'],
  // push_subscriptions' natural key is (user_id, subscription->>'endpoint') — a JSON
  // expression, not a plain column. Extract it as `endpoint_key` in the source query
  // below and key on that. (Keying on the raw `subscription` object stringifies to
  // "[object Object]" and collides every sub for a user.)
  push_subscriptions: ['user_id', 'endpoint_key'],
};

// Per-table source-query overrides. Extra selected columns (not in the SourceTable
// column list) are usable as idempotency keys without polluting objectData.
const SOURCE_QUERY: Record<string, string> = {
  push_subscriptions: `SELECT *, subscription->>'endpoint' AS endpoint_key FROM "push_subscriptions"`,
};

function log(...a: unknown[]) { console.log(...a); }

// Order rows so a self-referential FK target (another row in the same table) is
// always inserted before the row that points at it. The obj_ projection carries a
// real FK to items(id) for each reference column, and the executor inserts each
// item+object interleaved in row order, so a child arriving before its parent
// would violate that FK. Cross-table refs are handled by tier ordering instead.
function sortBySelfFk(table: any, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const selfCols = (table.foreignKeys ?? [])
    .filter((fk: any) => fk.references.table === table.name)
    .map((fk: any) => fk.column);
  if (!selfCols.length) return rows;
  const pk = table.primaryKey[0];
  const emitted = new Set<string>();
  const remaining = [...rows];
  const out: Record<string, unknown>[] = [];
  let guard = remaining.length + 1;
  while (remaining.length && guard-- > 0) {
    for (let i = remaining.length - 1; i >= 0; i--) {
      const r = remaining[i];
      const parents = selfCols.map((c: string) => r[c]).filter((v: unknown) => v != null && v !== r[pk]);
      if (parents.every((p: unknown) => emitted.has(String(p)))) {
        out.push(r); emitted.add(String(r[pk])); remaining.splice(i, 1);
      }
    }
  }
  return out.concat(remaining); // any cycle remnant appended as-is
}

async function main() {
  const source = new pg.Pool(SOURCE);
  const admin = new pg.Pool({ connectionString: TARGET_CONN });

  // ── 1. Introspect the whole source schema ────────────────────────────────────
  const srcClient = await source.connect();
  let tables;
  try { tables = await readPgCatalog(srcClient); } finally { srcClient.release(); }
  const byName = new Map(tables.map((t) => [t.name, t]));
  log(`introspected ${tables.length} source tables`);

  // Deterministic type id per table (two-pass so FK reference fields resolve).
  const typeIdByTable = new Map<string, string>();
  for (const t of tables) typeIdByTable.set(t.name, introspect(t).typeItem.item.id);
  const typeIdForTable = (tbl: string) => typeIdByTable.get(tbl);

  // ── 2. Fresh target schema + Kanecta datastore ───────────────────────────────
  if (DROP) { await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`); log(`dropped schema ${SCHEMA}`); }
  await admin.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: TARGET_CONN, options: `-c search_path="${SCHEMA}"` });
  const adapter = await PostgresAdapter.init(pool, OWNER);
  log(`initialised Kanecta datastore in schema "${SCHEMA}"`);

  // ── 3. Seed the 24 type items + force their obj_ projection tables ────────────
  for (const t of tables) {
    // exposeSoftDelete: community-hub's own SQL filters deleted_at / archived_at
    // directly (approved-not-deleted notices, archived suggestions), so the read
    // path must be able to reproduce those filters over GraphQL.
    const res = introspect(t, { typeIdForTable, exposeSoftDelete: true });
    const typeId = res.typeItem.item.id;
    await adapter.createType(res.report.typeValue, { schema: res.typeItem.payload, id: typeId });
    await adapter._ensureProjection(typeId);
  }
  log(`seeded ${tables.length} types + projections`);

  // ── 4a. Backfill items + objects per tier ────────────────────────────────────
  // Relationships are handled separately (4b): the 1.4.0 model stores them as items
  // (adapter.relate), not a flat `relationships` table, so applyBackfillPlan's raw
  // relationship insert is bypassed here. Every FK value is ALSO kept as a data field
  // on the item (introspect keeps FK columns), so no reference is lost by deferring.
  const totals = { rows: 0, items: 0, objects: 0, relationships: 0, preservedUuids: 0, surrogateKeys: 0 };
  const edges: { sourceId: string; targetId: string; fk: string }[] = [];
  for (let tier = 0; tier < TIERS.length; tier++) {
    for (const name of TIERS[tier]) {
      const t = byName.get(name);
      if (!t) { log(`  ! tier ${tier} table ${name} not found — skipping`); continue; }
      const { rows: rawRows } = await source.query(SOURCE_QUERY[name] ?? `SELECT * FROM "${name}"`);
      const rows = sortBySelfFk(t, rawRows);
      const plan = planBackfill(t, rows, {
        typeId: typeIdByTable.get(name)!,
        sourceSystem: SOURCE_SYSTEM,
        owner: OWNER,
        idempotencyColumns: IDEMPOTENCY[name],
      });
      for (const e of plan.relationships) edges.push({ sourceId: e.sourceId, targetId: e.targetId, fk: e.type });
      const applied = await applyBackfillPlan(pool, { ...plan, relationships: [] }, { searchPath: SCHEMA, defaultOwner: OWNER });
      totals.rows += plan.stats.rows;
      totals.items += applied.items;
      totals.objects += applied.objects;
      totals.preservedUuids += plan.stats.preservedUuids;
      totals.surrogateKeys += plan.stats.surrogateKeys;
      log(`  [t${tier}] ${name.padEnd(34)} rows=${String(plan.stats.rows).padStart(4)} items=${String(applied.items).padStart(4)} obj=${String(applied.objects).padStart(4)} fkEdges=${String(plan.relationships.length).padStart(4)} uuid=${plan.stats.preservedUuids} surr=${plan.stats.surrogateKeys}`);
    }
  }

  // ── 4b. Create FK reference edges as relationship items (targets now all exist) ──
  // Built-in rel types are semantic (relates-to, depends-on…); the specific FK name
  // is preserved in the relationship note so nothing is lost. adapter.relate() is not
  // itself idempotent, so pre-load the existing (source,target,note) edges and skip
  // them — keeps the whole backfill safely re-runnable without --drop.
  const seen = new Set<string>();
  const relObjName = (await pool.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 AND c.relkind='r' AND c.relname LIKE 'obj_%'
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                   WHERE col.table_schema=$1 AND col.table_name=c.relname AND col.column_name='target_id')`,
    [SCHEMA])).rows[0]?.relname;
  if (relObjName) {
    const { rows: existing } = await pool.query(`SELECT source_id, target_id, note FROM "${relObjName}"`);
    for (const r of existing) seen.add(`${r.source_id}|${r.target_id}|${r.note ?? ''}`);
  }
  // Sequential relate() calls: LAN-fast, but over a WAN/tunnel each edge is
  // several round-trips — log progress so a long run is visibly alive.
  log(`\nrelating ${edges.length} FK edges...`);
  let edgeOk = 0, edgeSkip = 0;
  for (const e of edges) {
    if (seen.has(`${e.sourceId}|${e.targetId}|${e.fk}`)) {
      edgeSkip++;
    } else {
      try { await adapter.relate(e.sourceId, 'relates-to', e.targetId, { note: e.fk }); seen.add(`${e.sourceId}|${e.targetId}|${e.fk}`); edgeOk++; }
      catch { edgeSkip++; }
    }
    if ((edgeOk + edgeSkip) % 50 === 0) log(`  [edges] ${edgeOk + edgeSkip}/${edges.length} (${edgeOk} created, ${edgeSkip} skipped)`);
  }
  totals.relationships = edgeOk;
  log(`\nrelationship edges: ${edgeOk} created, ${edgeSkip} skipped (of ${edges.length})`);
  log(`TOTALS: rows=${totals.rows} items=${totals.items} objects=${totals.objects} relationships=${totals.relationships} (preservedUuids=${totals.preservedUuids} surrogates=${totals.surrogateKeys})`);

  await source.end();
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
