// One-time byte migration for BACKFILLED files (see plans/community-hub-100pct
// progress doc, owner decision #2). The backfill copied file RECORDS into Kanecta
// but not their BYTES: a backfilled record's storage_key is still the old Spaces
// key (aa/bb/<uuid>), and the bytes live in the old bucket. The native store
// expects bytes addressed by the file ITEM id (storage_key = item id). For each
// files item where storageKey !== id, this script:
//
//   1. GETs the bytes from the SOURCE bucket at the old storage_key,
//   2. PUTs them into Kanecta's native store via kanecta-api (putFile),
//   3. verifies the round-trip (re-GET, compare length + content hash),
//   4. updates the record's storageKey to the item id (read-modify-write of the
//      full payload — writeObjectJson validates the whole schema).
//
// Idempotent: records with storageKey === id are skipped, so a partial run can
// simply be re-run. A byte-put that succeeded before a failed record update is
// overwritten harmlessly on retry.
//
// Usage:
//   node scripts/migrate-file-bytes.js --dry-run     # report only, change nothing
//   node scripts/migrate-file-bytes.js               # migrate
//
// Env:
//   KANECTA_API_URL          kanecta-api base (default http://127.0.0.1:3001)
//   SOURCE_SPACES_ENDPOINT   source S3 endpoint (prod: https://syd1.digitaloceanspaces.com)
//   SOURCE_SPACES_BUCKET     source bucket (prod: featherston)
//   SOURCE_SPACES_KEY/SECRET source credentials (read-only is enough)
//   SOURCE_SPACES_FORCE_PATH_STYLE=true   needed for MinIO rehearsals
import { createHash } from "crypto";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { graphql, getItem, updateObject, putFile, getFile } from "../lib/kanectaClient.js";

const DRY_RUN = process.argv.includes("--dry-run");
const BUCKET = process.env.SOURCE_SPACES_BUCKET || "featherston";

const source = new S3Client({
  endpoint: process.env.SOURCE_SPACES_ENDPOINT,
  region: process.env.SOURCE_SPACES_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.SOURCE_SPACES_KEY,
    secretAccessKey: process.env.SOURCE_SPACES_SECRET,
  },
  forcePathStyle: process.env.SOURCE_SPACES_FORCE_PATH_STYLE === "true",
});

function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

async function listAllFileRecords() {
  // No deletedAt filter on purpose: soft-deleted records (page-history images)
  // must keep serving bytes, so they migrate too.
  const data = await graphql(
    `{ fileses(limit:10000){ id name storageKey mimeType sizeBytes } }`,
  );
  return data.fileses;
}

async function main() {
  const records = await listAllFileRecords();
  const candidates = records.filter((r) => r.storageKey !== r.id);
  const done = records.length - candidates.length;
  console.log(`${records.length} file records: ${done} already native, ${candidates.length} to migrate${DRY_RUN ? " (DRY RUN)" : ""}`);

  let migrated = 0, missing = 0, failed = 0;
  for (const rec of candidates) {
    const label = `${rec.id} (${rec.name})`;
    try {
      if (DRY_RUN) {
        // HEAD the source object so the dry run proves every byte source exists.
        const head = await source.send(new HeadObjectCommand({ Bucket: BUCKET, Key: rec.storageKey }));
        const sizeNote = rec.sizeBytes != null && Number(rec.sizeBytes) !== head.ContentLength
          ? ` [record says ${rec.sizeBytes}b, source has ${head.ContentLength}b]` : "";
        console.log(`  would migrate ${label}: ${rec.storageKey} -> ${rec.id} (${head.ContentLength}b)${sizeNote}`);
        migrated++;
        continue;
      }

      // 1. fetch the old bytes
      const obj = await source.send(new GetObjectCommand({ Bucket: BUCKET, Key: rec.storageKey }));
      const bytes = Buffer.from(await obj.Body.transformToByteArray());

      // 2. put into the native store under the item id
      await putFile(rec.id, bytes, rec.mimeType);

      // 3. verify the round-trip before touching the record
      const back = await getFile(rec.id, rec.mimeType);
      if (!back || back.length !== bytes.length || sha256(back) !== sha256(bytes)) {
        throw new Error(`round-trip verify failed (${bytes.length}b out, ${back?.length ?? 0}b back)`);
      }

      // 4. flip the record's storageKey to the item id (full-payload rewrite)
      const item = await getItem(rec.id);
      if (!item?.payload) throw new Error("record item vanished mid-migration");
      await updateObject(rec.id, { ...item.payload, storageKey: rec.id });

      console.log(`  migrated ${label}: ${rec.storageKey} -> ${rec.id} (${bytes.length}b, sha ok)`);
      migrated++;
    } catch (err) {
      if (err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        console.warn(`  MISSING source bytes for ${label} at ${rec.storageKey} — skipped`);
        missing++;
      } else {
        console.error(`  FAILED ${label}: ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n${DRY_RUN ? "Dry run" : "Migration"} complete: ${migrated} ${DRY_RUN ? "migratable" : "migrated"}, ${missing} missing source bytes, ${failed} failed.`);
  if (missing || failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
