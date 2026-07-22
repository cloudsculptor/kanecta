// Native-file replacement for lib/spaces.js when DATA_BACKEND=kanecta. Instead of
// DO Spaces + a pg `files` row, a file is a Kanecta `files` ITEM (the record) whose
// bytes live in Kanecta's own object store (MinIO), addressed by the item id under
// a single fixed blob filename. Same interface as spaces.js so the routes don't
// change: uploadFile / deleteFile / getFileStream.
//
// Atomicity: the old flow was BEGIN → files row → S3 upload → COMMIT. Here we write
// the file item, then put the bytes; if the byte-put fails we best-effort delete the
// item so a record never dangles without bytes (owner-accepted non-strict atomicity).
import { Readable } from "stream";
import {
  createItem, deleteItem, putFile, getFile, deleteFileBytes,
  resolveTypeId, newId, ROOT_ID, OWNER,
} from "./kanectaClient.js";

// The URL the frontend embeds for a file. Defaults to the kanecta-api byte
// endpoint; override with KANECTA_FILE_URL_BASE to point at a community-hub proxy
// route (e.g. https://host/api/files). `${base}/${fileId}` must resolve to the bytes.
const FILE_URL_BASE = process.env.KANECTA_FILE_URL_BASE
  || `${process.env.KANECTA_API_URL || "http://127.0.0.1:3001"}/items`;

function fileUrl(fileId, mimeType) {
  // Default base → the raw kanecta-api endpoint (…/items/:id/files/blob); a custom
  // base is treated as `${base}/${fileId}`.
  if (!process.env.KANECTA_FILE_URL_BASE) {
    const q = mimeType ? `?mime=${encodeURIComponent(mimeType)}` : "";
    return `${FILE_URL_BASE}/${fileId}/files/blob${q}`;
  }
  return `${FILE_URL_BASE}/${fileId}`;
}

// Mirrors spaces.uploadFile. `pool` is accepted for signature-compatibility and
// ignored (the record write goes through kanecta-api). storage_key holds the file
// item id — getFileStream reads it back to address the bytes.
export async function uploadFile({ buffer, mimeType, originalName, uploadedById, uploadedByName }) {
  const typeId = await resolveTypeId("files");
  const id = newId();
  // 1) put the bytes first so a failed upload never leaves a byteless record.
  await putFile(id, buffer, mimeType);
  // 2) write the record; if it fails, roll back the bytes.
  let item;
  try {
    item = await createItem({
      id, type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
      objectData: {
        name: originalName, storageKey: id, mimeType, sizeBytes: buffer.length,
        description: null, uploadedById, uploadedByName,
        createdAt: new Date().toISOString(), deletedAt: null,
      },
    });
  } catch (err) {
    await deleteFileBytes(id).catch(() => {});
    throw err;
  }
  const file = {
    id, name: originalName, storage_key: id, mime_type: mimeType,
    size_bytes: buffer.length, uploaded_by_id: uploadedById, uploaded_by_name: uploadedByName,
  };
  return { file, url: fileUrl(id, mimeType) };
}

// Mirrors spaces.deleteFile. storageKey is the file item id; delete the bytes then
// the record item (best-effort ordering).
export async function deleteFile({ storageKey, fileId }) {
  const id = fileId || storageKey;
  await deleteFileBytes(id).catch(() => {});
  await deleteItem(id, { force: true }).catch(() => {});
}

// Mirrors spaces.getFileStream. Returns { Body, ContentType } where Body is a
// Readable (so routes can `.pipe(res)` exactly as with the S3 response). storageKey
// is the file item id.
export async function getFileStream({ storageKey, mimeType }) {
  const buf = await getFile(storageKey, mimeType);
  if (buf == null) {
    const err = new Error("File bytes not found");
    err.code = "NoSuchKey";
    throw err;
  }
  return { Body: Readable.from(buf), ContentType: mimeType, ContentLength: buf.length };
}
