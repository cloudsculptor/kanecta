'use strict';

const express = require('express');
const { Datastore, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE } = require('@kanecta/lib');
const claude = require('@kanecta/ai');
const { generateFunctionScaffold, toCamelCase } = require('./generateFunctionCode');
const { spawnSync, spawn } = require('child_process');
const { createHash } = require('crypto');

function hashIndexTs(fnDir) {
  try {
    const src = fs.readFileSync(path.join(fnDir, 'index.ts'), 'utf8');
    return createHash('sha256').update(src).digest('hex');
  } catch { return null; }
}

function readBuildHash(fnDir) {
  try { return fs.readFileSync(path.join(fnDir, '.build-hash'), 'utf8').trim(); } catch { return null; }
}

function writeBuildHash(fnDir) {
  const hash = hashIndexTs(fnDir);
  if (hash) fs.writeFileSync(path.join(fnDir, '.build-hash'), hash + '\n', 'utf8');
}

const app = express();
app.use(express.json());

const path = require('path');
const fs = require('fs');
const DEFAULT_DATASTORE = path.join(process.env.HOME || process.env.USERPROFILE, '.kanecta');

function readAppConfig() {
  const os = require('os');
  const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  try {
    return JSON.parse(fs.readFileSync(path.join(XDG_CONFIG, 'kanecta', 'config.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function openDatastore(res) {
  // Workspace mode: ~/.config/kanecta/config.json has named workspaces → resolve
  // by KANECTA_WORKSPACE env (set by ensure-datastore's launcher) or config.default
  const appCfg = readAppConfig();
  if (appCfg?.workspaces) {
    const name = process.env.KANECTA_WORKSPACE || appCfg.default;
    const workspace = appCfg.workspaces[name];
    if (!workspace) {
      res.status(503).json({ error: `Workspace '${name}' not found in ~/.config/kanecta/config.json` });
      return null;
    }
    try {
      return await Datastore.openWorkspace(workspace);
    } catch (err) {
      res.status(503).json({ error: `Failed to open workspace '${name}': ${err.message}` });
      return null;
    }
  }

  // Filesystem fallback (no config.json yet — first run, or pre-migration)
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

function isSyntheticId(str) {
  return typeof str === 'string' && str.includes('__');
}

function isValidId(str) {
  return isUuid(str) || isSyntheticId(str);
}

async function withChildCounts(ds, items) {
  const all = await ds.loadAll();
  const counts = new Map();
  for (const item of all) {
    if (item.id !== item.parentId && item.parentId != null) {
      counts.set(item.parentId, (counts.get(item.parentId) || 0) + 1);
    }
  }
  return Promise.all(items.map(async item => {
    if (item._synthetic) return item;
    const realCount = counts.get(item.id) || 0;
    const obj = await ds.readObjectJson(item.id);
    const synCount = obj ? Object.keys(obj).length : 0;
    return { ...item, childCount: realCount + synCount, _hasObject: synCount > 0 };
  }));
}

async function getAncestorChain(ds, id) {
  const ancestors = [];
  const seen = new Set([id]);
  let item = await ds.get(id);
  while (item && item.parentId && item.parentId !== item.id && !seen.has(item.parentId)) {
    seen.add(item.parentId);
    const parent = await ds.get(item.parentId);
    if (!parent) break;
    ancestors.unshift({ id: parent.id, value: parent.value, type: parent.type });
    item = parent;
  }
  return ancestors;
}

async function collectSubtreeIds(ds, id) {
  const ids = [id];
  for (const child of await ds.children(id)) {
    ids.push(...await collectSubtreeIds(ds, child.id));
  }
  return ids;
}

async function cloneSubtree(ds, sourceId, targetParentId, actor) {
  const source = await ds.get(sourceId);
  if (!source) return null;
  const cloned = await ds.create({
    parentId: targetParentId,
    value: source.value,
    type: source.type,
    typeId: source.typeId || null,
    tags: source.tags || [],
    confidence: source.confidence || null,
    status: source.status || null,
    license: source.license || null,
    owner: actor || source.owner,
  });
  for (const child of await ds.children(sourceId)) {
    await cloneSubtree(ds, child.id, cloned.id, actor);
  }
  return cloned;
}

// ─── Search ───────────────────────────────────────────────────────────────────

function matchObjectData(objectData, q, fields) {
  if (!objectData || typeof objectData !== 'object') return false;

  const keys = Array.isArray(fields) && fields.length > 0
    ? fields
    : Object.keys(objectData);

  for (const key of keys) {
    const val = objectData[key];
    if (val === null || val === undefined) continue;

    if (typeof val === 'object') {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item !== null && typeof item !== 'object') {
            const strVal = String(item).toLowerCase();
            if (strVal.includes(q)) return true;
          }
        }
      }
      continue;
    }

    if (typeof val === 'string' && val.length > 10000) {
      continue;
    }

    const strVal = String(val).toLowerCase();
    if (strVal.includes(q)) return true;
  }

  return false;
}

// GET /config — datastore configuration visible to the studio
app.get('/config', async (req, res) => {
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const vscodeCheck = spawnSync(whichCmd, ['code'], { encoding: 'utf8' });
  res.json({ datastorePath: root, vscodeAvailable: vscodeCheck.status === 0 });
});

// POST /open-in-vscode — open a path in VS Code
app.post('/open-in-vscode', async (req, res) => {
  const { path: targetPath } = req.body;
  if (!targetPath || typeof targetPath !== 'string') {
    return res.status(400).json({ error: 'path is required' });
  }
  spawnSync('code', [targetPath], { shell: false });
  res.json({ ok: true });
});

// POST /open-path — open a local directory in the OS file manager
app.post('/open-path', async (req, res) => {
  const { path: targetPath } = req.body;
  if (!targetPath || typeof targetPath !== 'string') {
    return res.status(400).json({ error: 'path is required' });
  }
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawnSync(opener, [targetPath], { shell: false });
  res.json({ ok: true });
});

// POST /open-in-browser — open a file:// URL in the default web browser
app.post('/open-in-browser', async (req, res) => {
  const { path: targetPath } = req.body;
  if (!targetPath || typeof targetPath !== 'string') {
    return res.status(400).json({ error: 'path is required' });
  }
  const url = `file://${targetPath}`;
  if (process.platform === 'darwin') {
    spawnSync('open', [url], { shell: false });
  } else if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'start', '', url], { shell: false });
  } else {
    // Linux: try BROWSER env var, then sensible-browser, then common browsers
    const candidates = [
      process.env.BROWSER,
      'sensible-browser',
      'firefox',
      'chromium-browser',
      'chromium',
      'google-chrome',
    ].filter(Boolean);
    for (const browser of candidates) {
      const found = spawnSync('which', [browser], { encoding: 'utf8' });
      if (found.status === 0) {
        spawnSync(browser, [url], { shell: false, detached: true });
        break;
      }
    }
  }
  res.json({ ok: true });
});

