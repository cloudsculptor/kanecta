// KanectaRepository — site-export ("download") reads over kanecta-api (GraphQL).
// getFilesByIds is a [FILE] method wired with the native file store (see the
// file section); only the page-list read lives here.
import { graphql } from "../../lib/kanectaClient.js";
import { coerceRow, selectionFor } from "../../lib/kanectaMap.js";

const EXPORT = [["slug", "text"], ["title", "text"], ["content_json", "json"]];

// pg: SELECT slug,title,content_json FROM pages WHERE public=TRUE AND deleted_at
//     IS NULL ORDER BY title
export async function listPublicPagesForExport() {
  const data = await graphql(
    `{ pageses(where:{public:{eq:true}, deletedAt:{isNull:true}},
        sort:[{field:title,direction:ASC}], limit:500){ ${selectionFor(EXPORT)} } }`,
  );
  return data.pageses.map((r) => coerceRow(r, EXPORT));
}

// pg: SELECT id, name, storage_key FROM files WHERE id=ANY($1) AND deleted_at IS NULL
// (record-only read; byte streaming stays in the route). The frontend then fetches
// the bytes — under native files that resolves to a Kanecta file-serving route.
export async function getFilesByIds(ids) {
  if (!ids?.length) return [];
  const data = await graphql(
    `query($ids:[ID!]){ fileses(where:{id:{in:$ids}, deletedAt:{isNull:true}}, limit:500){ id name storageKey } }`,
    { ids },
  );
  return data.fileses.map((f) => ({ id: f.id, name: f.name, storage_key: f.storageKey }));
}
