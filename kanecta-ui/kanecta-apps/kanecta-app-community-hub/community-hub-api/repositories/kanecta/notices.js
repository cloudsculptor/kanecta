// KanectaRepository — notices reads over kanecta-api (GraphQL). The legacy filters
// on deleted_at (soft delete) reproduce because the backfill ran with
// exposeSoftDelete, so `deletedAt` is a normal filterable field.
import { graphql, createItem, updateObject, getItem, resolveTypeId, ROOT_ID, OWNER } from "../../lib/kanectaClient.js";
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

// pg: INSERT INTO notices (heading, body, notice_date, submitted_by_id,
//     submitted_by_name) VALUES (...) RETURNING id. status defaults to 'pending',
//     submitted_at to NOW(); the remaining columns are null.
export async function createNotice({ heading, body, noticeDate, submittedById, submittedByName }) {
  const typeId = await resolveTypeId("notices");
  const item = await createItem({
    type: "object", typeId, parentId: ROOT_ID, owner: OWNER,
    objectData: {
      heading, body, noticeDate, status: "pending",
      submittedById, submittedByName, submittedAt: new Date().toISOString(),
      declineReason: null, reviewedById: null, reviewedByName: null, reviewedAt: null, deletedAt: null,
    },
  });
  return { id: item.id };
}

// pg: SELECT submitted_by_id FROM notices WHERE id=$1 AND deleted_at IS NULL → owner id or null
export async function getNoticeOwner(id) {
  const data = await graphql(
    `query($id:ID){ noticeses(where:{id:{eq:$id}, deletedAt:{isNull:true}}, limit:1){ submittedById } }`,
    { id },
  );
  return data.noticeses[0]?.submittedById ?? null;
}

// pg: UPDATE notices SET deleted_at=NOW() WHERE id=$1 (unconditional). Resend the
// full payload (writeObjectJson validates against the whole schema) with the new
// deleted_at.
export async function softDeleteNotice(id) {
  const item = await getItem(id);
  if (!item?.payload) return;
  await updateObject(id, { ...item.payload, deletedAt: new Date().toISOString() });
}

// pg: UPDATE ... SET status='approved', reviewed_* WHERE id=$3 AND status='pending'
//     AND deleted_at IS NULL RETURNING id → { id } or undefined.
export async function approveNotice({ id, reviewedById, reviewedByName }) {
  const item = await getItem(id);
  const p = item?.payload;
  if (!p || p.status !== "pending" || p.deletedAt != null) return undefined;
  await updateObject(id, {
    ...p, status: "approved", reviewedById, reviewedByName, reviewedAt: new Date().toISOString(),
  });
  return { id };
}

// pg: UPDATE ... SET status='declined', decline_reason, reviewed_* WHERE id=$4 AND
//     status='pending' AND deleted_at IS NULL RETURNING id → { id } or undefined.
export async function declineNotice({ id, declineReason, reviewedById, reviewedByName }) {
  const item = await getItem(id);
  const p = item?.payload;
  if (!p || p.status !== "pending" || p.deletedAt != null) return undefined;
  await updateObject(id, {
    ...p, status: "declined", declineReason, reviewedById, reviewedByName, reviewedAt: new Date().toISOString(),
  });
  return { id };
}
