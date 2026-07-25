// Site-nodes: the editable governance nav tree (sections → categories → pages).
// Restored from the pre-0629 tree; data access lives in repositories/site-nodes.js
// so the DATA_BACKEND switch covers this domain like every other.
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as siteNodes from "../repositories/site-nodes.js";

const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const requireModerator = requireRole("moderator");
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

// GET /api/site-nodes/tree?root=<slug>
// Returns full subtree rooted at the given top-level slug (public — all nav nodes are public).
router.get("/tree", wrap(async (req, res) => {
  const { root } = req.query;
  if (!root) return res.status(400).json({ error: "root query param required" });
  const rootNode = await siteNodes.getTree(root);
  if (!rootNode) return res.status(404).json({ error: "Not found" });
  res.json(rootNode);
}));

// GET /api/site-nodes/history/:id — moderator only
router.get("/history/:id", requireAuth, requireModerator, wrap(async (req, res) => {
  res.json(await siteNodes.getHistory(req.params.id));
}));

// GET /api/site-nodes?parentId=<uuid>
// Returns direct children of a node (or roots when parentId is omitted).
router.get("/", wrap(async (req, res) => {
  res.json(await siteNodes.listChildren(req.query.parentId || null));
}));

// POST /api/site-nodes — moderator only
router.post("/", requireAuth, requireModerator, wrap(async (req, res) => {
  const { parentId, slug, title, nodeType, componentName, metadata, sortOrder } = req.body;
  if (!slug || !SLUG_RE.test(slug)) return res.status(400).json({ error: "Invalid slug" });
  if (!title?.trim()) return res.status(400).json({ error: "title required" });
  if (!["index", "page", "component"].includes(nodeType)) {
    return res.status(400).json({ error: "nodeType must be index, page, or component" });
  }
  const node = await siteNodes.createNode(
    { parentId, slug, title, nodeType, componentName, metadata, sortOrder },
    req.user.id, req.user.name
  );
  res.status(201).json(node);
}));

// PUT /api/site-nodes/:id — moderator only
router.put("/:id", requireAuth, requireModerator, wrap(async (req, res) => {
  const { title, slug, sortOrder, public: isPublic, metadata } = req.body;
  if (slug !== undefined && !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: "Invalid slug" });
  }
  const node = await siteNodes.updateNode(
    req.params.id,
    { title, slug, sortOrder, public: isPublic, metadata },
    req.user.id, req.user.name
  );
  if (!node) return res.status(404).json({ error: "Not found" });
  res.json(node);
}));

// DELETE /api/site-nodes/:id — soft delete; moderator only
router.delete("/:id", requireAuth, requireModerator, wrap(async (req, res) => {
  const node = await siteNodes.softDeleteNode(req.params.id, req.user.id, req.user.name);
  if (!node) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

export default router;
