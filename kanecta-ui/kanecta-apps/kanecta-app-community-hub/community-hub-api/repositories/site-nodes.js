// Data access for the `site_nodes` domain (the editable governance nav tree).
// Restored from the pre-0629 tree (the working-sets merge dropped the whole
// subsystem) and split into the repository seam: raw SQL stays here, kanecta
// reads/writes delegate to repositories/kanecta/site-nodes.js.
// Part of the repository seam — see repositories/licences.js.
import pool from "../db.js";
import { USE_KANECTA } from "./backend.js";
import * as kanecta from "./kanecta/site-nodes.js";

async function logHistory(client, nodeId, action, snapshot, userId, userName) {
  await client.query(
    `INSERT INTO site_node_history (node_id, action, snapshot, user_id, user_name)
     VALUES ($1, $2, $3, $4, $5)`,
    [nodeId, action, JSON.stringify(snapshot), userId, userName]
  );
}

// Full subtree rooted at the top-level slug; null when the root doesn't exist.
export async function getTree(rootSlug) {
  if (USE_KANECTA) return kanecta.getTree(rootSlug);
  const { rows } = await pool.query(
    `WITH RECURSIVE tree AS (
       SELECT id, parent_id, slug, title, node_type, component_name, metadata, sort_order, public
       FROM site_nodes
       WHERE slug = $1 AND parent_id IS NULL AND deleted_at IS NULL
       UNION ALL
       SELECT s.id, s.parent_id, s.slug, s.title, s.node_type, s.component_name, s.metadata, s.sort_order, s.public
       FROM site_nodes s
       JOIN tree t ON t.id = s.parent_id
       WHERE s.deleted_at IS NULL
     )
     SELECT * FROM tree ORDER BY sort_order`,
    [rootSlug]
  );
  if (!rows.length) return null;

  const map = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  let rootNode = null;
  for (const node of map.values()) {
    if (!node.parent_id) {
      rootNode = node;
    } else {
      map.get(node.parent_id)?.children.push(node);
    }
  }
  for (const node of map.values()) {
    node.children.sort((a, b) => a.sort_order - b.sort_order);
  }
  return rootNode;
}

// Direct children of a node, or the root nodes when parentId is null.
export async function listChildren(parentId) {
  if (USE_KANECTA) return kanecta.listChildren(parentId);
  if (!parentId) {
    const { rows } = await pool.query(
      `SELECT id, parent_id, slug, title, node_type, component_name, metadata, sort_order, public
       FROM site_nodes WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_order`
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT id, parent_id, slug, title, node_type, component_name, metadata, sort_order, public
     FROM site_nodes WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY sort_order`,
    [parentId]
  );
  return rows;
}

export async function getHistory(nodeId) {
  if (USE_KANECTA) return kanecta.getHistory(nodeId);
  const { rows } = await pool.query(
    `SELECT id, action, snapshot, user_name, created_at
     FROM site_node_history
     WHERE node_id = $1
     ORDER BY created_at DESC`,
    [nodeId]
  );
  return rows;
}

// INSERT + history row in one transaction. Returns the created node.
export async function createNode({ parentId, slug, title, nodeType, componentName, metadata, sortOrder }, userId, userName) {
  if (USE_KANECTA) return kanecta.createNode({ parentId, slug, title, nodeType, componentName, metadata, sortOrder }, userId, userName);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO site_nodes (parent_id, slug, title, node_type, component_name, metadata, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        parentId || null,
        slug,
        title.trim(),
        nodeType,
        componentName || null,
        metadata ? JSON.stringify(metadata) : "{}",
        sortOrder ?? 0,
      ]
    );
    const node = rows[0];
    await logHistory(client, node.id, "Created", node, userId, userName);
    await client.query("COMMIT");
    return node;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// COALESCE-style partial update + history row; null when the node is missing.
export async function updateNode(id, { title, slug, sortOrder, public: isPublic, metadata }, userId, userName) {
  if (USE_KANECTA) return kanecta.updateNode(id, { title, slug, sortOrder, public: isPublic, metadata }, userId, userName);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE site_nodes SET
         title      = COALESCE($2, title),
         slug       = COALESCE($3, slug),
         sort_order = COALESCE($4, sort_order),
         public     = COALESCE($5, public),
         metadata   = COALESCE($6, metadata),
         updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [
        id,
        title?.trim() || null,
        slug || null,
        sortOrder ?? null,
        isPublic ?? null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return null;
    }
    const node = rows[0];
    await logHistory(client, node.id, "Updated", node, userId, userName);
    await client.query("COMMIT");
    return node;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Soft delete + history row; null when the node is missing.
export async function softDeleteNode(id, userId, userName) {
  if (USE_KANECTA) return kanecta.softDeleteNode(id, userId, userName);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE site_nodes SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [id]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return null;
    }
    const node = rows[0];
    await logHistory(client, node.id, "Deleted", node, userId, userName);
    await client.query("COMMIT");
    return node;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