// GET /search?q=&rootId=&limit=&fields= — full-text search with optional subtree scope, ancestor breadcrumb, and fields scoping
app.get('/search', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const { q, rootId, limit = '10', fields } = req.query;
  if (!q) return res.status(400).json({ error: 'q is required' });
  const maxResults = parseInt(limit, 10);
  if (isNaN(maxResults) || maxResults < 1)
    return res.status(400).json({ error: 'limit must be a positive integer' });
  if (rootId && !isUuid(rootId))
    return res.status(400).json({ error: 'Invalid UUID format for rootId' });
  if (rootId && !await ds.get(rootId))
    return res.status(404).json({ error: `rootId not found: ${rootId}` });

  let fieldsArr;
  if (typeof fields === 'string') {
    fieldsArr = fields.split(',').map(s => s.trim()).filter(Boolean);
  } else if (Array.isArray(fields)) {
    fieldsArr = fields.map(s => String(s).trim()).filter(Boolean);
  }

  const queryLower = q.toLowerCase();

  const allItems = await ds.loadAll();
  let candidates = [];
  for (const i of allItems) {
    if (i.value && typeof i.value === 'string' && i.value.toLowerCase().includes(queryLower)) {
      candidates.push(i);
    } else if (i.type === 'object') {
      const objectData = await ds.readObjectJson(i.id);
      if (matchObjectData(objectData, queryLower, fieldsArr)) candidates.push(i);
    }
  }

  if (rootId) {
    const subtreeIds = new Set(await collectSubtreeIds(ds, rootId));
    candidates = candidates.filter(i => subtreeIds.has(i.id));
  }

  const sorted = candidates
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, maxResults);

  const results = await Promise.all(
    sorted.map(async item => ({ ...item, ancestors: await getAncestorChain(ds, item.id) }))
  );

  res.json({ query: q, count: results.length, results });
});

// ─── Items ────────────────────────────────────────────────────────────────────

// GET /items — list children of data_root (the user's top-level items)
app.get('/items', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const dataRoot = await ds.getDataRoot();
  const items = dataRoot ? await ds.children(dataRoot.id) : [];
  res.json(await withChildCounts(ds, items));
});

// POST /items/bulk — create multiple items in one call
app.post('/items/bulk', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'items must be a non-empty array' });

  const created = [];
  const errors = [];
  for (const [i, itemArgs] of items.entries()) {
    const { parentId = null, value = null, type = 'string', typeId = null,
      owner, license = null, sortOrder, confidence = null, status = null, tags = [],
      alias, createdBy, objectData = null } = itemArgs;
    if (!VALID_TYPES.includes(type)) {
      errors.push({ index: i, error: `Invalid type: ${type}` });
      continue;
    }
    if (confidence && !VALID_CONFIDENCES.includes(confidence)) {
      errors.push({ index: i, error: `Invalid confidence: ${confidence}` });
      continue;
    }
    try {
      const item = await ds.create({ parentId, value, type, typeId, owner, license, sortOrder, confidence, status, tags, createdBy, objectData });
      if (alias) await ds.setAlias(alias, item.id);
      created.push(item);
    } catch (err) {
      errors.push({ index: i, error: err.message });
    }
  }

  const status = errors.length && created.length ? 207 : errors.length ? 400 : 201;
  res.status(status).json({ created, errors });
});

