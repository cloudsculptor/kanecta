import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { uuidToStorageKey } from "./storage.js";
import { USE_KANECTA } from "../repositories/backend.js";
import * as kanecta from "./spacesKanecta.js";

const BUCKET = process.env.SPACES_BUCKET || "featherston";
const PUBLIC_URL = process.env.SPACES_PUBLIC_URL; // e.g. https://featherston.syd1.digitaloceanspaces.com

const client = new S3Client({
  endpoint: process.env.SPACES_ENDPOINT, // e.g. https://syd1.digitaloceanspaces.com
  region: process.env.SPACES_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
  },
  forcePathStyle: false,
});

// The public URL for an already-stored file row, backend-aware. The pg path's
// storage_key is a real bucket key (sharded since migrate-storage-keys) served by
// the Spaces CDN; the kanecta path's storage_key is the file ITEM id and the bytes
// live in Kanecta's object store, only reachable through the file proxy — a CDN
// URL built from it 403s (the events-images bug). Routes must use this instead of
// hand-building `${SPACES_PUBLIC_URL}/${storage_key}`.
export function fileUrl({ fileId, storageKey, mimeType }) {
  if (USE_KANECTA) return kanecta.fileUrl(fileId ?? storageKey, mimeType);
  return `${PUBLIC_URL}/${storageKey}`;
}

export async function uploadFile({ buffer, mimeType, originalName, uploadedById, uploadedByName, pool }) {
  if (USE_KANECTA) return kanecta.uploadFile({ buffer, mimeType, originalName, uploadedById, uploadedByName });
  const id = randomUUID();
  const storageKey = uuidToStorageKey(id);

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: mimeType,
      ACL: "public-read",
      Metadata: { "original-name": encodeURIComponent(originalName) },
    })
  );

  const url = `${PUBLIC_URL}/${storageKey}`;

  const { rows } = await pool.query(
    `INSERT INTO files (id, name, storage_key, mime_type, size_bytes, uploaded_by_id, uploaded_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, originalName, storageKey, mimeType, buffer.length, uploadedById, uploadedByName]
  );

  return { file: rows[0], url };
}

export async function deleteFile({ storageKey, fileId, pool }) {
  if (USE_KANECTA) return kanecta.deleteFile({ storageKey, fileId });
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
  await pool.query("DELETE FROM files WHERE id = $1", [fileId]);
}

export async function getFileStream({ storageKey, mimeType }) {
  if (USE_KANECTA) return kanecta.getFileStream({ storageKey, mimeType });
  const response = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: storageKey }));
  return response;
}
