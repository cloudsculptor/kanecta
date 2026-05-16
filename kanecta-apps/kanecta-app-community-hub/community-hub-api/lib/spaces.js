import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { uuidToStorageKey } from "./storage.js";

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

export async function uploadFile({ buffer, mimeType, originalName, uploadedById, uploadedByName, pool }) {
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
