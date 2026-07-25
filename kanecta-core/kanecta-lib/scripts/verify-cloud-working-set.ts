'use strict';

// Live end-to-end verification of the remote-only working set (G6): a composite
// `cloud` origin remote (Postgres for items + S3 for files) resolved through
// `Datastore.openWorkingSet` — exactly as kanecta-api/mcp/cli open it in-process.
//
// This is a tsx script rather than a vitest test because the Postgres adapter's
// migration loader uses `__dirname`, which vitest's ESM module runner does not
// provide when the adapter is opened cross-package. Under node/tsx (how the real
// apps run) `__dirname` resolves, so this is the faithful check.
//
// Requires the dev Postgres (localhost:45432) and dev MinIO (localhost:45900). It
// runs migrations into a throwaway schema, so it needs the schema-change guard
// opened (as the pg test suite does). Run:
//
//   KANECTA_ALLOW_SCHEMA_CHANGES=1 KANECTA_TEST_S3_SECRET=kanecta-minio-secret \
//     npx tsx scripts/verify-cloud-working-set.ts
//
import crypto from 'crypto';
import { Datastore, cloudConfigFromRemote } from '../src/index.ts';

// `pg` has no bundled types in this package (it's only used by adapters); require
// it the same way @kanecta/datastore-utils does to keep the dev script type-clean.
const { Pool } = require('pg');

const PG_URL = process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const SECRET = process.env.KANECTA_TEST_S3_SECRET;
if (!SECRET) {
  console.error('Set KANECTA_TEST_S3_SECRET (dev MinIO secret, e.g. kanecta-minio-secret).');
  process.exit(2);
}

const SCHEMA = `kanecta_g6_verify_${crypto.randomBytes(4).toString('hex')}`;

// The remote-only working set config as it lives on disk (discrete cloud-remote
// fields). Note: NO `local`. Postgres host/db/user parsed from PG_URL.
const u = new URL(PG_URL);
const origin = {
  type: 'cloud',
  postgres: {
    host: u.hostname,
    port: Number(u.port) || 5432,
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  },
  s3: {
    endpoint: process.env.KANECTA_TEST_S3_ENDPOINT || 'http://localhost:45900',
    region: process.env.KANECTA_TEST_S3_REGION || 'us-east-1',
    accessKeyId: process.env.KANECTA_TEST_S3_KEY || 'kanecta',
    secretAccessKey: SECRET,
    bucket: process.env.KANECTA_TEST_S3_BUCKET || 'kanecta',
  },
};
const workingSet = { remotes: { origin }, defaultBranch: 'main' };

function ok(label: string) { console.log(`  ✓ ${label}`); }

async function main() {
  // Isolate every connection to a throwaway schema so the dev `public` schema is
  // untouched. node-pg honours PGOPTIONS; openWorkingSet's pool picks it up.
  const admin = new Pool({ connectionString: PG_URL });
  await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
  process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;

  try {
    // 1. Init the isolated cloud datastore (migrations + root nodes).
    const created = await Datastore.initCloud(cloudConfigFromRemote(origin), 'verify@example.com');
    ok('initCloud ran migrations + seeded root');

    // 2. Open it THROUGH the facade, from the on-disk working-set config — the G6 path.
    const ds = await Datastore.openWorkingSet(workingSet);
    ok('openWorkingSet resolved the remote-only cloud origin');

    const root = await ds.getRoot();
    if (root?.type !== 'root') throw new Error(`expected root node, got ${JSON.stringify(root)}`);
    ok(`read root node (${root.id})`);

    // 3. Round-trip an item (Postgres) and a file (S3/MinIO).
    const item = await ds.create({ type: 'note', value: 'G6 remote-only works', parentId: root.id });
    const got = await ds.get(item.id);
    if (got?.value !== 'G6 remote-only works') throw new Error(`item round-trip failed: ${JSON.stringify(got)}`);
    ok(`item round-trip via Postgres (${item.id})`);

    await ds.putFile(item.id, 'hello.txt', Buffer.from('remote bytes'), { mimeType: 'text/plain' });
    const bytes = await ds.getFile(item.id, 'hello.txt');
    if (!bytes || bytes.toString('utf8') !== 'remote bytes') {
      throw new Error(`file round-trip failed: ${bytes && bytes.toString('utf8')}`);
    }
    ok('file round-trip via S3 (MinIO)');
    await ds.deleteFile(item.id, 'hello.txt');

    console.log('\n✅ G6 remote-only working set verified end-to-end (openWorkingSet → Postgres + MinIO).');
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await admin.end();
  }
}

main().catch((e) => { console.error('\n❌ verification failed:', e); process.exit(1); });
