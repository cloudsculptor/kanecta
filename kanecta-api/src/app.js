'use strict';

const express = require('express');
const { Datastore, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE } = require('@kanecta/lib');

const app = express();
app.use(express.json());

const path = require('path');
const fs = require('fs');
const DEFAULT_DATASTORE = path.join(process.env.HOME || process.env.USERPROFILE, '.kanecta');

function openDatastore(res) {
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  if (!Datastore.isDatastore(root)) {
    res.status(503).json({
      error: `No Kanecta datastore found at ${root}. Run: cd kanecta-cli && npm run cli init --owner you@example.com`,
    });
    return null;
  }
  return Datastore.open(root);
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

function getAncestorChain(ds, id) {
  const ancestors = [];
  const seen = new Set([id]);
  let item = ds.get(id);
  while (item && item.parentId && item.parentId !== item.id && !seen.has(item.parentId)) {
    seen.add(item.parentId);
    const parent = ds.get(item.parentId);
    if (!parent) break;
    ancestors.unshift({ id: parent.id, value: parent.value, type: parent.type });
    item = parent;
  }
  return ancestors;
}

function collectSubtreeIds(ds, id) {
  const ids = [id];
  for (const child of ds.children(id)) {
    ids.push(...collectSubtreeIds(ds, child.id));
  }
  return ids;
}

function cloneSubtree(ds, sourceId, targetParentId, actor) {
  const source = ds.get(sourceId);
  if (!source) return null;
  const cloned = ds.create({
    parentId: targetParentId,
    value: source.value,
    type: source.type,
    typeId: source.typeId || null,
    tags: source.tags || [],
    confidence: source.confidence || null,
    license: source.license || null,
    owner: actor || source.owner,
  });
  for (const child of ds.children(sourceId)) {
    cloneSubtree(ds, child.id, cloned.id, actor);
  }
  return cloned;
}

// ─── Search ───────────────────────────────────────────────────────────────────

// GET /search?q=&rootId=&limit= — full-text search with optional subtree scope and ancestor breadcrumb
app.get('/search', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const { q, rootId, limit = '10' } = req.query;
  if (!q) return res.status(400).json({ error: 'q is required' });
  const maxResults = parseInt(limit, 10);
  if (isNaN(maxResults) || maxResults < 1)
    return res.status(400).json({ error: 'limit must be a positive integer' });
  if (rootId && !isUuid(rootId))
    return res.status(400).json({ error: 'Invalid UUID format for rootId' });
  if (rootId && !ds.get(rootId))
    return res.status(404).json({ error: `rootId not found: ${rootId}` });

  let candidates = ds.loadAll()
    .filter(i => i.value && typeof i.value === 'string' && i.value.toLowerCase().includes(q.toLowerCase()));

  if (rootId) {
    const subtreeIds = new Set(collectSubtreeIds(ds, rootId));
    candidates = candidates.filter(i => subtreeIds.has(i.id));
  }

  const results = candidates
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, maxResults)
    .map(item => ({ ...item, ancestors: getAncestorChain(ds, item.id) }));

  res.json({ query: q, count: results.length, results });
});

// ─── Items ────────────────────────────────────────────────────────────────────

// GET /items — list children of data_root (the user's top-level items)
app.get('/items', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const dataRoot = ds.getDataRoot();
  const items = dataRoot ? ds.children(dataRoot.id) : [];
  res.json(withChildCounts(ds, items));
});

// POST /items/bulk — create multiple items in one call
app.post('/items/bulk', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'items must be a non-empty array' });

  const created = [];
  const errors = [];
  for (const [i, itemArgs] of items.entries()) {
    const { parentId = null, value = null, type = 'string', typeId = null,
      owner, license = null, sortOrder, confidence = null, tags = [],
      alias, createdBy } = itemArgs;
    if (!VALID_TYPES.includes(type)) {
      errors.push({ index: i, error: `Invalid type: ${type}` });
      continue;
    }
    if (confidence && !VALID_CONFIDENCES.includes(confidence)) {
      errors.push({ index: i, error: `Invalid confidence: ${confidence}` });
      continue;
    }
    try {
      const item = ds.create({ parentId, value, type, typeId, owner, license, sortOrder, confidence, tags, createdBy });
      if (alias) ds.setAlias(alias, item.id);
      created.push(item);
    } catch (err) {
      errors.push({ index: i, error: err.message });
    }
  }

  const status = errors.length && created.length ? 207 : errors.length ? 400 : 201;
  res.status(status).json({ created, errors });
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

