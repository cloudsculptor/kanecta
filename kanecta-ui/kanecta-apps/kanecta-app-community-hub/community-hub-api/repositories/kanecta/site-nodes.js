// KanectaRepository — site-nodes over kanecta-api (GraphQL). The legacy pg
// recursive CTE for /tree becomes a fetch-all + in-memory tree build (the whole
// nav is a few dozen nodes). History rows are site-node-history items; writes go
// through /transaction so node + history land atomically, mirroring the pg
// BEGIN/COMMIT pairs.
import { graphql, transaction, updateObject, getItem, resolveTypeId, newId, ROOT_ID, OWNER } from "../../lib/kanectaClient.js";
import { coerceRow, selectionFor } from "../../lib/kanectaMap.js";

const NODE_STAR = [
  ["id", "id"], ["parent_id", "ref"], ["slug", "text"], ["title", "text"],
  ["node_type", "text"], ["component_name", "text"], ["page_id", "ref"],
  ["metadata", "json"], ["sort_order", "int"], ["public", "bool"],
  ["created_at", "timestamp"], ["updated_at", "timestamp"], ["deleted_at", "timestamp"],
];

const HISTORY_STAR = [
  ["id", "id"], ["action", "text"], ["snapshot", "json"],
  ["user_name", "text"], ["created_at", "timestamp"],
];

// The json kind in coerceRow parses the stored JSON text back to an object;
// legacy pg columns were NOT NULL DEFAULT '{}', so keep that guarantee.
function coerceNode(gql) {
  const row = coerceRow(gql, NODE_STAR);
  row.metadata = row.metadata ?? {};
  return row;
}

async function allLiveNodes() {
  const data = await graphql(
    `{ siteNodeses(where:{deletedAt:{isNull:true}}, limit:500){ ${selectionFor(NODE_STAR)} } }`,
  );
  return data.siteNodeses.map(coerceNode);
}

// pg: WITH RECURSIVE tree AS (… WHERE slug=$1 AND parent_id IS NULL …) SELECT *
export async function getTree(rootSlug) {
  const nodes = await allLiveNodes();
  const map = new Map(nodes.map((n) => [n.id, { ...n, children: [] }]));
  let root = null;
  for (const node of map.values()) {
    if (!node.parent_id) {
      if (node.slug === rootSlug) root = node;
    } else {
      map.get(node.parent_id)?.children.push(node);
    }
  }
  if (!root) return null;
  for (const node of map.values()) node.children.sort((a, b) => a.sort_order - b.sort_order);
  return root;
}

// pg: SELECT … WHERE parent_id = $1 / parent_id IS NULL ORDER BY sort_order
export async function listChildren(parentId) {
  const nodes = await allLiveNodes();
  return nodes
    .filter((n) => (parentId ? n.parent_id === parentId : !n.parent_id))
    .sort((a, b) => a.sort_order - b.sort_order);
}

// pg: SELECT id, action, snapshot, user_name, created_at FROM site_node_history …
export async function getHistory(nodeId) {
  const data = await graphql(
    `query($n:ID){ siteNodeHistories(where:{nodeId:{eq:$n}},
        sort:[{field:createdAt,direction:DESC}], limit:500){ ${selectionFor(HISTORY_STAR)} } }`,
    { n: nodeId },
  );
  return data.siteNodeHistories.map((r) => {
    const row = coerceRow(r, HISTORY_STAR);
    row.snapshot = row.snapshot ?? {};
    return row;
  });
}

function historyOp(historyTypeId, nodeId, action, snapshot, userId, userName) {
  return {
    op: "create",
    item: {
      id: newId(), type: "object", typeId: historyTypeId, parentId: ROOT_ID, owner: OWNER,
      objectData: {
        nodeId, action, snapshot: JSON.stringify(snapshot),
        userId, userName, createdAt: new Date().toISOString(),
      },
    },
  };
}

function nodePayload(row) {
  return {
    parentId: row.parent_id, slug: row.slug, title: row.title, nodeType: row.node_type,
    componentName: row.component_name, pageId: row.page_id,
    metadata: JSON.stringify(row.metadata ?? {}), sortOrder: row.sort_order,
    public: row.public, createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

// pg: INSERT INTO site_nodes … + INSERT INTO site_node_history, one transaction.
export async function createNode({ parentId, slug, title, nodeType, componentName, metadata, sortOrder }, userId, userName) {
  const [typeId, historyTypeId] = await Promise.all([
    resolveTypeId("site-nodes"), resolveTypeId("site-node-history"),
  ]);
  const now = new Date().toISOString();
  const row = {
    id: newId(), parent_id: parentId || null, slug, title: title.trim(),
    node_type: nodeType, component_name: componentName || null, page_id: null,
    metadata: metadata ?? {}, sort_order: sortOrder ?? 0, public: true,
    created_at: now, updated_at: now, deleted_at: null,
  };
  await transaction([
    {
      op: "create",
      item: { id: row.id, type: "object", typeId, parentId: ROOT_ID, owner: OWNER, objectData: nodePayload(row) },
    },
    historyOp(historyTypeId, row.id, "Created", row, userId, userName),
  ]);
  return { ...row, children: [] };
}

async function readNode(id) {
  const data = await graphql(
    `query($id:ID){ siteNodeses(where:{id:{eq:$id}, deletedAt:{isNull:true}}, limit:1){ ${selectionFor(NODE_STAR)} } }`,
    { id },
  );
  return data.siteNodeses[0] ? coerceNode(data.siteNodeses[0]) : null;
}

// pg: UPDATE site_nodes SET … COALESCE … + history row, one transaction.
export async function updateNode(id, { title, slug, sortOrder, public: isPublic, metadata }, userId, userName) {
  const current = await readNode(id);
  if (!current) return null;
  const historyTypeId = await resolveTypeId("site-node-history");
  const row = {
    ...current,
    title: title?.trim() || current.title,
    slug: slug || current.slug,
    sort_order: sortOrder ?? current.sort_order,
    public: isPublic ?? current.public,
    metadata: metadata ?? current.metadata,
    updated_at: new Date().toISOString(),
  };
  await transaction([
    { op: "update", id, changes: { objectData: nodePayload(row) } },
    historyOp(historyTypeId, id, "Updated", row, userId, userName),
  ]);
  return row;
}

// pg: UPDATE site_nodes SET deleted_at = NOW() … + history row, one transaction.
export async function softDeleteNode(id, userId, userName) {
  const current = await readNode(id);
  if (!current) return null;
  const historyTypeId = await resolveTypeId("site-node-history");
  const now = new Date().toISOString();
  const row = { ...current, deleted_at: now, updated_at: now };
  await transaction([
    { op: "update", id, changes: { objectData: nodePayload(row) } },
    historyOp(historyTypeId, id, "Deleted", row, userId, userName),
  ]);
  return row;
}
