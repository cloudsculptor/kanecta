// One-off migration: rename Spaces objects and DB storage_keys from
// hyphen-stripped format (3c54b788d2684bec842fb4d91f393822) to
// UUID format (3c54b788-d268-4bec-842f-b4d91f393822).
// Also patches any matching URLs embedded in pages.content_json.
//
// Run from the community-hub-api directory with prod env vars loaded:
//   node migrations/migrate-storage-keys.js

import { S3Client, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import pg from "pg";

const BUCKET = process.env.SPACES_BUCKET || "featherston";
const PUBLIC_URL = process.env.SPACES_PUBLIC_URL;

const client = new S3Client({
  endpoint: process.env.SPACES_ENDPOINT,
  region: process.env.SPACES_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
  },
  forcePathStyle: false,
});

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "25060"),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

function newStorageKey(uuid) {
  return `${uuid.slice(0, 2)}/${uuid.slice(2, 4)}/${uuid}`;
}

async function run() {
  // Find all files that still have the old hyphen-stripped storage key.
  // Old format ends with a 32-char hex segment; new format ends with a 36-char UUID.
  const { rows: files } = await pool.query(`
    SELECT id, storage_key FROM files
    WHERE storage_key ~ '[0-9a-f]{32}$'
  `);

  if (files.length === 0) {
    console.log("No files to migrate.");
    await pool.end();
    return;
  }

  console.log(`Migrating ${files.length} file(s)...`);

  const urlReplacements = [];

  for (const file of files) {
    const oldKey = file.storage_key;
    const newKey = newStorageKey(file.id);

    if (oldKey === newKey) {
      console.log(`  SKIP ${file.id} (already correct)`);
      continue;
    }

    console.log(`  ${oldKey} → ${newKey}`);

    // Copy to new key in Spaces
    await client.send(new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${oldKey}`,
      Key: newKey,
      ACL: "public-read",
      MetadataDirective: "COPY",
    }));

    // Delete old key
    await client.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: oldKey,
    }));

    // Update DB
    await pool.query(
      `UPDATE files SET storage_key = $1 WHERE id = $2`,
      [newKey, file.id]
    );

    if (PUBLIC_URL) {
      urlReplacements.push({
        old: `${PUBLIC_URL}/${oldKey}`,
        new: `${PUBLIC_URL}/${newKey}`,
      });
    }
  }

  // Patch old URLs in pages.content_json
  if (urlReplacements.length > 0) {
    const { rows: pages } = await pool.query(`SELECT id, content_json FROM pages`);
    let pagesPatched = 0;

    for (const page of pages) {
      let json = JSON.stringify(page.content_json);
      let changed = false;

      for (const { old: oldUrl, new: newUrl } of urlReplacements) {
        if (json.includes(oldUrl)) {
          json = json.replaceAll(oldUrl, newUrl);
          changed = true;
        }
      }

      if (changed) {
        await pool.query(
          `UPDATE pages SET content_json = $1 WHERE id = $2`,
          [json, page.id]
        );
        pagesPatched++;
      }
    }

    if (pagesPatched > 0) {
      console.log(`Patched ${pagesPatched} page(s) with updated URLs.`);
    }
  }

  console.log("Done.");
  await pool.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
