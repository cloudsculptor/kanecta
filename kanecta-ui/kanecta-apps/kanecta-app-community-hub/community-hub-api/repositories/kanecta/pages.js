// KanectaRepository — pages reads over kanecta-api (GraphQL). The by-slug reads add
// the licence/group name (a LEFT JOIN in pg) with a follow-up point lookup — the
// FK is preserved as both a data field (licence_id / owner_id) and a relates-to
// edge; here we resolve the display name via the id.
import { graphql, transaction, resolveTypeId, newId, ROOT_ID, OWNER } from "../../lib/kanectaClient.js";
import { coerceRow, selectionFor } from "../../lib/kanectaMap.js";

const LIST = [
  ["id", "id"], ["slug", "text"], ["title", "text"], ["created_by_name", "text"],
  ["created_at", "timestamp"], ["updated_at", "timestamp"], ["public", "bool"],
  ["licence_id", "ref"], ["version", "int"], ["owner_type", "text"], ["owner_id", "ref"],
];
// p.* — full column set for the by-slug detail reads.
const STAR = [
  ["id", "id"], ["slug", "text"], ["title", "text"], ["content_json", "json"],
  ["created_by_id", "text"], ["created_by_name", "text"], ["created_at", "timestamp"],
  ["updated_at", "timestamp"], ["licence_id", "ref"], ["public", "bool"], ["version", "int"],
  ["owner_type", "text"], ["owner_id", "ref"], ["deleted_at", "timestamp"],
];

// pg: WHERE deleted_at IS NULL ORDER BY updated_at DESC
export async function listPages() {
  const data = await graphql(
    `{ pageses(where:{deletedAt:{isNull:true}}, sort:[{field:updatedAt,direction:DESC}],
        limit:500){ ${selectionFor(LIST)} } }`,
  );
  return data.pageses.map((r) => coerceRow(r, LIST));
}

// pg: WHERE public=TRUE AND deleted_at IS NULL ORDER BY updated_at DESC
export async function listPublicPages() {
  const data = await graphql(
    `{ pageses(where:{public:{eq:true}, deletedAt:{isNull:true}},
        sort:[{field:updatedAt,direction:DESC}], limit:500){ ${selectionFor(LIST)} } }`,
  );
  return data.pageses.map((r) => coerceRow(r, LIST));
}

// Resolve a licence's display name by id (LEFT JOIN licences l ON l.id=p.licence_id).
async function licenceName(id) {
  if (!id) return null;
  const data = await graphql(`query($id:ID){ licenceses(where:{id:{eq:$id}}, limit:1){ name } }`, { id });
  return data.licenceses[0]?.name ?? null;
}
// Resolve a group's display name by id (LEFT JOIN groups g ON g.id=p.owner_id).
async function groupName(id) {
  if (!id) return null;
  const data = await graphql(`query($id:ID){ groupses(where:{id:{eq:$id}}, limit:1){ name } }`, { id });
  return data.groupses[0]?.name ?? null;
}

async function pageBySlug(slug, publicOnly) {
  const pub = publicOnly ? "public:{eq:true}, " : "";
  const data = await graphql(
    `query($s:String){ pageses(where:{slug:{eq:$s}, ${pub}deletedAt:{isNull:true}}, limit:1){ ${selectionFor(STAR)} } }`,
    { s: slug },
  );
  const gql = data.pageses[0];
  if (!gql) return null;
  const row = coerceRow(gql, STAR);
  row.licence_name = await licenceName(row.licence_id);
  row.group_name = await groupName(row.owner_id);
  return row;
}

// pg: SELECT p.*, l.name AS licence_name, g.name AS group_name … WHERE slug=$1 AND public AND not deleted
export async function getPublicPageBySlug(slug) { return pageBySlug(slug, true); }
// pg: … WHERE slug=$1 AND not deleted
export async function getPageBySlug(slug) { return pageBySlug(slug, false); }

// { id } for any page with this slug (includes deleted — history lookup).
export async function getPageIdBySlug(slug) {
  const data = await graphql(`query($s:String){ pageses(where:{slug:{eq:$s}}, limit:1){ id } }`, { s: slug });
  return data.pageses[0] ? { id: data.pageses[0].id } : null;
}
// { id, title } for any page with this slug.
export async function getPageIdTitleBySlug(slug) {
  const data = await graphql(`query($s:String){ pageses(where:{slug:{eq:$s}}, limit:1){ id title } }`, { s: slug });
  return data.pageses[0] ? { id: data.pageses[0].id, title: data.pageses[0].title } : null;
}
// { id } for a LIVE (non-deleted) page with this slug.
export async function getLivePageIdBySlug(slug) {
  const data = await graphql(
    `query($s:String){ pageses(where:{slug:{eq:$s}, deletedAt:{isNull:true}}, limit:1){ id } }`, { s: slug });
  return data.pageses[0] ? { id: data.pageses[0].id } : null;
}

// Read one page back as a pg-shaped p.* row (no licence/group name — matches RETURNING *).
async function readPageStar(id) {
  const data = await graphql(
    `query($id:ID){ pageses(where:{id:{eq:$id}}, limit:1){ ${selectionFor(STAR)} } }`, { id });
  return data.pageses[0] ? coerceRow(data.pageses[0], STAR) : null;
}

// pg: BEGIN; INSERT page (public=FALSE, version=1); INSERT page_history(Created,
// version 1); COMMIT — returns the page row. The atomic multi-item write is the
// point of Phase C: two create ops in ONE POST /transaction (PR #142), so the page
// and its initial history row commit together or not at all.
export async function createPageWithHistory({
  slug, title, contentJson, createdById, createdByName, licenceId, ownerType, ownerId,
}) {
  const [pageType, historyType] = await Promise.all([
    resolveTypeId("pages"), resolveTypeId("page-history"),
  ]);
  const pageId = newId();
  const now = new Date().toISOString();
  // content_json (jsonb in the source) projects to a string property, so it is
  // stored JSON-encoded; the read path parses it back (STAR `json` kind).
  const contentStr = JSON.stringify(contentJson || {});
  await transaction([
    {
      op: "create", id: pageId, type: "object", typeId: pageType, parentId: ROOT_ID, owner: OWNER,
      objectData: {
        slug, title: title || "", contentJson: contentStr, createdById, createdByName,
        licenceId: licenceId || null, public: false, version: 1,
        ownerType: ownerType || "group", ownerId: ownerId ?? null, createdAt: now, updatedAt: now,
      },
    },
    {
      op: "create", id: newId(), type: "object", typeId: historyType, parentId: ROOT_ID, owner: OWNER,
      objectData: {
        pageId, action: "Created", version: 1, contentJson: contentStr,
        licenceId: licenceId || null, userId: createdById, userName: createdByName, createdAt: now,
      },
    },
  ]);
  return readPageStar(pageId);
}