// PATCH /items/bulk — update multiple items in one call
app.patch('/items/bulk', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const { updates } = req.body;
  if (!Array.isArray(updates) || updates.length === 0)
    return res.status(400).json({ error: 'updates must be a non-empty array' });

  const updated = [];
  const errors = [];
  for (const [i, { id, ...changes }] of updates.entries()) {
    if (!id) { errors.push({ index: i, error: 'id is required' }); continue; }
    if (!isUuid(id)) { errors.push({ index: i, error: `Invalid UUID: ${id}` }); continue; }
    if (!ds.get(id)) { errors.push({ index: i, id, error: 'Not found' }); continue; }
    if ('type' in changes && !VALID_TYPES.includes(changes.type)) {
      errors.push({ index: i, id, error: `Invalid type: ${changes.type}` }); continue;
    }
    try {
      updated.push(ds.update(id, changes, req.body.actor));
    } catch (err) {
      errors.push({ index: i, id, error: err.message });
    }
  }

  const status = errors.length && updated.length ? 207 : errors.length ? 400 : 200;
  res.status(status).json({ updated, errors });
});

// GET /items/stats — type counts and quality score across all items (excludes *_root types)
app.get('/items/stats', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;

  // Build UUID → type name map from types directory
  const typeNames = {};
  const typesDir = path.join(root, 'types');
  if (fs.existsSync(typesDir)) {
    for (const s1 of fs.readdirSync(typesDir)) {
      const d1 = path.join(typesDir, s1);
      if (!fs.statSync(d1).isDirectory()) continue;
      for (const s2 of fs.readdirSync(d1)) {
        const d2 = path.join(d1, s2);
        if (!fs.statSync(d2).isDirectory()) continue;
        for (const id of fs.readdirSync(d2)) {
          const metaPath = path.join(d2, id, 'metadata.json');
          if (!fs.existsSync(metaPath)) continue;
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (meta.value) typeNames[id] = meta.value;
          } catch (_) {}
        }
      }
    }
  }

  const ROOT_TYPES = new Set(['root', 'data_root', 'app_root', 'component_root', 'system_root']);
  const typeCounts = {};
  let total = 0;
  let typedCount = 0;

  for (const item of ds.loadAll()) {
    const raw = item.type;
    if (!raw || ROOT_TYPES.has(raw)) continue;
    total++;
    const label = UUID_RE.test(raw) ? (typeNames[raw] ?? raw) : raw;
    typeCounts[label] = (typeCounts[label] || 0) + 1;
    if (label !== 'unknown') typedCount++;
  }

  res.json({ total, typedCount, typeCounts });
});

// GET /items/root — get the data_root item
app.get('/items/root', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const dataRoot = ds.getDataRoot();
  if (!dataRoot) return res.status(404).json({ error: 'data_root not found' });
  res.json(dataRoot);
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

// DELETE /items/:id — delete item and all descendants (?force=true to skip reference conflict check)
app.delete('/items/:id', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });

  const force = req.query.force === 'true' || req.query.force === '1';
  const ids = collectSubtreeIds(ds, id);

  if (!force) {
    const warnings = ids.flatMap(itemId => ds.deleteWarnings(itemId));
    if (warnings.length)
      return res.status(409).json({ error: 'Item or descendants have references. Use ?force=true to delete anyway.', warnings });
  }

  const deleted = ids.reverse();
  for (const itemId of deleted) ds.delete(itemId);
  res.json({ deleted });
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

// GET /items/:id/ancestors — full path from root down to this item's parent
app.get('/items/:id/ancestors', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(getAncestorChain(ds, id));
});

