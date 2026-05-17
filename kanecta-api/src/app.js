'use strict';

const express = require('express');
const { Datastore, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE } = require('@kanecta/lib');

const app = express();
app.use(express.json());

function openDatastore(res) {
  const root = process.env.KANECTA_DATASTORE;
  if (!root) {
    res.status(503).json({ error: 'KANECTA_DATASTORE environment variable not set' });
    return null;
  }
  if (!Datastore.isDatastore(root)) {
    res.status(503).json({ error: `Not a Kanecta datastore: ${root}` });
    return null;
  }
  return new Datastore(root);
}

function isUuid(str) {
  return UUID_RE.test(str);
}

function withChildCounts(ds, items) {
  const all = ds.loadAll();
  const counts = new Map();
  for (const item of all) {
    if (item.id !== item.parentId && item.parentId != null) {
      counts.set(item.parentId, (counts.get(item.parentId) || 0) + 1);
    }
  }
  return items.map(item => ({ ...item, childCount: counts.get(item.id) || 0 }));
}

// ─── Items ────────────────────────────────────────────────────────────────────

// GET /items — list children of data_root (the user's top-level items)
app.get('/items', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const dataRoot = ds.getDataRoot();
  const items = dataRoot ? ds.children(dataRoot.id) : [];
  res.json(withChildCounts(ds, items));
});

// POST /items — create item
app.post('/items', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const { parentId = null, value = null, type = 'string', typeId = null,
    owner, license = null, sortOrder, confidence = null, tags = [],
    alias, createdBy } = req.body;

  if (!VALID_TYPES.includes(type))
    return res.status(400).json({ error: `Invalid type: ${type}. Valid: ${VALID_TYPES.join(', ')}` });
  if (confidence && !VALID_CONFIDENCES.includes(confidence))
    return res.status(400).json({ error: `Invalid confidence: ${confidence}. Valid: ${VALID_CONFIDENCES.join(', ')}` });
  if (parentId !== null && !isUuid(parentId))
    return res.status(400).json({ error: `Invalid parentId: ${parentId}` });
  if (parentId && !ds.get(parentId))
    return res.status(404).json({ error: `Parent not found: ${parentId}` });

  try {
    const item = ds.create({ parentId, value, type, typeId, owner, license, sortOrder, confidence, tags, createdBy });
    if (alias) ds.setAlias(alias, item.id);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /items/:id — get item
app.get('/items/:id', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  const item = ds.get(id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

// PUT /items/:id — update item
app.put('/items/:id', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });

  const body = req.body;
  const changes = {};
  if ('value' in body) changes.value = body.value;
  if ('type' in body) {
    if (!VALID_TYPES.includes(body.type))
      return res.status(400).json({ error: `Invalid type: ${body.type}` });
    changes.type = body.type;
  }
  if ('typeId' in body) changes.typeId = body.typeId;
  if ('parentId' in body) changes.parentId = body.parentId;
  if ('sortOrder' in body) changes.sortOrder = body.sortOrder;
  if ('confidence' in body) {
    if (body.confidence !== null && !VALID_CONFIDENCES.includes(body.confidence))
      return res.status(400).json({ error: `Invalid confidence: ${body.confidence}` });
    changes.confidence = body.confidence;
  }
  if ('license' in body) changes.license = body.license;
  if ('tags' in body) changes.tags = body.tags;

  try {
    const updated = ds.update(id, changes, body.actor);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /items/:id — delete item (?force=true to skip conflict check)
app.delete('/items/:id', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });

  const force = req.query.force === 'true' || req.query.force === '1';
  const warnings = ds.deleteWarnings(id);
  if (warnings.length && !force)
    return res.status(409).json({ error: 'Item has references. Use ?force=true to delete anyway.', warnings });

  const result = ds.delete(id);
  res.json({ deleted: id, ...result });
});

// GET /items/:id/children — list children of item
app.get('/items/:id/children', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(withChildCounts(ds, ds.children(id)));
});

// GET /items/:id/tree — tree rooted at item (?depth=n)
app.get('/items/:id/tree', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  const maxDepth = req.query.depth != null ? parseInt(req.query.depth, 10) : Infinity;
  if (isNaN(maxDepth) || maxDepth < 0)
    return res.status(400).json({ error: 'depth must be a non-negative integer' });
  res.json(ds.tree(id, maxDepth));
});

