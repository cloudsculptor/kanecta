// Initialise a fresh (empty) Kanecta pg datastore: creates the four-table
// structure + root/types nodes in the target schema via PostgresAdapter.init.
// For standalone instances that have NO backfill to seed them.
//   KANECTA_ALLOW_SCHEMA_CHANGES=1 KANECTA_TEST_PG_URL=postgres://user:pw@host:port/db?sslmode=no-verify \
//   SCHEMA=public OWNER=owner@example.com \
//   tsx kanecta-core/kanecta-converter/scripts/init-datastore.ts
import pg from 'pg';
import { PostgresAdapter } from '../../kanecta-storage-adapters/kanecta-postgres/src/adapter.ts';

const CONN = process.env.KANECTA_TEST_PG_URL;
const SCHEMA = process.env.SCHEMA || 'public';
const OWNER = process.env.OWNER || 'owner@example.com';
if (!CONN) { console.error('KANECTA_TEST_PG_URL required'); process.exit(1); }

const pool = new pg.Pool({ connectionString: CONN, options: `-c search_path="${SCHEMA}"` });
const adapter = await PostgresAdapter.init(pool, OWNER);
const rootId = '00000000-0000-0000-0000-000000000000';
const root = await adapter.get(rootId).catch(() => null);
const kids = await adapter.children(rootId).catch(() => []);
const kidCount = Array.isArray(kids) ? kids.length : (kids?.items?.length ?? 0);
console.log(`initialised datastore in schema "${SCHEMA}" owner=${OWNER}; root=${root ? 'present' : 'MISSING'}; root children=${kidCount}`);
await pool.end();
