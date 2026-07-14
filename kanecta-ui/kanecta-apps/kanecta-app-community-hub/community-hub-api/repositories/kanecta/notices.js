// KanectaRepository — notices reads over kanecta-api (GraphQL). The legacy filters
// on deleted_at (soft delete) reproduce because the backfill ran with
// exposeSoftDelete, so `deletedAt` is a normal filterable field.
import { graphql } from "../../lib/kanectaClient.js";
import { coerceRow, selectionFor } from "../../lib/kanectaMap.js";

const APPROVED = [
  ["id", "id"], ["heading", "text"], ["body", "text"], ["notice_date", "date"],
  ["submitted_by_name", "text"], ["submitted_at", "timestamp"],
];
const MINE = [
  ["id", "id"], ["heading", "text"], ["notice_date", "date"], ["status", "text"],
  ["decline_reason", "text"], ["submitted_at", "timestamp"],
];

// pg: WHERE status='approved' AND deleted_at IS NULL ORDER BY submitted_at DESC
export async function listApprovedNotices() {
  const data = await graphql(
    `{ noticeses(where:{status:{eq:"approved"}, deletedAt:{isNull:true}},
        sort:[{field:submittedAt,direction:DESC}], limit:500){ ${selectionFor(APPROVED)} } }`,
  );
  return data.noticeses.map((r) => coerceRow(r, APPROVED));
}

// pg: WHERE submitted_by_id=$1 AND deleted_at IS NULL ORDER BY submitted_at DESC
export async function listMyNotices(userId) {
  const data = await graphql(
    `query($u:String){ noticeses(where:{submittedById:{eq:$u}, deletedAt:{isNull:true}},
        sort:[{field:submittedAt,direction:DESC}], limit:500){ ${selectionFor(MINE)} } }`,
    { u: userId },
  );
  return data.noticeses.map((r) => coerceRow(r, MINE));
}

// pg: WHERE status='pending' AND deleted_at IS NULL ORDER BY submitted_at ASC
export async function listPendingNotices() {
  const data = await graphql(
    `{ noticeses(where:{status:{eq:"pending"}, deletedAt:{isNull:true}},
        sort:[{field:submittedAt,direction:ASC}], limit:500){ ${selectionFor(APPROVED)} } }`,
  );
  return data.noticeses.map((r) => coerceRow(r, APPROVED));
}
