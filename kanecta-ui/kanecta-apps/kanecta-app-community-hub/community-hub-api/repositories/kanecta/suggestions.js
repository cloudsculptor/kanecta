// KanectaRepository — suggestions reads over kanecta-api (GraphQL). archived_at is
// a normal filterable field (exposeSoftDelete backfill), so the active/archived
// split reproduces exactly.
import { graphql } from "../../lib/kanectaClient.js";
import { coerceRow, selectionFor } from "../../lib/kanectaMap.js";

const ACTIVE = [
  ["id", "id"], ["content", "text"], ["submitted_by_name", "text"], ["submitted_at", "timestamp"],
];
const ARCHIVED = [
  ["id", "id"], ["content", "text"], ["submitted_by_name", "text"], ["submitted_at", "timestamp"],
  ["archived_at", "timestamp"], ["archived_by_id", "text"],
];

// pg: WHERE archived_at IS NULL ORDER BY submitted_at DESC
export async function listActiveSuggestions() {
  const data = await graphql(
    `{ suggestionses(where:{archivedAt:{isNull:true}},
        sort:[{field:submittedAt,direction:DESC}], limit:500){ ${selectionFor(ACTIVE)} } }`,
  );
  return data.suggestionses.map((r) => coerceRow(r, ACTIVE));
}

// pg: WHERE archived_at IS NOT NULL ORDER BY archived_at DESC
export async function listArchivedSuggestions() {
  const data = await graphql(
    `{ suggestionses(where:{archivedAt:{isNull:false}},
        sort:[{field:archivedAt,direction:DESC}], limit:500){ ${selectionFor(ARCHIVED)} } }`,
  );
  return data.suggestionses.map((r) => coerceRow(r, ARCHIVED));
}
