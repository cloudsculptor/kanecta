'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { version: specVersion, metadata: metadataSpec } = require('@kanecta/specification');

function validateMetadata(obj) {
  if (typeof obj !== 'object' || obj === null) return 'metadata must be a JSON object';
  for (const key of metadataSpec.required) {
    if (obj[key] === undefined) return `${key} is required`;
  }
  return null;
}

const ROOT_ID = '00000000-0000-0000-0000-000000000000';
const TYPES_NODE = '11111111-1111-1111-1111-111111111111';
const WELL_KNOWN_TYPES = new Set(['root', 'system_root', 'app_root', 'component_root', 'data_root']);
const WELL_KNOWN_ORDER = ['system_root', 'app_root', 'component_root', 'data_root'];

const VALID_TYPES = [
  'string', 'number', 'text', 'heading', 'file', 'symlink', 'url', 'image', 'function', 'markdown', 'runner',
  'object', 'annotation', 'connector',
  'root', 'system_root', 'app_root', 'component_root', 'data_root',
];
const VALID_CONFIDENCES = ['experimental', 'exploring', 'decided', 'locked', 'low', 'medium', 'high', 'verified'];
const VALID_REL_TYPES = [
  'relates-to', 'depends-on', 'enables', 'contradicts',
  'blocks', 'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LICENSE = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739'; // All Rights Reserved (Copyright)
const LINK_SOURCE = '\\[\\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\]\\]';

// Thrown by query({ strictTypes: true }) when a named type isn't a registered
// type definition (and isn't a built-in primitive type). Shape is mirrored by
// the Postgres adapter so callers/MCP can branch on `.name`/`.code` identically.
class UnknownTypeError extends Error {
  constructor(typeName) {
    super(`unknown type "${typeName}" — not a registered type definition`);
    this.name = 'UnknownTypeError';
    this.code = 'UNKNOWN_TYPE';
    this.typeName = typeName;
  }
}

class FilesystemAdapter {
  constructor(root) {
    this.root = path.resolve(root);
    this.k = path.join(this.root, '.kanecta');
    this._config = null;
    this._roots = null;
  }

  static isDatastore(root) {
    return fs.existsSync(path.join(root, '.kanecta', 'config', 'config.json'));
  }

  static init(root, owner) {
    const dirs = [
      'data', 'aliases', 'annotations', 'config', 'history', 'links',
      'relationships', 'remotes', 'remotes-index', 'search', 'tags', 'types',
    ];
    const k = path.join(root, '.kanecta');
    fs.mkdirSync(k, { recursive: true });
    for (const d of dirs) fs.mkdirSync(path.join(k, d), { recursive: true });
    const config = { owner, specVersion: '1.4.0' };
    fs.writeFileSync(
      path.join(k, 'config', 'config.json'),
      JSON.stringify(config, null, 2) + '\n',
    );
    const adapter = new FilesystemAdapter(root);
    adapter._initRoots();
    adapter.create({ value: 'Welcome to Kanecta!', type: 'text', owner });
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

  _writeMetadata(filePath, item) {
    const err = validateMetadata(item);
    if (err) throw new Error(`Invalid metadata: ${err}`);
    this._writeJson(filePath, item);
  }

  // ─── Typed-object helpers (object.json / meta.json / synthetic nodes) ────────

  _typeDir(typeId) {
    const hex = typeId.replace(/-/g, '');
    return path.join(this.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId);
  }

  _isSyntheticId(id) {
    return typeof id === 'string' && id.includes('__');
  }

  _parseSyntheticId(id) {
    const sep = id.indexOf('__');
    return { realId: id.slice(0, sep), fieldPath: id.slice(sep + 2) };
  }

  _toTitleCase(key) {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
  }

  _buildSyntheticNode(realId, parentId, key, val, fieldPath, sortOrder) {
    const isObj = val !== null && typeof val === 'object' && !Array.isArray(val);
    const isNull = val === null || val === undefined;
    return {
      id: `${realId}__${fieldPath}`,
      parentId,
      value: this._toTitleCase(key),
      type: 'object',
      typeId: null,
      owner: null,
      license: null,
      sortOrder,
      confidence: null,
      status: null,
      tags: [],
      createdAt: null,
      modifiedAt: null,
      createdBy: null,
      modifiedBy: null,
      cachedAt: null,
      expiresAt: null,
      deletedAt: null,
      connectorId: null,
      materialized: null,
      completedAt: null,
      dueAt: null,
      _synthetic: true,
      _fieldPath: fieldPath,
      _realId: realId,
      childCount: isNull ? 0 : isObj ? Object.keys(val).length : 1,
    };
  }

  _buildValueLeaf(realId, parentFieldPath, val) {
    const isArr = Array.isArray(val);
    const parentId = parentFieldPath ? `${realId}__${parentFieldPath}` : realId;
    return {
      id: `${realId}__${parentFieldPath}.__`,
      parentId,
      value: isArr ? val.join(', ') : String(val ?? ''),
      type: 'object',
      typeId: null,
      owner: null,
      license: null,
      sortOrder: 0,
      confidence: null,
      status: null,
      tags: [],
      createdAt: null,
      modifiedAt: null,
      createdBy: null,
      modifiedBy: null,
      cachedAt: null,
      expiresAt: null,
      deletedAt: null,
      connectorId: null,
      materialized: null,
      completedAt: null,
      dueAt: null,
      _synthetic: true,
      _fieldPath: `${parentFieldPath}.__`,
      _realId: realId,
      childCount: 0,
    };
  }

  _buildSyntheticChildren(realId, obj, parentId, prefix = '') {
    return Object.entries(obj).map(([key, val], i) => {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      return this._buildSyntheticNode(realId, parentId, key, val, fieldPath, i);
    });
  }

  readObjectJson(id) {
    if (this._isSyntheticId(id)) return null;
    return this._readJson(path.join(this._itemDir(id), 'object.json'), null);
  }

  writeObjectJson(id, data) {
    this._writeJson(path.join(this._itemDir(id), 'object.json'), data);
  }

  readFunctionJson(id) {
    if (this._isSyntheticId(id)) return null;
    return this._readJson(path.join(this._itemDir(id), 'function.json'), null);
  }

  writeFunctionJson(id, data) {
    this._writeJson(path.join(this._itemDir(id), 'function.json'), data);
  }

  readTimeJson(id) {
    if (this._isSyntheticId(id)) return null;
    return this._readJson(path.join(this._itemDir(id), 'time.json'), null);
  }

  writeTimeJson(id, data) {
    this._writeJson(path.join(this._itemDir(id), 'time.json'), data);
  }

  deleteTimeJson(id) {
    const f = path.join(this._itemDir(id), 'time.json');
    try { fs.unlinkSync(f); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }

  // ─── File store (no-op stubs — filesystem adapter stores files on disk directly) ─

  putFile(_itemId, _filename, _body, _opts) {
    throw new Error('putFile is not supported in filesystem mode');
  }

  getFile(_itemId, _filename) {
    return null;
  }

  deleteFile(_itemId, _filename) {}

  listFiles(_itemId) {
    return [];
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
      id, specVersion, parentId, value: type === 'data_root' ? "Your name or organisation's name here" : type, type,
      typeId: null, owner, license: DEFAULT_LICENSE, visibility: 'private', aspect: null, sortOrder,
      confidence: null, tags: [],
      createdAt: now.toISOString(), modifiedAt: now.toISOString(),
      createdBy: owner, modifiedBy: owner,
      cachedAt: null, expiresAt: null, deletedAt: null, connectorId: null, materialized: null,
      completedAt: null, dueAt: null,
    };
    this._writeMetadata(path.join(this._itemDir(id), 'metadata.json'), item);
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
    owner, license = null, sortOrder, confidence = null, status = null, tags = [],
    createdBy, objectData = null, dueAt = null, visibility = 'private', aspect = null,
    strict,
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
      const siblings = this.children(parentId, aspect);
      sortOrder = siblings.length === 0 ? 0 : Math.max(...siblings.map(s => s.sortOrder)) + 1;
    }

    const item = {
      id,
      specVersion,
      parentId,
      value,
      type,
      typeId: type === 'object' ? (typeId || null) : null,
      owner: ownerVal,
      license: license ?? DEFAULT_LICENSE,
      visibility,
      aspect,
      sortOrder,
      confidence,
      status,
      tags: [...tags],
      createdAt: now.toISOString(),
      modifiedAt: now.toISOString(),
      createdBy: actor,
      modifiedBy: actor,
      cachedAt: null,
      expiresAt: null,
      deletedAt: null,
      connectorId: null,
      materialized: null,
      completedAt: null,
      dueAt,
    };

    // Referential-integrity guard BEFORE any write, so strict mode refuses the
    // write atomically (no partial node left behind).
    let typeWarning = null;
    if (type === 'object' && typeId && this._getTypeName(typeId) === null) {
      typeWarning = this._guardTypeIdRef(typeId, strict); // throws under strict
    }

    this._writeMetadata(path.join(this._itemDir(id), 'metadata.json'), item);

    // C1 + C2: for typed objects, always write meta.json and object.json
    if (type === 'object' && typeId) {
      const typeMeta = this._readJson(path.join(this._typeDir(typeId), 'metadata.json'), null);
      const typeSpec = this._readJson(path.join(this._typeDir(typeId), 'type.json'), null);
      if (typeMeta) {
        const icon = typeSpec?.meta?.icon ?? null;
        this._writeJson(path.join(this._itemDir(id), 'meta.json'), { ...typeMeta, type: 'object', ...(icon ? { icon } : {}) });
      }
      this._writeJson(path.join(this._itemDir(id), 'object.json'), objectData ?? {});
    }

    if (item.typeId) this._addTypeEntry(item.typeId, id);
    for (const link of this._parseLinks(value)) this._addBacklink(link, id);
    for (const tag of tags) this._addTagEntry(tag, id);
    this._snapshot(item, 'create', actor, now);

    // Non-enumerable so the persisted metadata and JSON of the item are unchanged.
    if (typeWarning) {
      Object.defineProperty(item, 'warning', { value: typeWarning, enumerable: false, configurable: true });
    }

    return item;
  }

  get(id) {
    if (this._isSyntheticId(id)) {
      const { realId, fieldPath } = this._parseSyntheticId(id);
      const obj = this.readObjectJson(realId);
      if (!obj) return null;

      // Terminal value leaf (e.g. "title.__")
      if (fieldPath.endsWith('.__')) {
        const parentPath = fieldPath.slice(0, -3);
        const parts = parentPath ? parentPath.split('.') : [];
        let cur = obj;
        for (const p of parts) {
          if (!cur || typeof cur !== 'object') return null;
          cur = cur[p];
        }
        if (cur === undefined || cur === null) return null;
        return this._buildValueLeaf(realId, parentPath, cur);
      }

      const parts = fieldPath.split('.');
      let cur = obj;
      for (const p of parts.slice(0, -1)) {
        if (!cur || typeof cur !== 'object') return null;
        cur = cur[p];
      }
      const key = parts[parts.length - 1];
      const val = cur?.[key];
      if (val === undefined) return null;
      const parentFieldPath = parts.slice(0, -1).join('.');
      const parentId = parentFieldPath ? `${realId}__${parentFieldPath}` : realId;
      return this._buildSyntheticNode(realId, parentId, key, val, fieldPath, 0);
    }
    const item = this._readJson(path.join(this._itemDir(id), 'metadata.json'), null);
    if (!item) return null;
    const metaExtra = this._readJson(path.join(this._itemDir(id), 'meta.json'), null);
    if (metaExtra?.icon) item.icon = metaExtra.icon;
    return item;
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

  update(id, changes, actor, { strict } = {}) {
    const current = this.get(id);
    this._assertEditable(current, id);

    // Referential-integrity guard BEFORE snapshot/index mutations, so strict
    // mode refuses the write atomically. Compute the prospective new typeId.
    // NOTE: gated on the typeId actually *changing* — strict only blocks newly
    // introduced orphan references, it does NOT re-validate an item that already
    // carries an orphan typeId (legacy data, or one written in warn-mode) when
    // you edit its other fields. `doctor` remains the backstop for those.
    let prospectiveTypeId;
    if ('type' in changes && changes.type !== current.type) {
      prospectiveTypeId = changes.type === 'object' ? (changes.typeId || null) : null;
    } else if ('typeId' in changes && current.type === 'object') {
      prospectiveTypeId = changes.typeId;
    }
    let typeWarning = null;
    if (prospectiveTypeId && prospectiveTypeId !== current.typeId && this._getTypeName(prospectiveTypeId) === null) {
      typeWarning = this._guardTypeIdRef(prospectiveTypeId, strict); // throws under strict
    }

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

    if (updated.typeId && updated.typeId !== current.typeId) {
      const typeMeta = this._readJson(path.join(this._typeDir(updated.typeId), 'metadata.json'), null);
      const typeSpec = this._readJson(path.join(this._typeDir(updated.typeId), 'type.json'), null);
      if (typeMeta) {
        const icon = typeSpec?.meta?.icon ?? null;
        this._writeJson(path.join(this._itemDir(id), 'meta.json'), { ...typeMeta, type: 'object', ...(icon ? { icon } : {}) });
      }
    }

    if ('parentId' in changes) updated.parentId = changes.parentId;
    if ('sortOrder' in changes) updated.sortOrder = changes.sortOrder;
    if ('confidence' in changes) updated.confidence = changes.confidence;
    if ('status' in changes) updated.status = changes.status;
    if ('license' in changes) updated.license = changes.license;
    if ('visibility' in changes) updated.visibility = changes.visibility;
    if ('aspect' in changes) updated.aspect = changes.aspect;
    if ('cachedAt' in changes) updated.cachedAt = changes.cachedAt;
    if ('expiresAt' in changes) updated.expiresAt = changes.expiresAt;
    if ('connectorId' in changes) updated.connectorId = changes.connectorId;
    if ('materialized' in changes) updated.materialized = changes.materialized;
    if ('completedAt' in changes) updated.completedAt = changes.completedAt;
    if ('dueAt' in changes) updated.dueAt = changes.dueAt;

    if ('tags' in changes) {
      const oldTags = current.tags || [];
      const newTags = changes.tags;
      for (const t of oldTags) if (!newTags.includes(t)) this._removeTagEntry(t, id);
      for (const t of newTags) if (!oldTags.includes(t)) this._addTagEntry(t, id);
      updated.tags = newTags;
    }

    updated.modifiedAt = now.toISOString();
    updated.modifiedBy = actor;

    this._writeMetadata(path.join(this._itemDir(id), 'metadata.json'), updated);

    if (typeWarning) {
      Object.defineProperty(updated, 'warning', { value: typeWarning, enumerable: false, configurable: true });
    }

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
    if (this._isSyntheticId(id)) return { warnings: [] };
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

  // Soft-delete: set deletedAt timestamp. Item remains on disk, excluded from
  // default queries. Use restore() to undelete. Hard delete uses delete().
  softDelete(id, actor) {
    const item = this.get(id);
    this._assertEditable(item, id);
    actor = actor || this.config.owner;
    const now = new Date();
    this._snapshot(item, 'soft-delete', actor, now);
    const updated = { ...item, deletedAt: now.toISOString(), modifiedAt: now.toISOString(), modifiedBy: actor };
    this._writeMetadata(path.join(this._itemDir(id), 'metadata.json'), updated);
    return updated;
  }

  // Restore a soft-deleted item by clearing deletedAt.
  restore(id, actor) {
    const item = this.get(id);
    if (!item) throw new Error(`Item not found: ${id}`);
    actor = actor || this.config.owner;
    const now = new Date();
    this._snapshot(item, 'restore', actor, now);
    const updated = { ...item, deletedAt: null, modifiedAt: now.toISOString(), modifiedBy: actor };
    this._writeMetadata(path.join(this._itemDir(id), 'metadata.json'), updated);
    return updated;
  }

  // ─── Type definitions ─────────────────────────────────────────────────────

  createType(value, { schema, createdBy, id: explicitId } = {}) {
    if (!value || typeof value !== 'string' || !value.trim())
      throw new Error('value is required');

    const id = explicitId || crypto.randomUUID();
    const now = new Date();
    const owner = this.config.owner;
    const actor = createdBy || owner;

    const metadata = {
      id,
      specVersion,
      parentId: null,
      value: value.trim(),
      type: 'type',
      typeId: null,
      owner,
      license: null,
      sortOrder: null,
      confidence: null,
      status: null,
      tags: [],
      createdAt: now.toISOString(),
      modifiedAt: now.toISOString(),
      createdBy: actor,
      modifiedBy: actor,
      cachedAt: null,
      expiresAt: null,
      deletedAt: null,
      connectorId: null,
      materialized: null,
      completedAt: null,
      dueAt: null,
    };

    const resolvedSchema = schema || {
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

    const typeDir = this._typeDir(id);
    this._writeMetadata(path.join(typeDir, 'metadata.json'), metadata);
    this._writeJson(path.join(typeDir, 'type.json'), resolvedSchema);

    return { metadata, schema: resolvedSchema };
  }

  readTypeJson(id) {
    return this._readJson(path.join(this._typeDir(id), 'type.json'), null);
  }

  writeTypeJson(id, data) {
    this._writeJson(path.join(this._typeDir(id), 'type.json'), data);
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

  // Effective relationship types = built-in defaults ∪ datastore-configured extras (config.relTypes).
  get relTypes() {
    const extra = Array.isArray(this.config.relTypes) ? this.config.relTypes : [];
    return [...new Set([...VALID_REL_TYPES, ...extra])];
  }

  // Register additional datastore-level relationship types (persisted to config.json, deduped vs built-ins).
  // Names must be lowercase slugs (e.g. "affects", "evidenced-by"). Idempotent. Returns the effective list.
  addRelTypes(names) {
    const list = (Array.isArray(names) ? names : [names]).map((n) => String(n).trim()).filter(Boolean);
    for (const n of list) {
      if (!/^[a-z][a-z0-9-]*$/.test(n))
        throw new Error(`Invalid relationship type name: "${n}" (use a lowercase slug, e.g. "affects")`);
    }
    const cfg = this.config;
    const builtins = new Set(VALID_REL_TYPES);
    const existing = Array.isArray(cfg.relTypes) ? cfg.relTypes : [];
    cfg.relTypes = [...new Set([...existing, ...list.filter((n) => !builtins.has(n))])];
    this._writeJson(path.join(this.k, 'config', 'config.json'), cfg);
    this._config = cfg;
    return this.relTypes;
  }

  relate(sourceId, type, targetId, { createdBy, note = null } = {}) {
    if (!this.relTypes.includes(type))
      throw new Error(`Invalid relationship type: ${type}. Valid: ${this.relTypes.join(', ')}`);
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
          if (item) {
            if (item.type === 'object') {
              const metaExtra = this._readJson(path.join(dir, 'meta.json'), null);
              if (metaExtra?.icon) item.icon = metaExtra.icon;
            }
            items.push(item);
          }
        }
      }
    };
    walk(path.join(this.k, 'data'));
    return items;
  }

  children(parentId, aspect = null) {
    // C3: synthetic parent — navigate into the nested object field
    if (this._isSyntheticId(parentId)) {
      const { realId, fieldPath } = this._parseSyntheticId(parentId);

      // Terminal value leaf — no children
      if (fieldPath.endsWith('.__')) return [];

      const obj = this.readObjectJson(realId);
      if (!obj) return [];
      const parts = fieldPath.split('.');
      let cur = obj;
      for (const p of parts) {
        if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return [];
        cur = cur[p];
      }
      if (cur === null || cur === undefined) return [];
      const isPlainObj = typeof cur === 'object' && !Array.isArray(cur);
      if (isPlainObj) return this._buildSyntheticChildren(realId, cur, parentId, fieldPath);
      return [this._buildValueLeaf(realId, fieldPath, cur)];
    }

    const realChildren = this.loadAll()
      .filter(i => i.parentId === parentId && i.id !== parentId && (i.aspect ?? null) === aspect)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // C3: prepend synthetic children from object.json if present
    const obj = this.readObjectJson(parentId);
    if (!obj) return realChildren;
    const synChildren = this._buildSyntheticChildren(parentId, obj, parentId);
    return [...synChildren, ...realChildren];
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
      if (this._isSyntheticId(id)) {
        const item = this.get(id);
        if (!item) return;
        result.push({ item, depth });
        if (depth < maxDepth) {
          for (const child of this.children(id)) traverse(child.id, depth + 1);
        }
        return;
      }
      const item = all.find(i => i.id === id);
      if (!item) return;
      result.push({ item, depth });
      if (depth >= maxDepth) return;
      for (const child of byParent.get(id) || []) traverse(child.id, depth + 1);
      const obj = this.readObjectJson(id);
      if (obj) {
        for (const synChild of this._buildSyntheticChildren(id, obj, id)) traverse(synChild.id, depth + 1);
      }
    };

    if (implicitRoot) {
      for (const child of byParent.get(rootId) || []) traverse(child.id, 0);
    } else {
      traverse(rootId, 0);
    }
    return result;
  }

  _getTypeName(typeId) {
    if (!typeId) return null;
    const hex = typeId.replace(/-/g, '');
    const f = path.join(this.k, 'types', hex.slice(0, 2), hex.slice(2, 4), typeId, 'metadata.json');
    const meta = this._readJson(f, null);
    return meta ? meta.value : null;
  }

  // Referential-integrity guard for object writes. Called only when `typeId`
  // has no type definition. Strict (per-call `strict`, else the datastore-level
  // `config.strictTypeIds`) → throw and refuse the write; otherwise return a
  // warning string and let the write proceed (warn-by-default, non-breaking).
  _guardTypeIdRef(typeId, strict) {
    const effectiveStrict = strict !== undefined ? !!strict : !!this.config.strictTypeIds;
    if (effectiveStrict) {
      const err = new Error(`unknown typeId "${typeId}" — no registered type definition`);
      err.name = 'UnknownTypeError';
      err.code = 'UNKNOWN_TYPE';
      err.typeId = typeId;
      throw err;
    }
    return `typeId ${typeId} has no type definition — node written anyway; run \`kanecta doctor\``;
  }

  // All registered type definitions as { id, value }. A types/<id>/ dir that
  // holds only an items.json index (no metadata.json) is NOT a definition and
  // is skipped — that's exactly the orphan case doctor reports.
  _listTypeDefs() {
    const out = [];
    const base = path.join(this.k, 'types');
    let shards;
    try { shards = fs.readdirSync(base); } catch { return out; }
    for (const s1 of shards) {
      const p1 = path.join(base, s1);
      if (!fs.statSync(p1).isDirectory()) continue;
      for (const s2 of fs.readdirSync(p1)) {
        const p2 = path.join(p1, s2);
        if (!fs.statSync(p2).isDirectory()) continue;
        for (const id of fs.readdirSync(p2)) {
          const meta = this._readJson(path.join(p2, id, 'metadata.json'), null);
          if (meta && meta.value != null) out.push({ id: meta.id ?? id, value: meta.value });
        }
      }
    }
    return out;
  }

  // Resolve a type *name* used in a query. Returns one of:
  //   { primitive: true }     — a built-in type (string/text/object/…)
  //   { id }                  — a registered custom type definition
  //   { unknown: true }       — neither: a typo or a missing type definition
  resolveTypeId(name) {
    if (!name) return { unknown: true };
    if (VALID_TYPES.includes(name)) return { primitive: true };
    for (const def of this._listTypeDefs()) {
      if (def.value === name) return { id: def.id };
    }
    return { unknown: true };
  }

  _evaluatePredicate(fieldValue, op, expectedValue) {
    switch (op) {
      case '=':
        return fieldValue === expectedValue;
      case '!=':
        return fieldValue !== expectedValue;
      case 'in':
        // expectedValue must be an array; non-array silently returns false
        if (!Array.isArray(expectedValue)) return false;
        return expectedValue.includes(fieldValue);
      case 'contains':
        if (typeof fieldValue === 'string') {
          if (typeof expectedValue === 'string') {
            return fieldValue.toLowerCase().includes(expectedValue.toLowerCase());
          }
          return false;
        } else if (Array.isArray(fieldValue)) {
          return fieldValue.some(val => {
            if (typeof val === 'string' && typeof expectedValue === 'string') {
              return val.toLowerCase().includes(expectedValue.toLowerCase());
            }
            return val === expectedValue;
          });
        }
        return false;
      case '>':
        return fieldValue > expectedValue;
      case '<':
        return fieldValue < expectedValue;
      default:
        return false;
    }
  }

  query({ type, where, rootId, sort, limit, strictTypes, includeDeleted = false, excludeExpired = false, expiredOnly = false } = {}) {
    let items = this.loadAll();
    let typeWarning = null;

    // 1. Soft-delete filter: exclude items with deletedAt set unless caller opts in.
    if (!includeDeleted) {
      items = items.filter(i => i.deletedAt == null);
    }

    // 1b. Expiry filters: expiredOnly/excludeExpired are mutually exclusive; expiredOnly wins.
    const now = new Date().toISOString();
    if (expiredOnly) {
      items = items.filter(i => i.expiresAt != null && i.expiresAt <= now);
    } else if (excludeExpired) {
      items = items.filter(i => i.expiresAt == null || i.expiresAt > now);
    }

    // 2. Root ID Scoping (including rootId itself and all descendants)
    if (rootId) {
      const parentToChildren = new Map();
      for (const item of items) {
        if (item.id === item.parentId) continue;
        if (!parentToChildren.has(item.parentId)) {
          parentToChildren.set(item.parentId, []);
        }
        parentToChildren.get(item.parentId).push(item.id);
      }

      const subtreeIds = new Set();
      const traverse = (id) => {
        if (subtreeIds.has(id)) return;
        subtreeIds.add(id);
        const children = parentToChildren.get(id) || [];
        for (const childId of children) {
          traverse(childId);
        }
      };
      traverse(rootId);
      items = items.filter(item => subtreeIds.has(item.id));
    }

    // 3. Type Filtering. Resolve the name once (distinguishing "no such type"
    // from "type exists but empty"), then filter by the resolved id instead of
    // re-reading each candidate's type metadata.
    if (type) {
      const resolved = this.resolveTypeId(type);
      if (resolved.unknown) {
        if (strictTypes) throw new UnknownTypeError(type);
        typeWarning = `unknown type "${type}" — not a registered type definition; run \`kanecta doctor\``;
        items = []; // nothing can match an unregistered, non-primitive name
      } else if (resolved.id !== undefined) {
        // Registered custom type → typed objects carrying that typeId.
        items = items.filter(item => item.type === 'object' && item.typeId === resolved.id);
      } else {
        // Built-in primitive → items of that type, excluding typed objects
        // (whose effective type is their custom type name, matched above).
        items = items.filter(item => item.type === type && !(item.type === 'object' && item.typeId));
      }
    }

    // 4. Where Clause Filter & Attach objectData inline
    const hasWhere = where && Object.keys(where).length > 0;
    
    items = items.map(item => {
      if (item.type === 'object') {
        const objectData = this.readObjectJson(item.id);
        return { ...item, objectData };
      }
      return item;
    });

    if (hasWhere) {
      items = items.filter(item => {
        if (item.type !== 'object' || !item.objectData) return false;

        for (const [field, predicate] of Object.entries(where)) {
          const fieldValue = item.objectData[field];

          let op = '=';
          let expectedValue = predicate;
          if (predicate !== null && typeof predicate === 'object' && 'op' in predicate && 'value' in predicate) {
            op = predicate.op;
            expectedValue = predicate.value;
          }

          if (!this._evaluatePredicate(fieldValue, op, expectedValue)) {
            return false;
          }
        }
        return true;
      });
    }

    // 5. Sorting
    if (sort && sort.field) {
      const { field, dir = 'asc' } = sort;
      const isDesc = dir.toLowerCase() === 'desc';

      items.sort((a, b) => {
        let valA = a[field];
        let valB = b[field];

        if (valA === undefined && a.objectData) valA = a.objectData[field];
        if (valB === undefined && b.objectData) valB = b.objectData[field];

        if (valA === undefined || valA === null) return isDesc ? -1 : 1;
        if (valB === undefined || valB === null) return isDesc ? 1 : -1;

        if (valA < valB) return isDesc ? 1 : -1;
        if (valA > valB) return isDesc ? -1 : 1;
        return 0;
      });
    }

    // 6. Limit
    // limit must be a positive integer; 0 or negative is treated as "no limit" (return all).
    // Callers should pass a positive integer or omit the field to use the default of 50.
    const finalLimit = (limit !== undefined && Number.isInteger(limit) && limit > 0) ? limit : (limit === undefined ? 50 : 0);
    if (finalLimit > 0) {
      items = items.slice(0, finalLimit);
    }

    // Warn-by-default channel: a non-enumerable property so the empty-result
    // return value is unchanged for existing callers (length/iteration/JSON of
    // the array itself are all untouched). The MCP layer reads `items.warning`.
    if (typeWarning) {
      Object.defineProperty(items, 'warning', { value: typeWarning, enumerable: false, configurable: true });
    }

    return items;
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

  // ─── Integrity checks ──────────────────────────────────────────────────────

  // Read-only health scan. Returns a flat array of findings:
  //   { check, severity: 'error' | 'warn', nodeId?, typeId?, message, fix? }
  // `checks` (optional) restricts the run to the named subset; default runs all.
  checkIntegrity({ checks } = {}) {
    const wanted = Array.isArray(checks) && checks.length ? new Set(checks) : null;
    const run = (name) => !wanted || wanted.has(name);
    const findings = [];

    // orphan-type-id: object nodes whose typeId has no type definition.
    if (run('orphan-type-id')) {
      const typeNameCache = new Map();
      const typeName = (typeId) => {
        if (!typeNameCache.has(typeId)) typeNameCache.set(typeId, this._getTypeName(typeId));
        return typeNameCache.get(typeId);
      };
      for (const item of this.loadAll()) {
        if (item.type !== 'object' || !item.typeId) continue;
        if (typeName(item.typeId) === null) {
          findings.push({
            check: 'orphan-type-id',
            severity: 'error',
            nodeId: item.id,
            typeId: item.typeId,
            message: `object ${item.id} references typeId ${item.typeId}, which has no type definition`,
            fix: 'register the missing type definition, or remove/retype the node',
          });
        }
      }
    }

    return findings;
  }
}

module.exports = { FilesystemAdapter, UnknownTypeError, ROOT_ID, TYPES_NODE, WELL_KNOWN_TYPES, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE, DEFAULT_LICENSE };
