// Data access for the public file-serving route (routes/files.js). Record-only
// read; the route streams the bytes via lib/spaces.getFileStream.
import { graphql } from "../../lib/kanectaClient.js";

// pg: SELECT name, storage_key, mime_type, size_bytes FROM files WHERE id=$1
// -> row or undefined. Deliberately NO deleted_at filter: page-history versions
// reference images later removed from the page (soft-deleted records), and the
// old public Spaces URLs kept serving those bytes — the proxy preserves that.
export async function getFileById(id) {
  const data = await graphql(
    `query($id:ID){ fileses(where:{id:{eq:$id}}, limit:1){ name storageKey mimeType sizeBytes } }`,
    { id },
  );
  const f = data.fileses[0];
  return f
    ? { name: f.name, storage_key: f.storageKey, mime_type: f.mimeType, size_bytes: f.sizeBytes }
    : undefined;
}
