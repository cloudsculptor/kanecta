import { Router } from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const requireModerator = requireRole("moderator");
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

// GET /api/site-nodes/tree?root=<slug>
// Returns full subtree rooted at the given top-level slug (no auth — all nodes are public nav).
router.get("/tree", wrap(async (req, res) => {
  const { root } = req.query;
  if (!root) return res.status(400).json({ error: "root query param required" });

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
    [root]
  );

  if (!rows.length) return res.status(404).json({ error: "Not found" });

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

  res.json(rootNode);
}));

// GET /api/site-nodes?parentId=<uuid>
// Returns direct children of a node (or roots when parentId is omitted).
router.get("/", wrap(async (req, res) => {
  const { parentId } = req.query;
  let rows;
  if (!parentId) {
    ({ rows } = await pool.query(
      `SELECT id, parent_id, slug, title, node_type, component_name, metadata, sort_order, public
       FROM site_nodes WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_order`
    ));
  } else {
    ({ rows } = await pool.query(
      `SELECT id, parent_id, slug, title, node_type, component_name, metadata, sort_order, public
       FROM site_nodes WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY sort_order`,
      [parentId]
    ));
  }
  res.json(rows);
}));

// POST /api/site-nodes — moderator only
router.post("/", requireAuth, requireModerator, wrap(async (req, res) => {
  const { parentId, slug, title, nodeType, componentName, metadata, sortOrder } = req.body;
  if (!slug || !SLUG_RE.test(slug)) return res.status(400).json({ error: "Invalid slug" });
  if (!title?.trim()) return res.status(400).json({ error: "title required" });
  if (!["index", "page", "component"].includes(nodeType)) {
    return res.status(400).json({ error: "nodeType must be index, page, or component" });
  }

  const { rows } = await pool.query(
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
  res.status(201).json(rows[0]);
}));

// PUT /api/site-nodes/:id — moderator only; update title, slug, sort_order, public, metadata
router.put("/:id", requireAuth, requireModerator, wrap(async (req, res) => {
  const { title, slug, sortOrder, public: isPublic, metadata } = req.body;
  if (slug !== undefined && !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: "Invalid slug" });
  }

  const { rows } = await pool.query(
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
      req.params.id,
      title?.trim() || null,
      slug || null,
      sortOrder ?? null,
      isPublic ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
}));

// DELETE /api/site-nodes/:id — soft delete; moderator only
router.delete("/:id", requireAuth, requireModerator, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE site_nodes SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

export default router;
