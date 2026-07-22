// Phase B de-risk: confirm the backfilled community-hub data reads back through the
// Kanecta pg adapter's READ API (get / query / children / getRelationships), not just
// raw SQL — i.e. it is real, queryable Kanecta items with resolved object fields.
// Read-only. Run after the backfill:
//   tsx kanecta-core/kanecta-converter/scripts/readcheck-backfill-community-hub.ts [--schema=NAME]
import pg from 'pg';
import { PostgresAdapter } from '../../kanecta-storage-adapters/kanecta-postgres/src/adapter.ts';

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

async function main() {
  const source = new pg.Pool(SOURCE);
  const pool = new pg.Pool({ connectionString: TARGET_CONN, options: `-c search_path="${SCHEMA}"` });
  const ds = await PostgresAdapter.open(pool);

  let fail = 0;
  const line = (ok: boolean, msg: string) => { if (!ok) fail++; console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${msg}`); };

  // ── query() by type resolves a projected type and returns object fields ───────
  console.log('\n1. query({ type }) returns items with resolved object payloads:');
  for (const [typeValue, srcTable] of [
    ['discussions-threads', 'discussions_threads'],
    ['events', 'events'],
    ['pages', 'pages'],
  ] as const) {
    const res: any = await ds.query({ type: typeValue });
    const items = Array.isArray(res) ? res : res.items ?? res.rows ?? [];
    const { rows: sc } = await source.query(`SELECT count(*)::int n FROM "${srcTable}"`);
    line(items.length === sc[0].n, `query(${typeValue}) → ${items.length} items (source ${sc[0].n})`);
  }

  // ── get() a specific message and check its resolved fields ────────────────────
  console.log('\n2. get(id) round-trips a discussions_messages payload:');
  const { rows: sample } = await source.query(
    `SELECT id, content, user_name, thread_id FROM discussions_messages WHERE content <> '' LIMIT 1`);
  if (sample.length) {
    const src = sample[0];
    const item: any = await ds.get(src.id);
    line(!!item, `get(${src.id.slice(0, 8)}…) returned an item`);
    if (item) {
      line(item.type === 'object', `item.type = ${item.type} (expected object)`);
      // get() returns the item row; object fields are read via readObjectJson.
      const payload: any = (await ds.readObjectJson(src.id, item.typeId)) ?? {};
      line((payload.content ?? null) === (src.content ?? null), `payload.content matches source`);
      line((payload.userName ?? null) === (src.user_name ?? null), `payload.userName = ${JSON.stringify(payload.userName)?.slice(0, 30)}`);
      line((payload.threadId ?? null) === (src.thread_id ?? null), `payload.threadId matches source`);
    }
  }

  // ── children(root) sees the loaded content items ──────────────────────────────
  console.log('\n3. children(root) exposes loaded items in the tree:');
  const rootChildren: any = await ds.children('00000000-0000-0000-0000-000000000000');
  const kids = Array.isArray(rootChildren) ? rootChildren : rootChildren.items ?? [];
  line(kids.length >= 600, `root has ${kids.length} children (expected ≥600 content items)`);

  // ── getRelationships on a message returns its thread edge ─────────────────────
  console.log('\n4. relationship edges are navigable via the adapter:');
  if (sample.length) {
    const rels: any = await ds.relationships(sample[0].id);
    const out = rels.outbound ?? [];
    const toThread = out.some((e: any) => e.targetId === sample[0].thread_id && e.type === 'relates-to');
    line(toThread, `message → thread relates-to edge present (${out.length} outbound edges)`);
  }

  console.log(`\n${fail === 0 ? '✅ ALL READ CHECKS PASSED — backfilled data reads back as Kanecta items' : `❌ ${fail} READ CHECK(S) FAILED`}`);
  await source.end(); await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