// POST /items/:id/clone — deep-copy item and all descendants under a new parent
app.post('/items/:id/clone', (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = openDatastore(res);
  if (!ds) return;
  if (!ds.get(id)) return res.status(404).json({ error: 'Item not found' });

  const { targetParentId, actor } = req.body;
  if (!targetParentId) return res.status(400).json({ error: 'targetParentId is required' });
  if (!isUuid(targetParentId)) return res.status(400).json({ error: 'Invalid UUID format for targetParentId' });
  if (!ds.get(targetParentId)) return res.status(404).json({ error: `Target parent not found: ${targetParentId}` });

  const cloned = cloneSubtree(ds, id, targetParentId, actor);
  res.status(201).json(cloned);
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

// ─── Types ────────────────────────────────────────────────────────────────────

// GET /types — list all type definitions from ~/.kanecta/types/
app.get('/types', (req, res) => {
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const typesDir = path.join(root, 'types');
  if (!fs.existsSync(typesDir)) return res.json([]);

  const results = [];
  try {
    for (const shard1 of fs.readdirSync(typesDir)) {
      const s1 = path.join(typesDir, shard1);
      if (!fs.statSync(s1).isDirectory()) continue;
      for (const shard2 of fs.readdirSync(s1)) {
        const s2 = path.join(s1, shard2);
        if (!fs.statSync(s2).isDirectory()) continue;
        for (const id of fs.readdirSync(s2)) {
          const metaPath = path.join(s2, id, 'metadata.json');
          if (!fs.existsSync(metaPath)) continue;
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            const typePath = path.join(s2, id, 'type.json');
            if (fs.existsSync(typePath)) {
              const typeDef = JSON.parse(fs.readFileSync(typePath, 'utf8'));
              if (typeDef.meta) {
                meta.icon        = typeDef.meta.icon ?? null;
                meta.description = typeDef.meta.description ?? null;
                meta.keywords    = typeDef.meta.keywords ?? null;
                meta.tags        = typeDef.meta.tags ?? null;
              }
            }
            results.push(meta);
          } catch (_) { /* skip malformed */ }
        }
      }
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  results.sort((a, b) => (a.value || '').localeCompare(b.value || ''));
  res.json(results);
});

// POST /types — create a new type definition
app.post('/types', (req, res) => {
  const ds = openDatastore(res);
  if (!ds) return;
  const { value } = req.body;
  if (!value || typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: 'value is required' });
  }
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  const now = new Date().toISOString();
  const owner = ds.config.owner;
  const shard1 = id.slice(0, 2);
  const shard2 = id.slice(2, 4);
  const typeDir = path.join(root, 'types', shard1, shard2, id);
  try {
    fs.mkdirSync(typeDir, { recursive: true });
    const metadata = { id, parentId: null, value: value.trim(), type: 'type', owner, createdAt: now, modifiedAt: now };
    fs.writeFileSync(path.join(typeDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
    const initialSchema = {
      meta: {
        icon: '',
        description: '',
        details: '',
        keywords: '',
        tags: '',
        'ai-instructions': { claude: '' },
      },
      jsonSchema: {
        '$schema': 'http://json-schema.org/draft-07/schema#',
        '$id': '',
        title: value.trim(),
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    };
    fs.writeFileSync(path.join(typeDir, 'type.json'), JSON.stringify(initialSchema, null, 2));
    res.status(201).json({ ...metadata, icon: null, description: null, keywords: null, tags: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /types/:id/schema — save updated type.json schema
app.put('/types/:id/schema', (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const typesDir = path.join(root, 'types');
  const shard1 = id.slice(0, 2);
  const shard2 = id.slice(2, 4);
  const schemaPath = path.join(typesDir, shard1, shard2, id, 'type.json');
  if (!fs.existsSync(schemaPath)) return res.status(404).json({ error: 'Schema not found' });

  let schema;
  try {
    schema = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return res.status(400).json({ error: 'Schema must be a JSON object' });
  }

  try {
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
    res.json(schema);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /types/:id — get the metadata.json for a type
app.get('/types/:id', (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const typesDir = path.join(root, 'types');
  const shard1 = id.slice(0, 2);
  const shard2 = id.slice(2, 4);
  const metaPath = path.join(typesDir, shard1, shard2, id, 'metadata.json');
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Type not found' });
  try {
    res.json(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /types/:id/schema — get the type.json schema for a type
app.get('/types/:id/schema', (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const typesDir = path.join(root, 'types');
  const shard1 = id.slice(0, 2);
  const shard2 = id.slice(2, 4);
  const schemaPath = path.join(typesDir, shard1, shard2, id, 'type.json');
  if (!fs.existsSync(schemaPath)) return res.status(404).json({ error: 'Schema not found' });
  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    res.json(schema);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Breadcrumb / History ─────────────────────────────────────────────────────

const BREADCRUMB_MAX = 100;
// CSV columns: id,name,type,typeId,timestamp
const HISTORY_NAMES = ['clipboard', 'viewed'];

function historyDir() {
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  return path.join(root, 'app', 'studio', 'history');
}

function ensureHistoryDir() {
  const dir = historyDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const name of HISTORY_NAMES) {
    const p = path.join(dir, `${name}.csv`);
    if (!fs.existsSync(p)) fs.writeFileSync(p, '');
  }
}

function historyFilePath(name) {
  ensureHistoryDir();
  return path.join(historyDir(), `${name}.csv`);
}

function readBreadcrumb(name) {
  const p = historyFilePath(name);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(',');
    // New format: id,name,type,typeId,timestamp (5 parts)
    // Old format: id,name,timestamp (3 parts) — backward compat
    if (parts.length >= 5) {
      return {
        id: parts[0],
        name: parts.slice(1, parts.length - 3).join(',') || parts[1],
        type: parts[parts.length - 3],
        typeId: parts[parts.length - 2],
        timestamp: parts[parts.length - 1],
      };
    }
    // Legacy 3-column rows
    const firstComma = line.indexOf(',');
    const lastComma = line.lastIndexOf(',');
    return {
      id: line.slice(0, firstComma),
      name: line.slice(firstComma + 1, lastComma),
      type: '',
      typeId: '',
      timestamp: line.slice(lastComma + 1),
    };
  });
}

function appendBreadcrumb(name, id, itemName, type, typeId) {
  const timestamp = new Date().toISOString();
  let entries = readBreadcrumb(name);
  const safeName = (itemName || '').replace(/,/g, ' ');
  const safeType = (type || '').replace(/,/g, ' ');
  const safeTypeId = (typeId || '').replace(/,/g, ' ');
  entries.push({ id, name: safeName, type: safeType, typeId: safeTypeId, timestamp });
  if (entries.length > BREADCRUMB_MAX) entries = entries.slice(entries.length - BREADCRUMB_MAX);
  const csv = entries.map((e) => `${e.id},${e.name},${e.type},${e.typeId},${e.timestamp}`).join('\n');
  fs.writeFileSync(historyFilePath(name), csv + '\n');
}

// Ensure history dir exists on startup
ensureHistoryDir();

// GET /breadcrumb/clipboard
app.get('/breadcrumb/clipboard', (_req, res) => {
  res.json(readBreadcrumb('clipboard').reverse());
});

// POST /breadcrumb/clipboard — append { id, name, type, typeId }
app.post('/breadcrumb/clipboard', (req, res) => {
  const { id, name, type = '', typeId = '' } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  appendBreadcrumb('clipboard', id, name, type, typeId);
  res.json({ ok: true });
});

// GET /breadcrumb/viewed
app.get('/breadcrumb/viewed', (_req, res) => {
  res.json(readBreadcrumb('viewed').reverse());
});

// POST /breadcrumb/viewed — append { id, name, type, typeId }
app.post('/breadcrumb/viewed', (req, res) => {
  const { id, name, type = '', typeId = '' } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  appendBreadcrumb('viewed', id, name, type, typeId);
  res.json({ ok: true });
});

// ─── Starred ─────────────────────────────────────────────────────────────────

function starredFilePath() {
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const studioDir = path.join(root, 'app', 'studio');
  const dir = path.join(studioDir, 'starred');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const newPath = path.join(dir, 'starred.csv');
  const oldPath = path.join(studioDir, 'starred.csv');
  if (!fs.existsSync(newPath) && fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
  }
  return newPath;
}

function readStarred() {
  const p = starredFilePath();
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(',');
    return {
      id: parts[0],
      name: parts.slice(1, parts.length - 3).join(',') || parts[1],
      type: parts[parts.length - 3] || '',
      typeId: parts[parts.length - 2] || '',
      timestamp: parts[parts.length - 1],
    };
  });
}

function writeStarred(entries) {
  const csv = entries.map((e) => `${e.id},${e.name},${e.type},${e.typeId},${e.timestamp}`).join('\n');
  fs.writeFileSync(starredFilePath(), entries.length ? csv + '\n' : '');
}

// GET /app/studio/starred
app.get('/app/studio/starred', (_req, res) => {
  res.json(readStarred().reverse());
});

// POST /app/studio/starred — upsert { id, name, type?, typeId? }
app.post('/app/studio/starred', (req, res) => {
  const { id, name, type = '', typeId = '' } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  const entries = readStarred().filter((e) => e.id !== id);
  const safeName = (name || '').replace(/,/g, ' ');
  entries.push({ id, name: safeName, type, typeId, timestamp: new Date().toISOString() });
  writeStarred(entries);
  res.json({ ok: true });
});

// DELETE /app/studio/starred/:id
app.delete('/app/studio/starred/:id', (req, res) => {
  const { id } = req.params;
  const entries = readStarred().filter((e) => e.id !== id);
  writeStarred(entries);
  res.json({ ok: true });
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
