'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_ID = '00000000-0000-0000-0000-000000000000';
const WELL_KNOWN_TYPES = new Set(['root', 'system_root', 'app_root', 'component_root', 'data_root']);
const WELL_KNOWN_ORDER = ['system_root', 'app_root', 'component_root', 'data_root'];

const VALID_TYPES = [
  'string', 'number', 'text', 'heading', 'file', 'symlink', 'object', 'decision', 'annotation',
  'note', 'fact', 'claim', 'question', 'task', 'concept', 'entity', 'event', 'code', 'url', 'image',
  'root', 'system_root', 'app_root', 'component_root', 'data_root',
];
const VALID_CONFIDENCES = ['experimental', 'exploring', 'decided', 'locked', 'low', 'medium', 'high', 'verified'];
const VALID_REL_TYPES = [
  'relates-to', 'depends-on', 'enables', 'contradicts',
  'blocks', 'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_SOURCE = '\\[\\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\]\\]';

class FilesystemAdapter {
  constructor(root) {
    this.root = path.resolve(root);
    this.k = this.root;
    this._config = null;
    this._roots = null;
  }

  static isDatastore(root) {
    return fs.existsSync(path.join(root, 'config', 'config.json'));
  }

  static init(root, owner) {
    const dirs = [
      'data', 'aliases', 'annotations', 'config', 'history', 'links',
      'relationships', 'remotes', 'remotes-index', 'search', 'tags', 'types',
    ];
    fs.mkdirSync(root, { recursive: true });
    for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
    const config = { owner, specVersion: '1.2.0' };
    fs.writeFileSync(
      path.join(root, 'config', 'config.json'),
      JSON.stringify(config, null, 2) + '\n',
    );
    const adapter = new FilesystemAdapter(root);
    adapter._initRoots();
    return adapter;
  }

  static open(root) {
    const adapter = new FilesystemAdapter(root);
    if (!adapter.config) throw new Error(`Not a Kanecta datastore: ${root}`);
    adapter._initRoots();
    return adapter;
  }

  get config() {
    if (!this._config) {
      const f = path.join(this.k, 'config', 'config.json');
      this._config = this._readJson(f, null);
      if (!this._config) throw new Error(`Not a Kanecta datastore: ${this.root}`);
    }
    return this._config;
  }

  // ─── Path helpers ──────────────────────────────────────────────────────────

  // 2+2+full_uuid sharding per spec §1 (mandatory for all keyed folders).
  _itemDir(id) {
    const hex = id.replace(/-/g, '');
    return path.join(this.k, 'data', hex.slice(0, 2), hex.slice(2, 4), id);
  }

  // 2+2+full_key sharding for string-keyed folders (aliases, tags, remotes-index).
  // Keys shorter than 4 chars are padded with underscores on the right.
  _shardDir(subdir, key) {
    const padded = key.length >= 4 ? key : key.padEnd(4, '_');
    const dir = path.join(this.k, subdir, padded.slice(0, 2), padded.slice(2, 4), key);
    const resolved = path.resolve(dir);
    const base = path.resolve(this.k) + path.sep;
    if (!resolved.startsWith(base)) {
      throw new Error(`Invalid key — path traversal detected: ${key}`);
    }
    return dir;
  }

  // ─── Low-level I/O ─────────────────────────────────────────────────────────