// POST /items — create item
app.post('/items', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const { parentId = null, value = null, type = 'string', typeId = null,
    owner, license = null, sortOrder, confidence = null, status = null, tags = [],
    alias, createdBy, objectData = null } = req.body;

  if (!VALID_TYPES.includes(type))
    return res.status(400).json({ error: `Invalid type: ${type}. Valid: ${VALID_TYPES.join(', ')}` });
  if (confidence && !VALID_CONFIDENCES.includes(confidence))
    return res.status(400).json({ error: `Invalid confidence: ${confidence}. Valid: ${VALID_CONFIDENCES.join(', ')}` });
  if (parentId !== null && !isUuid(parentId))
    return res.status(400).json({ error: `Invalid parentId: ${parentId}` });
  if (parentId && !await ds.get(parentId))
    return res.status(404).json({ error: `Parent not found: ${parentId}` });

  try {
    const item = await ds.create({ parentId, value, type, typeId, owner, license, sortOrder, confidence, status, tags, createdBy, objectData });
    if (alias) await ds.setAlias(alias, item.id);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /items/bulk — update multiple items in one call
app.patch('/items/bulk', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const { updates } = req.body;
  if (!Array.isArray(updates) || updates.length === 0)
    return res.status(400).json({ error: 'updates must be a non-empty array' });

  const updated = [];
  const errors = [];
  for (const [i, { id, ...changes }] of updates.entries()) {
    if (!id) { errors.push({ index: i, error: 'id is required' }); continue; }
    if (!isUuid(id)) { errors.push({ index: i, error: `Invalid UUID: ${id}` }); continue; }
    if (!await ds.get(id)) { errors.push({ index: i, id, error: 'Not found' }); continue; }
    if ('type' in changes && !VALID_TYPES.includes(changes.type)) {
      errors.push({ index: i, id, error: `Invalid type: ${changes.type}` }); continue;
    }
    try {
      updated.push(await ds.update(id, changes, req.body.actor));
    } catch (err) {
      errors.push({ index: i, id, error: err.message });
    }
  }

  const status = errors.length && updated.length ? 207 : errors.length ? 400 : 200;
  res.status(status).json({ updated, errors });
});

// GET /items/stats — type counts and quality score across all items (excludes *_root types)
app.get('/items/stats', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;

  // Build typeId → { name, icon } from types directory
  const typeInfo = {};
  const typesDir = path.join(root, '.kanecta', 'types');
  if (fs.existsSync(typesDir)) {
    for (const s1 of fs.readdirSync(typesDir)) {
      const d1 = path.join(typesDir, s1);
      if (!fs.statSync(d1).isDirectory()) continue;
      for (const s2 of fs.readdirSync(d1)) {
        const d2 = path.join(d1, s2);
        if (!fs.statSync(d2).isDirectory()) continue;
        for (const id of fs.readdirSync(d2)) {
          try {
            const metaPath = path.join(d2, id, 'metadata.json');
            const specPath = path.join(d2, id, 'type.json');
            const name = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')).value : null;
            const icon = fs.existsSync(specPath) ? (JSON.parse(fs.readFileSync(specPath, 'utf8')).meta?.icon ?? null) : null;
            if (name) typeInfo[id] = { name, icon };
          } catch (_) {}
        }
      }
    }
  }

  const ROOT_TYPES = new Set(['root', 'data_root', 'app_root', 'component_root', 'system_root']);
  const structuredMap = {};
  const unstructuredMap = {};
  let total = 0;

  for (const item of await ds.loadAll()) {
    const raw = item.type;
    if (!raw || ROOT_TYPES.has(raw)) continue;
    total++;

    if (raw === 'object' && item.typeId) {
      const info = typeInfo[item.typeId] ?? { name: item.typeId, icon: null };
      if (!structuredMap[item.typeId]) {
        structuredMap[item.typeId] = { typeId: item.typeId, name: info.name, icon: info.icon, count: 0 };
      }
      structuredMap[item.typeId].count++;
    } else {
      unstructuredMap[raw] = (unstructuredMap[raw] || 0) + 1;
    }
  }

  const structured = Object.values(structuredMap).sort((a, b) => b.count - a.count);
  const unstructured = Object.entries(unstructuredMap)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));
  const typedCount = structured.reduce((s, r) => s + r.count, 0);

  res.json({ total, typedCount, structured, unstructured });
});

// GET /items/root — get the data_root item
app.get('/items/root', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const dataRoot = await ds.getDataRoot();
  if (!dataRoot) return res.status(404).json({ error: 'data_root not found' });
  res.json(dataRoot);
});

// GET /items/:id — get item (accepts real UUIDs and synthetic IDs)
app.get('/items/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid ID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  const item = await ds.get(id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

// PUT /items/:id — update item
app.put('/items/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });

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
  if ('status' in body) changes.status = body.status;
  if ('tags' in body) changes.tags = body.tags;
  if ('completedAt' in body) changes.completedAt = body.completedAt;

  try {
    const updated = await ds.update(id, changes, body.actor);
    if (body.objectData !== undefined) await ds.writeObjectJson(id, body.objectData);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /items/:id — delete item and all descendants (?force=true to skip reference conflict check)
app.delete('/items/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });

  const force = req.query.force === 'true' || req.query.force === '1';
  const ids = await collectSubtreeIds(ds, id);

  if (!force) {
    const warningArrays = await Promise.all(ids.map(itemId => ds.deleteWarnings(itemId)));
    const warnings = warningArrays.flat();
    if (warnings.length)
      return res.status(409).json({ error: 'Item or descendants have references. Use ?force=true to delete anyway.', warnings });
  }

  const deleted = ids.reverse();
  for (const itemId of deleted) await ds.delete(itemId);
  res.json({ deleted });
});

// GET /items/:id/children — list children of item (accepts real UUIDs and synthetic IDs)
app.get('/items/:id/children', async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid ID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!isSyntheticId(id) && !await ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(await withChildCounts(ds, await ds.children(id)));
});

// GET /items/:id/object — read the object.json for a typed object item
app.get('/items/:id/object', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  const obj = await ds.readObjectJson(id);
  if (!obj) return res.status(404).json({ error: 'No object data for this item' });
  res.json(obj);
});

// PUT /items/:id/object — write or replace the object.json for a typed object item
app.put('/items/:id/object', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  await ds.writeObjectJson(id, req.body);
  res.json({ ok: true });
});

// POST /items/:id/complete — mark item as completed (sets completedAt to now)
app.post('/items/:id/complete', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  const updated = await ds.update(id, { completedAt: new Date().toISOString() }, req.body.actor);
  res.json(updated);
});

// POST /items/:id/uncomplete — clear completed state (sets completedAt to null)
app.post('/items/:id/uncomplete', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  const updated = await ds.update(id, { completedAt: null }, req.body.actor);
  res.json(updated);
});

