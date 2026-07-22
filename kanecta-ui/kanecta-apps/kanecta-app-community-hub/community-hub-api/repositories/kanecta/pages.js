// KanectaRepository — pages reads over kanecta-api (GraphQL). The by-slug reads add
// the licence/group name (a LEFT JOIN in pg) with a follow-up point lookup — the
// FK is preserved as both a data field (licence_id / owner_id) and a relates-to
// edge; here we resolve the display name via the id.
import { graphql, transaction, updateObject, getItem, resolveTypeId, newId, ROOT_ID, OWNER } from "../../lib/kanectaClient.js";
import { coerceRow, selectionFor } from "../../lib/kanectaMap.js";

const PUBLIC_URL = process.env.SPACES_PUBLIC_URL;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Walk a Lexical JSON tree for the file UUIDs referenced by image nodes (mirrors
// the pg repo's extractFileIds — the file id is the 3rd path segment after the
// public URL prefix).
function extractFileIds(contentJson) {
  const ids = new Set();
  if (!PUBLIC_URL || !contentJson?.root) return ids;
  const prefix = PUBLIC_URL + "/";
  const walk = (node) => {
    if (!node) return;
    if (node.type === "image" && typeof node.src === "string" && node.src.startsWith(prefix)) {
      const id = node.src.slice(prefix.length).split("/")[2];
      if (id && UUID_RE.test(id)) ids.add(id);
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(contentJson.root);
  return ids;
}

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

// page_history projection for getPageHistory (list) and getPageVersion (detail).
const HISTORY_LIST = [
  ["id", "id"], ["action", "text"], ["version", "int"], ["user_name", "text"], ["created_at", "timestamp"],
  ["licence_id", "ref"],
];
const HISTORY_VERSION = [
  ["version", "int"], ["action", "text"], ["content_json", "json"], ["user_name", "text"],
  ["created_at", "timestamp"], ["licence_id", "ref"],
];

// pg: SELECT ph.id, ph.action, ph.version, ph.user_name, ph.created_at,
//     l.name AS licence_name FROM page_history ph LEFT JOIN licences l
//     WHERE ph.page_id=$1 ORDER BY ph.created_at DESC
export async function getPageHistory(pageId) {
  const data = await graphql(
    `query($p:ID){ pageHistories(where:{pageId:{eq:$p}}, sort:[{field:createdAt,direction:DESC}],
        limit:500){ ${selectionFor(HISTORY_LIST)} } }`,
    { p: pageId },
  );
  const rows = data.pageHistories.map((r) => coerceRow(r, HISTORY_LIST));
  for (const row of rows) {
    row.licence_name = await licenceName(row.licence_id);
    delete row.licence_id; // pg projection selects only licence_name, not licence_id
  }
  return rows;
}

// pg: SELECT ph.version, ph.action, ph.content_json, ph.user_name, ph.created_at,
//     l.name AS licence_name ... WHERE ph.page_id=$1 AND ph.version=$2 → row or null
export async function getPageVersion(pageId, version) {
  const data = await graphql(
    `query($p:ID,$v:Int){ pageHistories(where:{pageId:{eq:$p}, version:{eq:$v}}, limit:1){ ${selectionFor(HISTORY_VERSION)} } }`,
    { p: pageId, v: version },
  );
  const gql = data.pageHistories[0];
  if (!gql) return null;
  const row = coerceRow(gql, HISTORY_VERSION);
  row.licence_name = await licenceName(row.licence_id);
  delete row.licence_id;
  return row;
}

// pg: UPDATE pages SET deleted_at=NOW() WHERE slug=$1 (unconditional). Resolve the
// page item id by slug, then resend the full payload with the new deleted_at.
export async function softDeletePage(slug) {
  const found = await graphql(`query($s:String){ pageses(where:{slug:{eq:$s}}, limit:1){ id } }`, { s: slug });
  const id = found.pageses[0]?.id;
  if (!id) return;
  const item = await getItem(id);
  if (!item?.payload) return;
  await updateObject(id, { ...item.payload, deletedAt: new Date().toISOString() });
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

// pg: BEGIN; UPDATE pages SET ... version+1 WHERE slug=currentSlug; soft-delete the
// image files removed from content_json; INSERT page_history; COMMIT. Returns
// { row, action } or null if no page has currentSlug. Composed as ONE atomic
// /transaction (page update + a soft-delete update per removed file + history create).
export async function updatePageWithHistory({
  currentSlug, targetSlug, title, contentJson, licenceId, isPublic, ownerType, ownerId, userId, userName,
}) {
  const found = await graphql(`query($s:String){ pageses(where:{slug:{eq:$s}}, limit:1){ id } }`, { s: currentSlug });
  const pageId = found.pageses[0]?.id;
  if (!pageId) return null;
  const item = await getItem(pageId);
  const p = item?.payload;
  if (!p) return null;

  const oldPublic = !!p.public;
  const newPublic = isPublic !== undefined ? isPublic : oldPublic;
  const newVersion = (p.version || 0) + 1;
  let action = "Updated";
  if (!oldPublic && newPublic) action = "Published";
  else if (oldPublic && !newPublic) action = "Unpublished";

  // content_json is stored JSON-encoded; parse the existing one to diff image files.
  const oldContent = typeof p.contentJson === "string" ? JSON.parse(p.contentJson || "{}") : (p.contentJson || {});
  const oldFileIds = extractFileIds(oldContent);
  const newFileIds = extractFileIds(contentJson);
  const removed = [...oldFileIds].filter((id) => !newFileIds.has(id));
  const contentStr = JSON.stringify(contentJson || {});
  const now = new Date().toISOString();
  const newLicence = licenceId !== undefined ? (licenceId || null) : null;
  const newOwnerId = ownerId !== undefined ? (ownerId || null) : null;

  const historyType = await resolveTypeId("page-history");
  const ops = [
    {
      op: "update", id: pageId,
      changes: { objectData: {
        ...normalizePagePayload(p),
        slug: targetSlug, title: title || "", contentJson: contentStr, updatedAt: now,
        licenceId: newLicence, public: newPublic, version: newVersion,
        // pg: owner_type = COALESCE($ownerType, owner_type) — keep existing when null.
        ownerType: ownerType || p.ownerType || null, ownerId: newOwnerId,
      } },
    },
  ];
  // Soft-delete each removed image file that isn't already deleted.
  for (const fid of removed) {
    const fitem = await getItem(fid);
    const fp = fitem?.payload;
    if (!fp || fp.deletedAt != null) continue;
    ops.push({ op: "update", id: fid, changes: { objectData: { ...normalizeFilePayload(fp), deletedAt: now } } });
  }
  ops.push({
    op: "create", id: newId(), type: "object", typeId: historyType, parentId: ROOT_ID, owner: OWNER,
    objectData: {
      pageId, action, version: newVersion, contentJson: contentStr,
      licenceId: newLicence, userId, userName, createdAt: now,
    },
  });

  await transaction(ops);
  return { row: await readPageStar(pageId), action };
}

// A page payload from GET /items carries FK columns (licence_id, owner_id) as
// resolved { id } objects; writeObjectJson wants the scalar ids back.
function normalizePagePayload(p) {
  return { ...p, licenceId: p.licenceId?.id ?? p.licenceId ?? null, ownerId: p.ownerId?.id ?? p.ownerId ?? null };
}
// A file payload's FK-free columns are already scalar; just pass through (kept as a
// hook symmetric with normalizePagePayload in case files gain refs).
function normalizeFilePayload(p) {
  return { ...p };
}