// GET /items/:id/annotations — list annotations
app.get('/items/:id/annotations', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(ds.annotations(id));
});

// POST /items/:id/annotations — add annotation
app.post('/items/:id/annotations', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  const { content, author, parentAnnotationId = null } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  const annotation = ds.annotate(id, { content, author, parentAnnotationId });
  res.status(201).json(annotation);
});

// GET /items/:id/relationships — get relationships
app.get('/items/:id/relationships', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(ds.relationships(id));
});

// GET /items/:id/backlinks — get backlinks
app.get('/items/:id/backlinks', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(ds.backlinks(id));
});

// GET /items/:id/history — get change history
app.get('/items/:id/history', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(ds.history(id));
});

// ─── Tree ─────────────────────────────────────────────────────────────────────

// GET /tree — full tree from all roots (?depth=n)
app.get('/tree', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const maxDepth = req.query.depth != null ? parseInt(req.query.depth, 10) : Infinity;
  if (isNaN(maxDepth) || maxDepth < 0)
    return res.status(400).json({ error: 'depth must be a non-negative integer' });
  res.json(ds.tree(null, maxDepth));
});

// ─── Aliases ──────────────────────────────────────────────────────────────────

// GET /aliases — list all aliases
app.get('/aliases', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  res.json(ds.listAliases());
});

// GET /aliases/:alias — resolve alias to UUID
app.get('/aliases/:alias', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const targetId = ds.resolveAlias(req.params.alias);
  if (!targetId) return res.status(404).json({ error: `Alias not found: ${req.params.alias}` });
  res.json({ alias: req.params.alias, targetId });
});

// POST /aliases — set alias { alias, targetId }
app.post('/aliases', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const { alias, targetId } = req.body;
  if (!alias) return res.status(400).json({ error: 'alias is required' });
  if (!targetId) return res.status(400).json({ error: 'targetId is required' });
  if (!isUuid(targetId)) return res.status(400).json({ error: 'Invalid UUID format for targetId' });
  if (!ds.get(targetId)) return res.status(404).json({ error: `Item not found: ${targetId}` });
  ds.setAlias(alias, targetId);
  res.status(201).json({ alias, targetId });
});

// DELETE /aliases/:alias — remove alias
app.delete('/aliases/:alias', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.resolveAlias(req.params.alias))
    return res.status(404).json({ error: `Alias not found: ${req.params.alias}` });
  ds.removeAlias(req.params.alias);
  res.json({ removed: req.params.alias });
});

// ─── Relationships ────────────────────────────────────────────────────────────

// GET /relationships — list all relationships
app.get('/relationships', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  res.json(ds.listRelationships());
});

// POST /relationships — create relationship { sourceId, type, targetId, note? }
app.post('/relationships', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const { sourceId, type, targetId, note = null, createdBy } = req.body;
  if (!sourceId || !type || !targetId)
    return res.status(400).json({ error: 'sourceId, type, and targetId are required' });
  if (!isUuid(sourceId)) return res.status(400).json({ error: 'Invalid UUID: sourceId' });
  if (!isUuid(targetId)) return res.status(400).json({ error: 'Invalid UUID: targetId' });
  if (!VALID_REL_TYPES.includes(type))
    return res.status(400).json({ error: `Invalid relationship type: ${type}. Valid: ${VALID_REL_TYPES.join(', ')}` });
  if (!ds.get(sourceId)) return res.status(404).json({ error: `Source not found: ${sourceId}` });
  if (!ds.get(targetId)) return res.status(404).json({ error: `Target not found: ${targetId}` });
  const rel = ds.relate(sourceId, type, targetId, { note, createdBy });
  res.status(201).json(rel);
});

// ─── Tags ─────────────────────────────────────────────────────────────────────

// GET /tags/:tag — list item IDs with this tag
app.get('/tags/:tag', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  res.json(ds.byTag(req.params.tag));
});

// ─── Index ────────────────────────────────────────────────────────────────────

// POST /rebuild-indexes — rebuild all index caches from data/
app.post('/rebuild-indexes', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const itemCount = ds.rebuildIndexes();
  res.json({ rebuilt: true, itemCount });
});

module.exports = app;