// GET /items/:id/function/package-json — read the package.json inside the function scaffold directory
app.get('/items/:id/function/package-json', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const s = id.replace(/-/g, '');
  const pkgPath = path.join(root, '.kanecta', 'data', s.slice(0, 2), s.slice(2, 4), id, 'function', 'package.json');
  if (!fs.existsSync(pkgPath)) return res.status(404).json({ error: 'package.json not found' });
  try {
    res.json(JSON.parse(fs.readFileSync(pkgPath, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /items/:id/function/scaffold — check whether the function/ code scaffold directory exists
// Returns { exists, stale } where stale=true means the compiled dist is out of date with function.json
app.get('/items/:id/function/scaffold', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const s = id.replace(/-/g, '');
  const itemDir = path.join(root, '.kanecta', 'data', s.slice(0, 2), s.slice(2, 4), id);
  const fnDir = path.join(itemDir, 'function');
  const exists = fs.existsSync(fnDir);
  if (!exists) return res.json({ exists: false, stale: false });

  let stale = false;
  try {
    const currentHash = hashIndexTs(fnDir);
    const buildHash = readBuildHash(fnDir);
    stale = !currentHash || !buildHash || currentHash !== buildHash || !fs.existsSync(path.join(fnDir, 'dist', 'index.js'));
  } catch { stale = true; }
  res.json({ exists, stale });
});


// GET /items/:id/function — read the function.json for a function item
app.get('/items/:id/function', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  const fn = await ds.readFunctionJson(id);
  if (!fn) return res.status(404).json({ error: 'No function data for this item' });
  res.json(fn);
});

// PUT /items/:id/function — write or replace the function.json and regenerate code scaffold
app.put('/items/:id/function', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  const item = await ds.get(id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  await ds.writeFunctionJson(id, req.body);
  try {
    const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
    const s = id.replace(/-/g, '');
    const itemDir = path.join(root, '.kanecta', 'data', s.slice(0, 2), s.slice(2, 4), id);
    const fnDir = path.join(itemDir, 'function');
    generateFunctionScaffold(itemDir, item.value ?? id, req.body, root);
    writeBuildHash(fnDir);
  } catch (err) {
    console.error(`[kanecta] generateFunctionScaffold failed for ${id}:`, err);
  }
  res.json({ ok: true });
});

// POST /items/:id/function/compile — npm install + tsc in the function scaffold directory
app.post('/items/:id/function/compile', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const s = id.replace(/-/g, '');
  const itemDir = path.join(root, '.kanecta', 'data', s.slice(0, 2), s.slice(2, 4), id);
  const fnDir = path.join(itemDir, 'function');

  if (!fs.existsSync(fnDir)) {
    return res.status(404).json({ error: 'Function scaffold not found. Save the function first.' });
  }

  const chunks = [];

  const install = spawnSync('npm', ['install'], {
    cwd: fnDir, encoding: 'utf8', shell: true, timeout: 120_000,
  });
  if (install.stdout) chunks.push(install.stdout);
  if (install.stderr) chunks.push(install.stderr);

  if (install.status !== 0) {
    return res.json({ success: false, output: chunks.join('\n').trim() });
  }

  const build = spawnSync('npm', ['run', 'build'], {
    cwd: fnDir, encoding: 'utf8', shell: true, timeout: 60_000,
  });
  if (build.stdout) chunks.push(build.stdout);
  if (build.stderr) chunks.push(build.stderr);

  const success = build.status === 0;

  if (success) {
    try { writeBuildHash(fnDir); } catch { /* not critical */ }
  }

  return res.json({ success, output: chunks.join('\n').trim() });
});

// POST /items/:id/function/run — check hash, rebuild if stale, then execute the function
app.post('/items/:id/function/run', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });

  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const s = id.replace(/-/g, '');
  const fnDir = path.join(root, '.kanecta', 'data', s.slice(0, 2), s.slice(2, 4), id, 'function');
  const distIndex = path.join(fnDir, 'dist', 'index.js');

  if (!fs.existsSync(fnDir)) {
    return res.status(404).json({ error: 'Function scaffold not found. Save the function first.' });
  }

  const ds = await openDatastore(res);
  if (!ds) return;
  const item = await ds.get(id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const fnData = await ds.readFunctionJson(id) ?? {};
  const currentHash = hashIndexTs(fnDir);
  const buildHash = readBuildHash(fnDir);
  const needsRebuild = !fs.existsSync(distIndex) || !currentHash || !buildHash || currentHash !== buildHash;

  if (needsRebuild) {
    const rebuildChunks = [];

    const install = spawnSync('npm', ['install'], {
      cwd: fnDir, encoding: 'utf8', shell: true, timeout: 120_000,
    });
    if (install.stdout) rebuildChunks.push(install.stdout);
    if (install.stderr) rebuildChunks.push(install.stderr);

    if (install.status !== 0) {
      return res.json({ success: false, output: null, logs: `Auto-rebuild failed (npm install):\n${rebuildChunks.join('\n').trim()}` });
    }

    const build = spawnSync('npm', ['run', 'build'], {
      cwd: fnDir, encoding: 'utf8', shell: true, timeout: 60_000,
    });
    if (build.stdout) rebuildChunks.push(build.stdout);
    if (build.stderr) rebuildChunks.push(build.stderr);

    if (build.status !== 0) {
      return res.json({ success: false, output: null, logs: `Auto-rebuild failed (build):\n${rebuildChunks.join('\n').trim()}` });
    }

    writeBuildHash(fnDir);
  }

  const fnName = toCamelCase(item.value ?? id);
  const params = fnData.parameters ?? [];
  const { args = {} } = req.body;

  const RESULT_START = '__KANECTA_RESULT_START__';
  const RESULT_END = '__KANECTA_RESULT_END__';

  const runnerCode = `
const mod = require(${JSON.stringify(distIndex)});
const params = ${JSON.stringify(params)};
const rawArgs = ${JSON.stringify(args)};
const values = params.map(p => {
  const v = rawArgs[p.name];
  if (v === undefined || v === '') return undefined;
  try { return JSON.parse(v); } catch { return v; }
});
Promise.resolve(mod[${JSON.stringify(fnName)}](...values))
  .then(r => {
    process.stdout.write(${JSON.stringify(RESULT_START)} + JSON.stringify(r, null, 2) + ${JSON.stringify(RESULT_END)} + '\\n');
  })
  .catch(e => {
    process.stderr.write((e.stack || e.message || String(e)) + '\\n');
    process.exit(1);
  });
`;

  const child = spawn('node', ['-e', runnerCode], { encoding: 'utf8' });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  const timer = setTimeout(() => {
    child.kill();
    stderr += '\nExecution timed out after 30s';
  }, 30_000);

  child.on('close', code => {
    clearTimeout(timer);
    const resultMatch = stdout.match(new RegExp(`${RESULT_START}([\\s\\S]*?)${RESULT_END}`));
    const output = resultMatch ? resultMatch[1].trim() : null;
    const logsFromStdout = stdout.replace(new RegExp(`${RESULT_START}[\\s\\S]*?${RESULT_END}\\n?`), '').trim();
    const logs = [logsFromStdout, stderr].filter(Boolean).join('\n').trim();
    res.json({ success: code === 0, output, logs });
  });
});

