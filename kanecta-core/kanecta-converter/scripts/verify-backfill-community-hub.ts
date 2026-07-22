// Verify the community-hub backfill: per-table row-count parity, UUID preservation
// (Gap D), surrogate idempotency (Gap C), FK-reference-edge integrity, and an
// objectData round-trip spot-check. Read-only against both DBs.
//
//   tsx kanecta-core/kanecta-converter/scripts/verify-backfill-community-hub.ts [--schema=NAME]
import pg from 'pg';
import { readPgCatalog } from '../src/catalog-pg.ts';
import { introspect } from '../src/introspect.ts';
import { snakeToCamel } from '../src/introspect.ts';

const SOURCE = {
  host:     process.env.SOURCE_PG_HOST     || 'localhost',
  port:     Number(process.env.SOURCE_PG_PORT || 45433),
  database: process.env.SOURCE_PG_DATABASE || 'communityhub',
  user:     process.env.SOURCE_PG_USER     || 'kanecta',
  password: process.env.SOURCE_PG_PASSWORD || 'kanecta',
  ...(process.env.SOURCE_PG_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
};
const TARGET_CONN = process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const argSchema = process.argv.find((a) => a.startsWith('--schema='));
const SCHEMA = argSchema ? argSchema.split('=')[1] : 'communityhub_backfill';
const objTable = (typeId: string) => `obj_${typeId.replace(/-/g, '_')}`;

async function main() {
  const source = new pg.Pool(SOURCE);
  const target = new pg.Pool({ connectionString: TARGET_CONN, options: `-c search_path="${SCHEMA}"` });

  const c = await source.connect();
  let tables;
  try { tables = await readPgCatalog(c); } finally { c.release(); }
  tables.sort((a, b) => a.name.localeCompare(b.name));

  let fail = 0;
  const line = (ok: boolean, msg: string) => { if (!ok) fail++; console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${msg}`); };

  // ── 1. Per-table row-count parity ─────────────────────────────────────────────
  console.log('\n1. Row-count parity (source table → obj_<typeId>):');
  let srcTotal = 0, objTotal = 0;
  const uuidTables: any[] = [];
  for (const t of tables) {
    const typeId = introspect(t).typeItem.item.id;
    const { rows: s } = await source.query(`SELECT count(*)::int n FROM "${t.name}"`);
    const { rows: o } = await target.query(`SELECT count(*)::int n FROM "${objTable(typeId)}"`);
    srcTotal += s[0].n; objTotal += o[0].n;
    line(s[0].n === o[0].n, `${t.name.padEnd(34)} source=${String(s[0].n).padStart(4)}  obj=${String(o[0].n).padStart(4)}`);
    const pkCol = t.primaryKey.length === 1 ? t.columns.find((col) => col.name === t.primaryKey[0]) : undefined;
    if (pkCol && pkCol.sqlType.toLowerCase() === 'uuid') uuidTables.push({ t, typeId });
  }
  line(srcTotal === objTotal, `TOTAL source=${srcTotal} obj=${objTotal}`);

  // ── 2. UUID preservation (Gap D): every source PK uuid is an item id ──────────
  console.log('\n2. UUID preservation — every source uuid PK survived as its item id:');
  for (const { t, typeId } of uuidTables) {
    const pk = t.primaryKey[0];
    const { rows } = await source.query(`SELECT "${pk}" id FROM "${t.name}"`);
    if (!rows.length) { line(true, `${t.name} (0 rows)`); continue; }
    const ids = rows.map((r: any) => r.id);
    const { rows: present } = await target.query(
      `SELECT count(*)::int n FROM items WHERE id = ANY($1::uuid[]) AND type_id = $2`, [ids, typeId]);
    line(present[0].n === ids.length, `${t.name.padEnd(34)} ${present[0].n}/${ids.length} source uuids present as items`);
  }

  // ── 3. Relationship-edge integrity: every edge target is a real item ──────────
  console.log('\n3. Relationship edges (relates-to items) resolve to real items:');
  // Expected = one edge per non-null FK value whose target table is introspected —
  // mirrors planBackfill's edge planning; derived from the source, never hard-coded
  // (a literal count goes stale the moment the source dataset moves).
  const tableNames = new Set(tables.map((t) => t.name));
  let expectedEdges = 0;
  for (const t of tables) {
    for (const fk of t.foreignKeys ?? []) {
      if (!tableNames.has(fk.references.table)) continue;
      const { rows } = await source.query(`SELECT count(*)::int n FROM "${t.name}" WHERE "${fk.column}" IS NOT NULL`);
      expectedEdges += rows[0].n;
    }
  }
  const { rows: relCount } = await target.query(`SELECT count(*)::int n FROM items WHERE type='relationship'`);
  line(relCount[0].n === expectedEdges, `${relCount[0].n} relationship items (expected ${expectedEdges} from source FKs)`);

  // dangling-target check via the relationship projection table
  const relObj = await target.query(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relkind='r' AND c.relname LIKE 'obj_%'
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema=$1 AND col.table_name=c.relname AND col.column_name='target_id')`,
    [SCHEMA]);
  if (relObj.rows.length) {
    const rt = relObj.rows[0].relname;
    const { rows: bad } = await target.query(
      `SELECT count(*)::int n FROM "${rt}" o WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.id = o.target_id)`);
    line(bad[0].n === 0, `dangling relationship targets: ${bad[0].n} (table ${rt})`);
    const { rows: badSrc } = await target.query(
      `SELECT count(*)::int n FROM "${rt}" o WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.id = o.source_id)`);
    line(badSrc[0].n === 0, `dangling relationship sources: ${badSrc[0].n}`);
  }

  // ── 4. objectData round-trip spot-check — a discussions_messages row ──────────
  console.log('\n4. objectData round-trip (discussions_messages sample):');
  const dm = tables.find((t) => t.name === 'discussions_messages')!;
  const dmType = introspect(dm).typeItem.item.id;
  const { rows: sample } = await source.query(`SELECT * FROM discussions_messages LIMIT 1`);
  if (sample.length) {
    const src = sample[0];
    const { rows: obj } = await target.query(`SELECT * FROM "${objTable(dmType)}" WHERE item_id = $1`, [src.id]);
    line(obj.length === 1, `message ${src.id} present in obj_ table`);
    if (obj.length) {
      const o = obj[0];
      for (const col of ['content', 'user_id', 'user_name', 'thread_id']) {
        const srcV = src[col] == null ? null : String(src[col]);
        const objV = o[col] == null ? null : String(o[col]);
        line(srcV === objV, `field ${col}: source=${JSON.stringify(srcV)?.slice(0, 40)} obj=${JSON.stringify(objV)?.slice(0, 40)}`);
      }
    }
  }

  // ── 5. Surrogate idempotency (Gap C): distinct source_external_id per surrogate ─
  console.log('\n5. Surrogate idempotency keys are unique (Gap C):');
  for (const name of ['discussions_reactions', 'discussions_thread_reads', 'fcm_tokens', 'push_subscriptions']) {
    const t = tables.find((x) => x.name === name);
    if (!t) continue;
    const typeId = introspect(t).typeItem.item.id;
    const { rows } = await target.query(
      `SELECT count(*)::int total, count(DISTINCT source_external_id)::int distinct FROM items WHERE type_id=$1`, [typeId]);
    line(rows[0].total === rows[0].distinct, `${name.padEnd(34)} ${rows[0].distinct}/${rows[0].total} external ids distinct`);
  }

  console.log(`\n${fail === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${fail} CHECK(S) FAILED`}`);
  await source.end(); await target.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
