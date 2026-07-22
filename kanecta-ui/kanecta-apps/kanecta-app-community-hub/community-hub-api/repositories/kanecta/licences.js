// KanectaRepository — licences reads over kanecta-api (GraphQL). Reproduces the pg
// repository's row shape (snake_case columns, same order) from the camelCase
// GraphQL projection. See repositories/pg-vs-kanecta and lib/kanectaMap.js.
import { graphql } from "../../lib/kanectaClient.js";
import { coerceRow, selectionFor } from "../../lib/kanectaMap.js";

// [snake_column, kind] — mirrors the SELECT column list + order.
const SPEC = [
  ["id", "id"], ["name", "text"], ["url", "text"],
  ["public_description", "text"], ["private_details", "text"],
  ["badge", "text"], ["sort_order", "int"],
];

// pg: SELECT id,name,url,public_description,private_details,badge,sort_order
//     FROM licences ORDER BY sort_order
export async function listLicences() {
  const data = await graphql(
    `{ licenceses(sort:[{field:sortOrder,direction:ASC}], limit:500){ ${selectionFor(SPEC)} } }`,
  );
  return data.licenceses.map((r) => coerceRow(r, SPEC));
}