// GET /items/:id/tree — tree rooted at item (?depth=n)
app.get('/items/:id/tree', async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid ID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  const maxDepth = req.query.depth != null ? parseInt(req.query.depth, 10) : Infinity;
  if (isNaN(maxDepth) || maxDepth < 0)
    return res.status(400).json({ error: 'depth must be a non-negative integer' });
  res.json(await ds.tree(id, maxDepth));
});

// GET /items/:id/ancestors — full path from root down to this item's parent
app.get('/items/:id/ancestors', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(await getAncestorChain(ds, id));
});

// POST /items/:id/clone — deep-copy item and all descendants under a new parent
app.post('/items/:id/clone', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });

  const { targetParentId, actor } = req.body;
  if (!targetParentId) return res.status(400).json({ error: 'targetParentId is required' });
  if (!isUuid(targetParentId)) return res.status(400).json({ error: 'Invalid UUID format for targetParentId' });
  if (!await ds.get(targetParentId)) return res.status(404).json({ error: `Target parent not found: ${targetParentId}` });

  const cloned = await cloneSubtree(ds, id, targetParentId, actor);
  res.status(201).json(cloned);
});

// GET /items/:id/annotations — list annotations
app.get('/items/:id/annotations', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(await ds.annotations(id));
});

// POST /items/:id/annotations — add annotation
app.post('/items/:id/annotations', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  const { content, author, parentAnnotationId = null } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  const annotation = await ds.annotate(id, { content, author, parentAnnotationId });
  res.status(201).json(annotation);
});

// GET /items/:id/relationships — get relationships
app.get('/items/:id/relationships', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(await ds.relationships(id));
});

// GET /items/:id/backlinks — get backlinks
app.get('/items/:id/backlinks', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(await ds.backlinks(id));
});

// GET /items/:id/history — get change history
app.get('/items/:id/history', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const ds = await openDatastore(res);
  if (!ds) return;
  if (!await ds.get(id)) return res.status(404).json({ error: 'Item not found' });
  res.json(await ds.history(id));
});

// ─── Tree ─────────────────────────────────────────────────────────────────────

// GET /tree — full tree from all roots (?depth=n)
app.get('/tree', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const maxDepth = req.query.depth != null ? parseInt(req.query.depth, 10) : Infinity;
  if (isNaN(maxDepth) || maxDepth < 0)
    return res.status(400).json({ error: 'depth must be a non-negative integer' });
  res.json(await ds.tree(null, maxDepth));
});

// ─── Aliases ──────────────────────────────────────────────────────────────────

// GET /aliases — list all aliases, optionally filtered by ?targetId=
app.get('/aliases', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const all = await ds.listAliases();
  if (req.query.targetId) {
    return res.json(all.filter(a => a.targetId === req.query.targetId));
  }
  res.json(all);
});

// GET /aliases/:alias — resolve alias to UUID
app.get('/aliases/:alias', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const alias = req.params.alias.toLowerCase();
  const targetId = await ds.resolveAlias(alias);
  if (!targetId) return res.status(404).json({ error: `Alias not found: ${alias}` });
  res.json({ alias, targetId });
});

// POST /aliases — set alias { alias, targetId }
app.post('/aliases', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const { targetId } = req.body;
  const alias = typeof req.body.alias === 'string' ? req.body.alias.toLowerCase() : req.body.alias;
  if (!alias) return res.status(400).json({ error: 'alias is required' });
  if (!targetId) return res.status(400).json({ error: 'targetId is required' });
  if (!isUuid(targetId)) return res.status(400).json({ error: 'Invalid UUID format for targetId' });
  if (!await ds.get(targetId)) return res.status(404).json({ error: `Item not found: ${targetId}` });
  await ds.setAlias(alias, targetId);
  res.status(201).json({ alias, targetId });
});

// DELETE /aliases/:alias — remove alias
app.delete('/aliases/:alias', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const alias = req.params.alias.toLowerCase();
  if (!await ds.resolveAlias(alias))
    return res.status(404).json({ error: `Alias not found: ${alias}` });
  await ds.removeAlias(alias);
  res.json({ removed: alias });
});