  _readJson(filePath, defaultValue) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return defaultValue;
      throw e;
    }
  }

  _writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  }

  // ─── Link extraction ───────────────────────────────────────────────────────

  _parseLinks(value) {
    if (!value || typeof value !== 'string') return [];
    const links = new Set();
    const re = new RegExp(LINK_SOURCE, 'g');
    let m;
    while ((m = re.exec(value)) !== null) links.add(m[1]);
    return [...links];
  }

  // ─── Index helpers ─────────────────────────────────────────────────────────

  _addBacklink(targetId, sourceId) {
    const hex = targetId.replace(/-/g, '');
    const f = path.join(this.k, 'links', hex.slice(0, 2), hex.slice(2, 4), targetId, 'backlinks.json');
    const d = this._readJson(f, { backlinks: [] });
    if (!d.backlinks.includes(sourceId)) {
      d.backlinks.push(sourceId);
      this._writeJson(f, d);
    }
  }

  _removeBacklink(targetId, sourceId) {
    const hex = targetId.replace(/-/g, '');
    const f = path.join(this.k, 'links', hex.slice(0, 2), hex.slice(2, 4), targetId, 'backlinks.json');
    const d = this._readJson(f, { backlinks: [] });
    d.backlinks = d.backlinks.filter(id => id !== sourceId);
    this._writeJson(f, d);
  }

  _addTagEntry(tag, itemId) {
    const f = path.join(this._shardDir('tags', tag), 'items.json');
    const d = this._readJson(f, { items: [] });
    if (!d.items.includes(itemId)) {
      d.items.push(itemId);
      this._writeJson(f, d);
    }
  }

  _removeTagEntry(tag, itemId) {
    const f = path.join(this._shardDir('tags', tag), 'items.json');
    const d = this._readJson(f, { items: [] });
    d.items = d.items.filter(id => id !== itemId);
    this._writeJson(f, d);
  }

  _addTypeEntry(typeId, itemId) {
    if (!UUID_RE.test(typeId)) throw new Error(`Invalid typeId: ${typeId}`);
    const hex = typeId.replace(/-/g, '');
    const f = path.join(this.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId, 'items.json');
    const d = this._readJson(f, { items: [] });
    if (!d.items.includes(itemId)) {
      d.items.push(itemId);
      this._writeJson(f, d);
    }
  }

  _removeTypeEntry(typeId, itemId) {
    if (!UUID_RE.test(typeId)) throw new Error(`Invalid typeId: ${typeId}`);
    const hex = typeId.replace(/-/g, '');
    const f = path.join(this.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId, 'items.json');
    const d = this._readJson(f, { items: [] });
    d.items = d.items.filter(id => id !== itemId);
    this._writeJson(f, d);
  }

  // ─── History ───────────────────────────────────────────────────────────────

  _historyDir(id) {
    const hex = id.replace(/-/g, '');
    return path.join(this.k, 'history', hex.slice(0, 2), hex.slice(2, 4), id);
  }

  _snapshot(item, changeType, changedBy, now) {
    const ts = now.toISOString().replace(/:/g, '-').replace(/\./g, '-');
    const filename = `${ts}-${changeType}.json`;
    this._writeJson(path.join(this._historyDir(item.id), filename), {
      ...item,
      snapshotAt: now.toISOString(),
      changedBy,
      changeType,
    });
  }

  // ─── Well-known root nodes ─────────────────────────────────────────────────

  _createWellKnownNode(id, parentId, type, sortOrder) {
    const now = new Date();
    const owner = this.config.owner;
    const item = {
      id, parentId, value: type, type,
      typeId: null, owner, license: null, sortOrder,
      confidence: null, tags: [],
      createdAt: now.toISOString(), modifiedAt: now.toISOString(),
      createdBy: owner, modifiedBy: owner,
      cachedAt: null, subscribedAt: null, subscriptionSource: null,
    };
    this._writeJson(path.join(this._itemDir(id), 'metadata.json'), item);
    this._snapshot(item, 'create', owner, now);
    return item;
  }

  _initRoots() {
    if (!this.get(ROOT_ID)) {
      this._createWellKnownNode(ROOT_ID, ROOT_ID, 'root', 0);
    }
    const existingChildren = this.children(ROOT_ID).map(c => c.type);
    WELL_KNOWN_ORDER.forEach((type, i) => {
      if (!existingChildren.includes(type)) {
        this._createWellKnownNode(crypto.randomUUID(), ROOT_ID, type, i);
      }
    });
    this._loadRoots();
  }

  _loadRoots() {
    const rootItem = this.get(ROOT_ID);
    const childItems = this.children(ROOT_ID);
    this._roots = { root: rootItem };
    for (const child of childItems) {
      if (WELL_KNOWN_TYPES.has(child.type)) this._roots[child.type] = child;
    }
  }

  _getRoots() {
    if (!this._roots) this._loadRoots();
    return this._roots;
  }

  getRoot() {
    return this._getRoots().root;
  }

  getDataRoot() {
    return this._getRoots().data_root || null;
  }

  _assertEditable(item, id) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (item.type !== 'data_root' && (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID)) {
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be modified`);
    }
  }

  _assertDeletable(item, id) {
    if (!item) throw new Error(`Item not found: ${id}`);
    if (WELL_KNOWN_TYPES.has(item.type) || item.id === ROOT_ID) {
      throw new Error(`Item '${id}' (type: ${item.type}) is a reserved root node and cannot be deleted`);
    }
  }

  // ─── Item CRUD ─────────────────────────────────────────────────────────────

  create({
    parentId, value = null, type = 'string', typeId = null,
    owner, license = null, sortOrder, confidence = null, tags = [],
    createdBy,
  } = {}) {
    if (WELL_KNOWN_TYPES.has(type)) {
      throw new Error(`Type '${type}' is a well-known root type and cannot be created via create()`);
    }

    if (parentId == null) {
      const dr = this.getDataRoot();
      if (!dr) throw new Error('Datastore not initialised: data_root not found. Call _initRoots() first.');
      parentId = dr.id;
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const ownerVal = owner || this.config.owner;
    const actor = createdBy || ownerVal;

    if (sortOrder == null) {
      const siblings = this.children(parentId);
      sortOrder = siblings.length === 0 ? 0 : Math.max(...siblings.map(s => s.sortOrder)) + 1;
    }

    const item = {
      id,
      parentId,
      value,
      type,
      typeId: type === 'object' ? (typeId || null) : null,
      owner: ownerVal,
      license,
      sortOrder,
      confidence,
      tags: [...tags],
      createdAt: now.toISOString(),
      modifiedAt: now.toISOString(),
      createdBy: actor,
      modifiedBy: actor,
      cachedAt: null,
      subscribedAt: null,
      subscriptionSource: null,
    };

    this._writeJson(path.join(this._itemDir(id), 'metadata.json'), item);

    if (item.typeId) this._addTypeEntry(item.typeId, id);
    for (const link of this._parseLinks(value)) this._addBacklink(link, id);
    for (const tag of tags) this._addTagEntry(tag, id);
    this._snapshot(item, 'create', actor, now);

    return item;
  }

  get(id) {
    return this._readJson(path.join(this._itemDir(id), 'metadata.json'), null);
  }

  resolveAlias(alias) {
    const f = path.join(this._shardDir('aliases', alias), 'target.txt');
    try {
      return fs.readFileSync(f, 'utf8').trim();
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  resolve(idOrAlias) {
    if (UUID_RE.test(idOrAlias)) return this.get(idOrAlias);
    const id = this.resolveAlias(idOrAlias);
    return id ? this.get(id) : null;
  }

  update(id, changes, actor) {
    const current = this.get(id);
    this._assertEditable(current, id);
    actor = actor || this.config.owner;
    const now = new Date();

    this._snapshot(current, 'update', actor, now);

    const updated = { ...current };

    if ('value' in changes) {
      const oldLinks = this._parseLinks(current.value);
      const newLinks = this._parseLinks(changes.value);
      for (const l of oldLinks) if (!newLinks.includes(l)) this._removeBacklink(l, id);
      for (const l of newLinks) if (!oldLinks.includes(l)) this._addBacklink(l, id);
      updated.value = changes.value;
    }

    if ('type' in changes && changes.type !== current.type) {
      if (current.type === 'object' && current.typeId) this._removeTypeEntry(current.typeId, id);
      updated.type = changes.type;
      updated.typeId = changes.type === 'object' ? (changes.typeId || null) : null;
      if (updated.typeId) this._addTypeEntry(updated.typeId, id);
    } else if ('typeId' in changes && updated.type === 'object') {
      if (current.typeId && current.typeId !== changes.typeId) this._removeTypeEntry(current.typeId, id);
      updated.typeId = changes.typeId;
      if (updated.typeId) this._addTypeEntry(updated.typeId, id);
    }

    if ('parentId' in changes) updated.parentId = changes.parentId;
    if ('sortOrder' in changes) updated.sortOrder = changes.sortOrder;
    if ('confidence' in changes) updated.confidence = changes.confidence;
    if ('license' in changes) updated.license = changes.license;

    if ('tags' in changes) {
      const oldTags = current.tags || [];
      const newTags = changes.tags;
      for (const t of oldTags) if (!newTags.includes(t)) this._removeTagEntry(t, id);
      for (const t of newTags) if (!oldTags.includes(t)) this._addTagEntry(t, id);
      updated.tags = newTags;
    }

    updated.modifiedAt = now.toISOString();
    updated.modifiedBy = actor;

    this._writeJson(path.join(this._itemDir(id), 'metadata.json'), updated);
    return updated;
  }

  deleteWarnings(id) {
    const backlinkIds = this.backlinks(id);
    const rels = this.relationships(id);
    const warnings = [];
    if (backlinkIds.length)
      warnings.push(`${backlinkIds.length} item(s) link to this via [[uuid]] syntax`);
    if ((rels.inbound || []).length)
      warnings.push(`${rels.inbound.length} inbound relationship(s) point to this item`);
    return warnings;
  }

  delete(id, actor) {
    const item = this.get(id);
    this._assertDeletable(item, id);
    actor = actor || this.config.owner;
    const now = new Date();

    const warnings = this.deleteWarnings(id);
    this._snapshot(item, 'delete', actor, now);

    if (item.type === 'object' && item.typeId) this._removeTypeEntry(item.typeId, id);
    for (const link of this._parseLinks(item.value)) this._removeBacklink(link, id);
    for (const tag of (item.tags || [])) this._removeTagEntry(tag, id);

    const hex = id.replace(/-/g, '');
    fs.rmSync(
      path.join(this.k, 'links', hex.slice(0, 2), hex.slice(2, 4), id),
      { recursive: true, force: true },
    );
    fs.rmSync(
      path.join(this.k, 'relationships', hex.slice(0, 2), hex.slice(2, 4), id),
      { recursive: true, force: true },
    );
    fs.rmSync(this._itemDir(id), { recursive: true });

    return { warnings };
  }

  // ─── Aliases ───────────────────────────────────────────────────────────────

  setAlias(alias, id) {
    const dir = this._shardDir('aliases', alias);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'target.txt'), id + '\n');
  }

  removeAlias(alias) {
    fs.rmSync(this._shardDir('aliases', alias), { recursive: true, force: true });
  }

  listAliases() {
    const results = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
        else if (e.name === 'target.txt') {
          results.push({
            alias: path.basename(path.dirname(path.join(dir, e.name))),
            targetId: fs.readFileSync(path.join(dir, e.name), 'utf8').trim(),
          });
        }
      }
    };
    walk(path.join(this.k, 'aliases'));
    return results.sort((a, b) => a.alias.localeCompare(b.alias));
  }

  // ─── Annotations ───────────────────────────────────────────────────────────

  annotate(targetId, { author, content, parentAnnotationId = null } = {}) {
    const id = crypto.randomUUID();
    const now = new Date();
    const hex = targetId.replace(/-/g, '');
    const dir = path.join(this.k, 'annotations', hex.slice(0, 2), hex.slice(2, 4), targetId);
    const annotation = {
      id,
      targetId,
      author: author || this.config.owner,
      content,
      createdAt: now.toISOString(),
      parentAnnotationId,
    };
    this._writeJson(path.join(dir, `annotation-${id}.json`), annotation);
    return annotation;
  }

  annotations(targetId) {
    const hex = targetId.replace(/-/g, '');
    const dir = path.join(this.k, 'annotations', hex.slice(0, 2), hex.slice(2, 4), targetId);
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return []; }
    return entries
      .filter(n => n.startsWith('annotation-') && n.endsWith('.json'))
      .map(n => this._readJson(path.join(dir, n), null))
      .filter(Boolean)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  // ─── Relationships ─────────────────────────────────────────────────────────

  relate(sourceId, type, targetId, { createdBy, note = null } = {}) {
    const now = new Date();
    const actor = createdBy || this.config.owner;
    const relId = crypto.randomUUID();
    const relDir = path.join(this.k, 'relationships');

    const srcHex = sourceId.replace(/-/g, '');
    const srcFile = path.join(relDir, srcHex.slice(0, 2), srcHex.slice(2, 4), sourceId, 'relationships.json');
    const srcData = this._readJson(srcFile, { outbound: [], inbound: [] });
    srcData.outbound.push({ id: relId, targetId, type, createdAt: now.toISOString(), createdBy: actor, note });
    this._writeJson(srcFile, srcData);

    const tgtHex = targetId.replace(/-/g, '');
    const tgtFile = path.join(relDir, tgtHex.slice(0, 2), tgtHex.slice(2, 4), targetId, 'relationships.json');
    const tgtData = this._readJson(tgtFile, { outbound: [], inbound: [] });
    tgtData.inbound.push({ id: relId, sourceId, type, createdAt: now.toISOString(), createdBy: actor, note });
    this._writeJson(tgtFile, tgtData);

    return { id: relId, sourceId, targetId, type, createdAt: now.toISOString(), createdBy: actor, note };
  }

  relationships(id) {
    const hex = id.replace(/-/g, '');
    const f = path.join(this.k, 'relationships', hex.slice(0, 2), hex.slice(2, 4), id, 'relationships.json');
    return this._readJson(f, { outbound: [], inbound: [] });
  }

  backlinks(id) {
    const hex = id.replace(/-/g, '');
    const f = path.join(this.k, 'links', hex.slice(0, 2), hex.slice(2, 4), id, 'backlinks.json');
    return this._readJson(f, { backlinks: [] }).backlinks;
  }

  history(id) {
    const dir = this._historyDir(id);
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return []; }
    return entries
      .filter(n => n.endsWith('.json'))
      .map(n => this._readJson(path.join(dir, n), null))
      .filter(Boolean)
      .sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt) || a.changeType.localeCompare(b.changeType));
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  byTag(tag) {
    const f = path.join(this._shardDir('tags', tag), 'items.json');
    return this._readJson(f, { items: [] }).items;
  }

  byType(typeId) {
    const hex = typeId.replace(/-/g, '');
    const f = path.join(this.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId, 'items.json');
    return this._readJson(f, { items: [] }).items;
  }

  listRelationships() {
    const results = [];
    const seen = new Set();
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
        else if (e.name === 'relationships.json') {
          const sourceId = path.basename(path.dirname(path.join(dir, e.name)));
          const data = this._readJson(path.join(dir, e.name), { outbound: [], inbound: [] });
          for (const rel of (data.outbound || [])) {
            if (!seen.has(rel.id)) {
              seen.add(rel.id);
              results.push({ ...rel, sourceId });
            }
          }
        }
      }
    };
    walk(path.join(this.k, 'relationships'));
    return results;
  }

  // ─── Tree ──────────────────────────────────────────────────────────────────

  loadAll() {
    const items = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
        else if (e.name === 'metadata.json') {
          const item = this._readJson(path.join(dir, e.name), null);
          if (item) items.push(item);
        }
      }
    };
    walk(path.join(this.k, 'data'));
    return items;
  }

  children(parentId) {
    return this.loadAll()
      .filter(i => i.parentId === parentId && i.id !== parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  tree(rootId, maxDepth = Infinity) {
    let implicitRoot = false;
    if (!rootId) {
      const dr = this.getDataRoot();
      rootId = dr ? dr.id : null;
      if (!rootId) return [];
      implicitRoot = true;
    }

    const all = this.loadAll();
    const byParent = new Map();
    for (const item of all) {
      if (item.id === item.parentId) continue;
      if (!byParent.has(item.parentId)) byParent.set(item.parentId, []);
      byParent.get(item.parentId).push(item);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);

    const result = [];
    const traverse = (id, depth) => {
      if (depth > maxDepth) return;
      const item = all.find(i => i.id === id);
      if (!item) return;
      result.push({ item, depth });
      for (const child of byParent.get(id) || []) traverse(child.id, depth + 1);
    };

    if (implicitRoot) {
      for (const child of byParent.get(rootId) || []) traverse(child.id, 0);
    } else {
      traverse(rootId, 0);
    }
    return result;
  }

  // ─── Index maintenance ─────────────────────────────────────────────────────

  rebuildIndexes() {
    for (const dir of ['links', 'tags', 'types']) {
      fs.rmSync(path.join(this.k, dir), { recursive: true, force: true });
      fs.mkdirSync(path.join(this.k, dir));
    }
    const all = this.loadAll();
    for (const item of all) {
      if (item.type === 'object' && item.typeId) this._addTypeEntry(item.typeId, item.id);
      for (const link of this._parseLinks(item.value)) this._addBacklink(link, item.id);
      for (const tag of (item.tags || [])) this._addTagEntry(tag, item.id);
    }
    return all.length;
  }
}

module.exports = { FilesystemAdapter, ROOT_ID, WELL_KNOWN_TYPES, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE };
