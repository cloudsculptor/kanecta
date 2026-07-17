// Driven by cloud-compose.test.ts in a tsx child process — the SAME loader
// kanecta-api uses in production, so the config → Pool/S3Client →
// PostgresAdapter+S3Adapter → CloudAdapter glue is exercised exactly as
// deployed (vite-node's ESM transform can't load the CJS-shaped TS chain).
// Prints one JSON result line; the test asserts on it.

import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createCloudAdapter, openCloudAdapter } from '../src/index';

const PG_URL =
  process.env.KANECTA_TEST_PG_URL || 'postgres://kanecta:kanecta@localhost:45432/kanecta';
const SCHEMA = `kanecta_dsutils_${crypto.randomBytes(4).toString('hex')}`;

function cloudConfig() {
  return {
    pg: { connectionString: PG_URL, options: `-c search_path="${SCHEMA}"` },
    s3: {
      endpoint: process.env.KANECTA_TEST_S3_ENDPOINT || 'http://localhost:45900',
      region: 'us-east-1',
      bucket: process.env.KANECTA_TEST_S3_BUCKET || 'kanecta',
      accessKeyId: process.env.KANECTA_TEST_S3_KEY || 'kanecta',
      // Placeholder when unset — the S3 half only runs when the secret exists.
      secretAccessKey: process.env.KANECTA_TEST_S3_SECRET || 'unused-placeholder',
    },
  };
}

async function main() {
  const out: any = {};
  const adminPool = new Pool({ connectionString: PG_URL });
  try {
    await adminPool.query(`CREATE SCHEMA "${SCHEMA}"`);

    const created = await createCloudAdapter(cloudConfig(), 'test@example.com');
    const item = await created.create({ value: 'through the glue', type: 'text' });
    out.createdId = item.id;

    const reopened = await openCloudAdapter(cloudConfig());
    const got = await reopened.get(item.id);
    out.reopenedValue = got?.value;

    // Property-shaped surface reads through the proxy (a regression here crashed
    // validateTxOp on cloud working sets).
    out.relTypesIsArray = Array.isArray(reopened.relTypes);

    // Branching — what a cloud Studio deployment needs — end to end.
    const branch = await reopened.createBranch(`feature-${crypto.randomBytes(3).toString('hex')}`);
    out.branchCreated = !!branch;
    const branches = await reopened.listBranches();
    out.branchCount = Array.isArray(branches) ? branches.length : -1;

    // FTS search reaches the pg adapter through the proxy.
    const hits = await reopened.search('glue');
    out.searchFoundItem = hits.some((h: any) => h.id === item.id);

    if (process.env.KANECTA_TEST_S3_SECRET) {
      const bytes = Buffer.from('cloud file bytes');
      await reopened.putFile(item.id, 'note.txt', bytes, { mimeType: 'text/plain' });
      const back = await reopened.getFile(item.id, 'note.txt');
      out.fileRoundTrip = Buffer.compare(back, bytes) === 0;
      await reopened.deleteFile(item.id, 'note.txt');
    }

    out.ok = true;
  } catch (err: any) {
    out.ok = false;
    out.error = err.message;
  } finally {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await adminPool.end();
  }
  console.log(JSON.stringify(out));
  process.exit(out.ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