// ─── Relationships ────────────────────────────────────────────────────────────

// GET /relationships — list all relationships
app.get('/relationships', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  res.json(await ds.listRelationships());
});

// POST /relationships — create relationship { sourceId, type, targetId, note? }
app.post('/relationships', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const { sourceId, type, targetId, note = null, createdBy } = req.body;
  if (!sourceId || !type || !targetId)
    return res.status(400).json({ error: 'sourceId, type, and targetId are required' });
  if (!isUuid(sourceId)) return res.status(400).json({ error: 'Invalid UUID: sourceId' });
  if (!isUuid(targetId)) return res.status(400).json({ error: 'Invalid UUID: targetId' });
  if (!ds.relTypes.includes(type))
    return res.status(400).json({ error: `Invalid relationship type: ${type}. Valid: ${ds.relTypes.join(', ')}` });
  if (!await ds.get(sourceId)) return res.status(404).json({ error: `Source not found: ${sourceId}` });
  if (!await ds.get(targetId)) return res.status(404).json({ error: `Target not found: ${targetId}` });
  const rel = await ds.relate(sourceId, type, targetId, { note, createdBy });
  res.status(201).json(rel);
});

// ─── Tags ─────────────────────────────────────────────────────────────────────

// GET /tags/:tag — list item IDs with this tag
app.get('/tags/:tag', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  res.json(await ds.byTag(req.params.tag));
});

// ─── Types ────────────────────────────────────────────────────────────────────

// GET /types — list all type definitions from <datastore>/.kanecta/types/
app.get('/types', async (req, res) => {
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const typesDir = path.join(root, '.kanecta', 'types');
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
                meta.icon           = typeDef.meta.icon ?? null;
                meta.description    = typeDef.meta.description ?? null;
                meta.details        = typeDef.meta.details ?? null;
                meta.keywords       = typeDef.meta.keywords ?? null;
                meta.tags           = typeDef.meta.tags ?? null;
                meta.primaryField   = typeDef.meta.primaryField ?? null;
                meta['ai-instructions'] = typeDef.meta['ai-instructions'] ?? null;
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
app.post('/types', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const { value } = req.body;
  if (!value || typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: 'value is required' });
  }
  try {
    const { metadata } = await ds.createType(value.trim());
    res.status(201).json({ ...metadata, icon: null, description: null, details: null, keywords: null, primaryField: null, 'ai-instructions': null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const { type: typeFileSpec } = require('@kanecta/specification');

function validateTypeSchema(schema) {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema))
    return 'Schema must be a JSON object';
  for (const key of typeFileSpec.required) {
    if (!schema[key] || typeof schema[key] !== 'object')
      return `${key} is required`;
  }
  const metaRequired = typeFileSpec.properties.meta.required ?? [];
  for (const key of metaRequired) {
    if (typeof schema.meta[key] !== 'string')
      return `meta.${key} is required and must be a string`;
  }
  const jsRequired = typeFileSpec.properties.jsonSchema.required ?? [];
  const js = schema.jsonSchema;
  for (const key of jsRequired) {
    if (js[key] === undefined || js[key] === null)
      return `jsonSchema.${key} is required`;
  }
  if (js['$schema'] !== typeFileSpec.properties.jsonSchema.properties['$schema'].const)
    return `jsonSchema.$schema must be "${typeFileSpec.properties.jsonSchema.properties['$schema'].const}"`;
  if (js.type !== typeFileSpec.properties.jsonSchema.properties.type.const)
    return `jsonSchema.type must be "${typeFileSpec.properties.jsonSchema.properties.type.const}"`;
  if (!js.properties || typeof js.properties !== 'object')
    return 'jsonSchema.properties is required';
  return null;
}

// PUT /types/:id/schema — save updated type.json schema
app.put('/types/:id/schema', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const typesDir = path.join(root, '.kanecta', 'types');
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

  const validationError = validateTypeSchema(schema);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
    res.json(schema);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /types/:id — get the metadata.json for a type
app.get('/types/:id', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const typesDir = path.join(root, '.kanecta', 'types');
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
app.get('/types/:id/schema', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid UUID format' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const typesDir = path.join(root, '.kanecta', 'types');
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
  return path.join(root, '.kanecta', 'app', 'studio', 'history');
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
app.get('/breadcrumb/clipboard', async (_req, res) => {
  res.json(readBreadcrumb('clipboard').reverse());
});

// POST /breadcrumb/clipboard — append { id, name, type, typeId }
app.post('/breadcrumb/clipboard', async (req, res) => {
  const { id, name, type = '', typeId = '' } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  appendBreadcrumb('clipboard', id, name, type, typeId);
  res.json({ ok: true });
});

// GET /breadcrumb/viewed
app.get('/breadcrumb/viewed', async (_req, res) => {
  res.json(readBreadcrumb('viewed').reverse());
});

// POST /breadcrumb/viewed — append { id, name, type, typeId }
app.post('/breadcrumb/viewed', async (req, res) => {
  const { id, name, type = '', typeId = '' } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  appendBreadcrumb('viewed', id, name, type, typeId);
  res.json({ ok: true });
});

// ─── Starred ─────────────────────────────────────────────────────────────────

function starredFilePath() {
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const studioDir = path.join(root, '.kanecta', 'app', 'studio');
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
app.get('/app/studio/starred', async (_req, res) => {
  res.json(readStarred().reverse());
});

// POST /app/studio/starred — upsert { id, name, type?, typeId? }
app.post('/app/studio/starred', async (req, res) => {
  const { id, name, type = '', typeId = '' } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  const entries = readStarred().filter((e) => e.id !== id);
  const safeName = (name || '').replace(/,/g, ' ');
  entries.push({ id, name: safeName, type, typeId, timestamp: new Date().toISOString() });
  writeStarred(entries);
  res.json({ ok: true });
});

// DELETE /app/studio/starred/:id
app.delete('/app/studio/starred/:id', async (req, res) => {
  const { id } = req.params;
  const entries = readStarred().filter((e) => e.id !== id);
  writeStarred(entries);
  res.json({ ok: true });
});

// ─── View settings ───────────────────────────────────────────────────────────

function viewDir(root, id) {
  const stripped = id.replace(/-/g, '');
  return path.join(root, '.kanecta', 'app', 'studio', 'view', stripped.slice(0, 2), stripped.slice(2, 4), id);
}

// GET /app/studio/view/:id
app.get('/app/studio/view/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const file = path.join(viewDir(root, id), 'view.json');
  if (!fs.existsSync(file)) return res.json(null);
  try {
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    res.json(null);
  }
});

// PUT /app/studio/view/:id
app.put('/app/studio/view/:id', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid UUID' });
  const { levels } = req.body;
  if (levels == null) return res.status(400).json({ error: 'levels required' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const dir = viewDir(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'view.json'), JSON.stringify({ levels }, null, 2));
  res.json({ ok: true });
});

// ─── Sync Types ──────────────────────────────────────────────────────────────

app.get('/app/studio/sync-system-items', async (_req, res) => {
  const commonDir = process.env.KANECTA_SYSTEM_ITEMS_DIR;
  if (!commonDir || !fs.existsSync(commonDir)) return res.json([]);

  // Step 1: load all items from system-items
  const allItems = [];
  try {
    for (const s1 of fs.readdirSync(commonDir)) {
      const d1 = path.join(commonDir, s1);
      if (!fs.statSync(d1).isDirectory()) continue;
      for (const s2 of fs.readdirSync(d1)) {
        const d2 = path.join(d1, s2);
        if (!fs.statSync(d2).isDirectory()) continue;
        for (const id of fs.readdirSync(d2)) {
          const metaPath = path.join(d2, id, 'metadata.json');
          if (!fs.existsSync(metaPath)) continue;
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            allItems.push({ id, meta, dir: path.join(d2, id) });
          } catch {}
        }
      }
    }
  } catch (err) { return res.status(500).json({ error: err.message }); }

  // Step 2: find non-type items (instances)
  const instances = allItems.filter(({ meta }) => meta.type !== 'type');

  // Step 3: collect typeIds used by those instances
  const usedTypeIds = new Set(instances.map(({ meta }) => meta.typeId).filter(Boolean));

  // Step 4: type definitions NOT used internally by system-items instances
  const typeDefs = allItems.filter(({ id, meta }) => meta.type === 'type' && !usedTypeIds.has(id));

  const results = [];
  for (const { id, dir } of typeDefs) {
    const typePath = path.join(dir, 'type.json');
    if (!fs.existsSync(typePath)) continue;
    try {
      const schema = JSON.parse(fs.readFileSync(typePath, 'utf8'));
      const title = schema.jsonSchema?.title || id;
      results.push({ folderId: id, title, schema });
    } catch {}
  }

  results.sort((a, b) => a.title.localeCompare(b.title));
  res.json(results);
});

app.post('/app/studio/sync-system-items/import', async (req, res) => {
  const commonDir = process.env.KANECTA_SYSTEM_ITEMS_DIR;
  if (!commonDir) return res.status(400).json({ error: 'KANECTA_SYSTEM_ITEMS_DIR not configured' });
  const ds = await openDatastore(res);
  if (!ds) return;
  const { folderIds } = req.body;
  if (!Array.isArray(folderIds) || folderIds.length === 0) return res.status(400).json({ error: 'folderIds required' });
  const imported = [];
  const errors = [];
  for (const folderId of folderIds) {
    try {
      const s1 = folderId.slice(0, 2);
      const s2 = folderId.slice(2, 4);
      const typePath = path.join(commonDir, s1, s2, folderId, 'type.json');
      if (!fs.existsSync(typePath)) { errors.push({ folderId, error: 'type.json not found' }); continue; }
      const schema = JSON.parse(fs.readFileSync(typePath, 'utf8'));
      const title = schema.jsonSchema?.title || folderId;
      const { metadata } = await ds.createType(title, { schema, id: folderId });
      imported.push({ id: metadata.id, value: title });
    } catch (err) { errors.push({ folderId, error: err.message }); }
  }
  res.json({ imported, errors });
});

app.post('/app/studio/sync-system-items/export', async (req, res) => {
  const commonDir = process.env.KANECTA_SYSTEM_ITEMS_DIR;
  if (!commonDir) return res.status(400).json({ error: 'KANECTA_SYSTEM_ITEMS_DIR not configured' });
  const { typeIds } = req.body;
  if (!Array.isArray(typeIds) || typeIds.length === 0) return res.status(400).json({ error: 'typeIds required' });
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const exported = [];
  const errors = [];
  for (const id of typeIds) {
    try {
      const shard1 = id.slice(0, 2);
      const shard2 = id.slice(2, 4);
      const srcDir = path.join(root, '.kanecta', 'types', shard1, shard2, id);
      if (!fs.existsSync(srcDir)) { errors.push({ id, error: 'type directory not found' }); continue; }
      const destDir = path.join(commonDir, shard1, shard2, id);
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
      exported.push({ id });
    } catch (err) { errors.push({ id, error: err.message }); }
  }
  res.json({ exported, errors });
});

// ─── Settings ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = { themeName: 'Green', sidebarBg: '#20a138', sidebarFg: '#ffffff', sidebarFgSelected: '#5a6a60', contentBg: '#ffffff', contentBorder: '#20a138', showContentBorder: false, locationBorder: '#15712a' };

function settingsFilePath() {
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const dir = path.join(root, '.kanecta', 'app', 'studio', 'settings');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'settings.json');
}

function readSettings() {
  const p = settingsFilePath();
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    return DEFAULT_SETTINGS;
  }
  try {
    const stored = JSON.parse(fs.readFileSync(p, 'utf8'));
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    if (Object.keys(merged).length !== Object.keys(stored).length ||
        Object.keys(DEFAULT_SETTINGS).some(k => !(k in stored))) {
      fs.writeFileSync(p, JSON.stringify(merged, null, 2));
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

app.get('/app/studio/settings', async (_req, res) => {
  res.json(readSettings());
});

app.post('/app/studio/settings', async (req, res) => {
  const { themeName, sidebarBg, sidebarFg, sidebarFgSelected, contentBg, contentBorder, showContentBorder, locationBorder } = req.body;
  if (!themeName) return res.status(400).json({ error: 'themeName required' });
  fs.writeFileSync(settingsFilePath(), JSON.stringify({ themeName, sidebarBg, sidebarFg, sidebarFgSelected, contentBg, contentBorder, showContentBorder: showContentBorder ?? true, locationBorder: locationBorder ?? '#cccccc' }, null, 2));
  res.json({ ok: true });
});

// ─── Layouts ─────────────────────────────────────────────────────────────────

function layoutsFilePath() {
  const root = process.env.KANECTA_DATASTORE || DEFAULT_DATASTORE;
  const dir = path.join(root, '.kanecta', 'app', 'studio', 'layouts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'layouts.json');
}

function defaultLayoutData() {
  const { randomUUID } = require('crypto');
  const tabId = randomUUID();
  const paneId = randomUUID();
  return {
    activeTabId: tabId,
    tabs: [{ id: tabId, label: 'Tab 1', root: { type: 'leaf', id: paneId, viewType: null, itemId: null } }],
  };
}

app.get('/app/studio/layouts', async (_req, res) => {
  const filePath = layoutsFilePath();
  if (!fs.existsSync(filePath)) return res.json(defaultLayoutData());
  try {
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    res.json(defaultLayoutData());
  }
});

app.put('/app/studio/layouts', async (req, res) => {
  fs.writeFileSync(layoutsFilePath(), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ─── Skills ──────────────────────────────────────────────────────────────────

const SKILLS_DIR = process.env.KANECTA_SKILLS_PATH || path.join(__dirname, '../../kanecta-skills');

function extractSkillTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function safeSkillId(id) {
  return typeof id === 'string' && id.endsWith('.md') && !id.includes('/') && !id.includes('..');
}

// GET /skills — list all .md files sorted by title
app.get('/skills', async (req, res) => {
  try {
    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));
    const skills = files.map(filename => {
      const content = fs.readFileSync(path.join(SKILLS_DIR, filename), 'utf8');
      const title = extractSkillTitle(content) ?? filename.replace(/\.md$/, '');
      return { id: filename, title, filename };
    }).sort((a, b) => a.title.localeCompare(b.title));
    res.json(skills);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read skills directory' });
  }
});

// GET /skills/:id — get a single skill file with content
app.get('/skills/:id', async (req, res) => {
  const { id } = req.params;
  if (!safeSkillId(id)) return res.status(400).json({ error: 'Invalid skill id' });
  try {
    const content = fs.readFileSync(path.join(SKILLS_DIR, id), 'utf8');
    const title = extractSkillTitle(content) ?? id.replace(/\.md$/, '');
    res.json({ id, title, filename: id, content });
  } catch (err) {
    res.status(404).json({ error: 'Skill not found' });
  }
});

// PUT /skills/:id — update a skill file
app.put('/skills/:id', async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  if (!safeSkillId(id)) return res.status(400).json({ error: 'Invalid skill id' });
  if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
  try {
    fs.writeFileSync(path.join(SKILLS_DIR, id), content, 'utf8');
    const title = extractSkillTitle(content) ?? id.replace(/\.md$/, '');
    res.json({ id, title, filename: id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write skill file' });
  }
});

// ─── Index ────────────────────────────────────────────────────────────────────

// POST /rebuild-indexes — rebuild all index caches from data/
app.post('/rebuild-indexes', async (req, res) => {
  const ds = await openDatastore(res);
  if (!ds) return;
  const itemCount = await ds.rebuildIndexes();
  res.json({ rebuilt: true, itemCount });
});

// ─── Claude CLI sessions ──────────────────────────────────────────────────────

app.post('/claude/sessions', async (req, res) => {
  const { prompt, workingDir } = req.body;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }
  const id = claude.createSession(prompt.trim(), workingDir);
  res.status(201).json({ id });
});

app.get('/claude/sessions/:id/stream', async (req, res) => {
  const { id } = req.params;
  if (!claude.getSession(id)) return res.status(404).json({ error: 'Session not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const write = (data) => {
    res.write(data);
    try {
      const event = JSON.parse(data.replace(/^data: /, ''));
      if (event.type === 'done') { claude.unsubscribe(id, write); res.end(); }
    } catch {}
  };
  claude.subscribe(id, write);
  req.on('close', () => claude.unsubscribe(id, write));
});

app.post('/claude/sessions/:id/respond', async (req, res) => {
  const { id } = req.params;
  const { approved } = req.body;
  if (typeof approved !== 'boolean') return res.status(400).json({ error: 'approved (boolean) is required' });
  const ok = claude.respond(id, approved);
  if (!ok) return res.status(404).json({ error: 'Session not found or no pending approval' });
  res.json({ ok: true });
});

app.delete('/claude/sessions/:id', async (req, res) => {
  const ok = claude.cancelSession(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

module.exports = app;
