#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { Datastore, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES } = require('@kanecta/lib');

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), '.kanecta-config.json');
const DEFAULT_DATASTORE_PATH = path.join(os.homedir(), '.kanecta');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return null; }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

function openDs() {
  const cfg = readConfig();
  const datastorePath = cfg?.datastorePath
    ? cfg.datastorePath.replace(/^~/, os.homedir())
    : (process.env.KANECTA_DATASTORE?.replace(/^~/, os.homedir()) ?? DEFAULT_DATASTORE_PATH);
  return { ds: Datastore.open(datastorePath), cfg, datastorePath };
}

// ─── Secret detection ─────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', re: /gh[psoure]_[a-zA-Z0-9]{36,}/ },
  { name: 'JWT', re: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
  { name: 'private key', re: /-----BEGIN [A-Z ]+ PRIVATE KEY-----/ },
  { name: 'secret/password field', re: /(password|passwd|secret|api[_-]?key|private[_-]?key|access[_-]?token)\s*[=:]\s*\S{8,}/i },
];

function detectSecrets(text) {
  if (!text || typeof text !== 'string') return [];
  return SECRET_PATTERNS.filter(({ re }) => re.test(text)).map(({ name }) => name);
}

// ─── Link resolution ──────────────────────────────────────────────────────────

const WIKILINK_RE = /\[\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]\]/g;

function resolveLinks(ds, value) {
  if (!value || typeof value !== 'string') return value;
  return value.replace(WIKILINK_RE, (match, uuid) => {
    const item = ds.get(uuid);
    return item ? `[[${uuid}|${item.value}]]` : match;
  });
}

function resolveItem(ds, item) {
  if (!item || typeof item.value !== 'string') return item;
  return { ...item, value: resolveLinks(ds, item.value) };
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────

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

// ─── Tools ────────────────────────────────────────────────────────────────────

const TOOLS = [
  // ── Capture & search ────────────────────────────────────────────────────────
  {
    name: 'kanecta_capture',
    description: 'Save context, decisions, insights, or facts to the Kanecta knowledge base. Use for anything worth remembering across sessions. Never call this with secrets, API keys, passwords, or tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The content to capture' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags (e.g. ["decision", "architecture"])' },
        type: { type: 'string', enum: ['text', 'string', 'decision'], description: 'Item type — defaults to "text"' },
      },
      required: ['text'],
    },
  },
  {
    name: 'kanecta_search',
    description: 'Search the Kanecta knowledge base for past context, decisions, or facts. Case-insensitive substring match across all item values. Pass rootId to scope the search to a subtree.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        rootId: { type: 'string', description: 'Optional item UUID — restrict results to descendants of this item' },
        limit: { type: 'number', description: 'Maximum results (default: 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'kanecta_recent',
    description: 'List the most recent captures from the knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        n: { type: 'number', description: 'Number of items to return (default: 10)' },
      },
    },
  },

  // ── Item CRUD ────────────────────────────────────────────────────────────────
  {
    name: 'kanecta_get',
    description: 'Get a specific item from the knowledge base by UUID or alias.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Item UUID or alias' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'kanecta_get_children',
    description: 'Get the direct children of an item. Omit parentId to list root-level items.',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: { type: 'string', description: 'Parent UUID — omit for root items' },
      },
    },
  },
  {
    name: 'kanecta_get_tree',
    description: 'Get an item and its subtree expanded to a given depth.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Root item UUID or alias' },
        depth: { type: 'number', description: 'Depth to expand (default: 3)' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'kanecta_get_ancestors',
    description: 'Get the full ancestor chain (path to root) for an item. Returns an array ordered from root down to the immediate parent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Item UUID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'kanecta_add_item',
    description: 'Add a new item to the knowledge base with explicit placement. Use kanecta_capture for saving insights — this is for structured data entry.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Item value/content' },
        type: { type: 'string', description: `Item type (${VALID_TYPES.join(', ')})` },
        parentId: { type: 'string', description: 'Parent UUID — omit for root' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
        alias: { type: 'string', description: 'Optional human-readable alias for this item' },
        sortOrder: { type: 'number', description: 'Sort position among siblings (omit to append)' },
        confidence: { type: 'string', enum: VALID_CONFIDENCES, description: 'Confidence level' },
      },
    },
  },
  {
    name: 'kanecta_update_item',
    description: 'Update an existing item in the knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Item UUID' },
        value: { type: 'string', description: 'New value/content' },
        type: { type: 'string', description: 'New type' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replace tags' },
        parentId: { type: 'string', description: 'Move item to a new parent UUID' },
        sortOrder: { type: 'number', description: 'New sort position among siblings' },
        confidence: { type: 'string', enum: VALID_CONFIDENCES, description: 'Confidence level' },
      },
      required: ['id'],
    },
  },
  {
    name: 'kanecta_delete_item',
    description: 'Delete an item and all its descendants from the knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Item UUID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'kanecta_bulk_create',
    description: 'Create multiple items in one call. Items are created in array order — use this for template instantiation instead of 9 sequential kanecta_add_item calls.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Items to create',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              type: { type: 'string' },
              parentId: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              alias: { type: 'string' },
              sortOrder: { type: 'number' },
            },
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'kanecta_bulk_update',
    description: 'Update multiple items in one call. Accepts an array of {id, ...changes} objects.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          description: 'Updates to apply',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              value: { type: 'string' },
              type: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              parentId: { type: 'string' },
              sortOrder: { type: 'number' },
            },
            required: ['id'],
          },
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'kanecta_clone',
    description: 'Deep-copy an item and all its descendants under a new parent. Returns the new root item. Use for template instantiation.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'UUID of the item (and subtree) to clone' },
        targetParentId: { type: 'string', description: 'UUID of the parent to place the clone under' },
      },
      required: ['sourceId', 'targetParentId'],
    },
  },

  // ── Aliases ──────────────────────────────────────────────────────────────────
  {
    name: 'kanecta_set_alias',
    description: 'Set a human-readable alias that resolves to an item UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        alias: { type: 'string', description: 'The alias string' },
        targetId: { type: 'string', description: 'Item UUID the alias points to' },
      },
      required: ['alias', 'targetId'],
    },
  },

  // ── Relationships ────────────────────────────────────────────────────────────
  {
    name: 'kanecta_relate',
    description: `Create a typed semantic relationship between two items. Valid types: ${VALID_REL_TYPES.join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'UUID of the source item' },
        type: { type: 'string', enum: VALID_REL_TYPES, description: 'Relationship type' },
        targetId: { type: 'string', description: 'UUID of the target item' },
        note: { type: 'string', description: 'Optional note about the relationship' },
      },
      required: ['sourceId', 'type', 'targetId'],
    },
  },
  {
    name: 'kanecta_get_relationships',
    description: 'Get all relationships (inbound and outbound) for an item.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Item UUID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'kanecta_get_backlinks',
    description: 'Get all items that contain [[uuid]] inline links pointing to this item.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Item UUID' },
      },
      required: ['id'],
    },
  },

  // ── Annotations ──────────────────────────────────────────────────────────────
  {
    name: 'kanecta_annotate',
    description: 'Add a threaded comment or annotation to an item without modifying it.',
    inputSchema: {
      type: 'object',
      properties: {
        targetId: { type: 'string', description: 'UUID of the item to annotate' },
        content: { type: 'string', description: 'Annotation text' },
        parentAnnotationId: { type: 'string', description: 'UUID of parent annotation for threaded replies' },
      },
      required: ['targetId', 'content'],
    },
  },
  {
    name: 'kanecta_get_annotations',
    description: 'List all annotations on an item.',
    inputSchema: {
      type: 'object',
      properties: {
        targetId: { type: 'string', description: 'Item UUID' },
      },
      required: ['targetId'],
    },
  },

  // ── Type definitions ─────────────────────────────────────────────────────────
  {
    name: 'kanecta_list_types',
    description: 'List all custom type definitions in the Kanecta datastore. Returns metadata including icon, description, keywords, and tags for each type.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'kanecta_get_type_schema',
    description: 'Get the full type definition (type.json) for a custom type by UUID. Returns the meta and jsonSchema fields.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Type definition UUID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'kanecta_update_type_schema',
    description: 'Update the type definition (type.json) for a custom type. Pass the full updated definition including meta and jsonSchema.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Type definition UUID' },
        schema: { type: 'object', description: 'Full type definition object with meta and jsonSchema fields' },
      },
      required: ['id', 'schema'],
    },
  },

  // ── Tag queries ──────────────────────────────────────────────────────────────
  {
    name: 'kanecta_by_tag',
    description: 'List all items carrying a given tag.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Tag name' },
      },
      required: ['tag'],
    },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

function ensureDateBucket(ds, cfg) {
  const today = new Date().toISOString().slice(0, 10);
  if (cfg?.lastCaptureDate === today && cfg?.lastCaptureDateId) {
    return cfg.lastCaptureDateId;
  }
  const bucket = ds.create({
    value: today,
    type: 'string',
    parentId: cfg?.capturesRootId || null,
    owner: cfg?.owner || ds.config.owner,
    tags: ['kanecta-date'],
  });
  ds.setAlias(`kanecta-date-${today}`, bucket.id);
  if (cfg) {
    cfg.lastCaptureDate = today;
    cfg.lastCaptureDateId = bucket.id;
    writeConfig(cfg);
  }
  return bucket.id;
}

function handleCapture(args, ds, cfg) {
  const { text, tags = [], type = 'text' } = args;
  const secrets = detectSecrets(text);
  if (secrets.length) {
    return { error: `Capture rejected — possible secret detected (${secrets.join(', ')}). Kanecta never stores secrets.` };
  }
  const dateBucketId = ensureDateBucket(ds, cfg);
  const allTags = ['kanecta-capture', ...tags.filter(t => !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t))];
  const item = ds.create({
    value: text,
    type,
    parentId: dateBucketId,
    owner: cfg?.owner || ds.config.owner,
    tags: allTags,
  });
  return {
    id: item.id,
    date: new Date().toISOString().slice(0, 10),
    tags: allTags.filter(t => t !== 'kanecta-capture'),
    preview: text.slice(0, 120),
  };
}

function handleSearch(args, ds) {
  const { query, rootId, limit = 10 } = args;
  const q = query.toLowerCase();

  let candidates = ds.loadAll()
    .filter(i => i.value && typeof i.value === 'string' && i.value.toLowerCase().includes(q));

  if (rootId) {
    const subtreeIds = new Set(collectSubtreeIds(ds, rootId));
    candidates = candidates.filter(i => subtreeIds.has(i.id));
  }

  const results = candidates
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, limit)
    .map(i => ({
      id: i.id,
      type: i.type,
      tags: (i.tags || []).filter(t => !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t)),
      date: (i.createdAt || '').slice(0, 10),
      value: resolveLinks(ds, i.value),
      ancestors: getAncestorChain(ds, i.id),
    }));

  return { query, count: results.length, results };
}

function handleRecent(args, ds) {
  const { n = 10 } = args;
  const items = ds.loadAll()
    .filter(i => (i.tags || []).includes('kanecta-capture'))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, n)
    .map(i => ({
      id: i.id,
      date: (i.createdAt || '').slice(0, 10),
      tags: (i.tags || []).filter(t => !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t)),
      value: i.value,
    }));
  return { count: items.length, items };
}

// ─── Type definition helpers ──────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function typesDir(datastorePath) {
  return path.join(datastorePath, 'types');
}

function typeShardPath(datastorePath, id) {
  return path.join(typesDir(datastorePath), id.slice(0, 2), id.slice(2, 4), id);
}

function handleListTypes(datastorePath) {
  const dir = typesDir(datastorePath);
  if (!fs.existsSync(dir)) return { types: [] };
  const results = [];
  for (const s1 of fs.readdirSync(dir)) {
    const p1 = path.join(dir, s1);
    if (!fs.statSync(p1).isDirectory()) continue;
    for (const s2 of fs.readdirSync(p1)) {
      const p2 = path.join(p1, s2);
      if (!fs.statSync(p2).isDirectory()) continue;
      for (const id of fs.readdirSync(p2)) {
        const metaPath = path.join(p2, id, 'metadata.json');
        if (!fs.existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          const typePath = path.join(p2, id, 'type.json');
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
  results.sort((a, b) => (a.value || '').localeCompare(b.value || ''));
  return { types: results };
}

function handleGetTypeSchema(datastorePath, id) {
  if (!UUID_RE.test(id)) return { error: 'Invalid UUID format' };
  const schemaPath = path.join(typeShardPath(datastorePath, id), 'type.json');
  if (!fs.existsSync(schemaPath)) return { error: `Type schema not found: ${id}` };
  try {
    return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (err) {
    return { error: err.message };
  }
}

function handleUpdateTypeSchema(datastorePath, id, schema) {
  if (!UUID_RE.test(id)) return { error: 'Invalid UUID format' };
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema))
    return { error: 'Schema must be a JSON object' };
  const schemaPath = path.join(typeShardPath(datastorePath, id), 'type.json');
  if (!fs.existsSync(schemaPath)) return { error: `Type schema not found: ${id}` };
  try {
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
    return schema;
  } catch (err) {
    return { error: err.message };
  }
}

// ─── MCP protocol ─────────────────────────────────────────────────────────────

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function dispatch(name, args) {
  const { ds, cfg, datastorePath } = openDs();
  switch (name) {
    case 'kanecta_capture':
      return handleCapture(args, ds, cfg);

    case 'kanecta_search':
      return handleSearch(args, ds);

    case 'kanecta_recent':
      return handleRecent(args, ds);

    case 'kanecta_get': {
      const item = ds.resolve(args.ref);
      return item ? resolveItem(ds, item) : { error: `Not found: ${args.ref}` };
    }

    case 'kanecta_get_children':
      return { items: ds.children(args.parentId ?? null).map(i => resolveItem(ds, i)) };

    case 'kanecta_get_tree': {
      const root = ds.resolve(args.ref);
      if (!root) return { error: `Not found: ${args.ref}` };
      return {
        tree: ds.tree(root.id, args.depth ?? 3).map(({ item, depth }) => ({
          depth, id: item.id, value: resolveLinks(ds, item.value), type: item.type,
          tags: (item.tags || []).filter(t => t !== 'kanecta-internal'),
        })),
      };
    }

    case 'kanecta_get_ancestors': {
      const item = ds.get(args.id);
      if (!item) return { error: `Not found: ${args.id}` };
      return { ancestors: getAncestorChain(ds, args.id) };
    }

    case 'kanecta_add_item': {
      const { alias, ...createArgs } = args;
      const item = ds.create(createArgs);
      if (alias) ds.setAlias(alias, item.id);
      return resolveItem(ds, item);
    }

    case 'kanecta_update_item': {
      const { id, ...changes } = args;
      return resolveItem(ds, ds.update(id, changes, cfg?.owner));
    }

    case 'kanecta_delete_item': {
      const ids = collectSubtreeIds(ds, args.id).reverse();
      for (const itemId of ids) ds.delete(itemId, cfg?.owner);
      return { deleted: ids };
    }

    case 'kanecta_bulk_create': {
      const created = [];
      const errors = [];
      for (const [i, itemArgs] of args.items.entries()) {
        try {
          const { alias, ...createArgs } = itemArgs;
          const item = ds.create(createArgs);
          if (alias) ds.setAlias(alias, item.id);
          created.push(item);
        } catch (err) {
          errors.push({ index: i, error: err.message });
        }
      }
      return { created, errors };
    }

    case 'kanecta_bulk_update': {
      const updated = [];
      const errors = [];
      for (const [i, { id, ...changes }] of args.updates.entries()) {
        try {
          updated.push(ds.update(id, changes, cfg?.owner));
        } catch (err) {
          errors.push({ index: i, id, error: err.message });
        }
      }
      return { updated, errors };
    }

    case 'kanecta_clone': {
      const { sourceId, targetParentId } = args;
      if (!ds.get(sourceId)) return { error: `Not found: ${sourceId}` };
      if (!ds.get(targetParentId)) return { error: `Target parent not found: ${targetParentId}` };
      const cloned = cloneSubtree(ds, sourceId, targetParentId, cfg?.owner);
      return cloned || { error: `Clone failed for: ${sourceId}` };
    }

    case 'kanecta_set_alias': {
      const { alias, targetId } = args;
      if (!ds.get(targetId)) return { error: `Not found: ${targetId}` };
      ds.setAlias(alias, targetId);
      return { alias, targetId };
    }

    case 'kanecta_relate': {
      const { sourceId, type, targetId, note } = args;
      if (!VALID_REL_TYPES.includes(type))
        return { error: `Invalid relationship type: ${type}. Valid: ${VALID_REL_TYPES.join(', ')}` };
      if (!ds.get(sourceId)) return { error: `Source not found: ${sourceId}` };
      if (!ds.get(targetId)) return { error: `Target not found: ${targetId}` };
      return ds.relate(sourceId, type, targetId, { note, createdBy: cfg?.owner });
    }

    case 'kanecta_get_relationships': {
      if (!ds.get(args.id)) return { error: `Not found: ${args.id}` };
      return ds.relationships(args.id);
    }

    case 'kanecta_get_backlinks': {
      if (!ds.get(args.id)) return { error: `Not found: ${args.id}` };
      return ds.backlinks(args.id);
    }

    case 'kanecta_annotate': {
      const { targetId, content, parentAnnotationId = null } = args;
      if (!ds.get(targetId)) return { error: `Not found: ${targetId}` };
      return ds.annotate(targetId, { content, author: cfg?.owner, parentAnnotationId });
    }

    case 'kanecta_get_annotations': {
      if (!ds.get(args.targetId)) return { error: `Not found: ${args.targetId}` };
      return { annotations: ds.annotations(args.targetId) };
    }

    case 'kanecta_by_tag':
      return { tag: args.tag, items: ds.byTag(args.tag) };

    case 'kanecta_list_types':
      return handleListTypes(datastorePath);

    case 'kanecta_get_type_schema':
      return handleGetTypeSchema(datastorePath, args.id);

    case 'kanecta_update_type_schema':
      return handleUpdateTypeSchema(datastorePath, args.id, args.schema);

    default: {
      const err = new Error(`Unknown tool: ${name}`);
      err.code = -32601;
      throw err;
    }
  }
}

function runMcpServer() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;

      let msg;
      try { msg = JSON.parse(line); } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }

      const { id, method, params = {} } = msg;

      if (method === 'initialize') {
        sendResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'kanecta', version: require('../package.json').version },
        });
        continue;
      }

      if (method === 'notifications/initialized') continue;

      if (method === 'ping') {
        sendResult(id, {});
        continue;
      }

      if (method === 'tools/list') {
        sendResult(id, { tools: TOOLS });
        continue;
      }

      if (method === 'tools/call') {
        const { name, arguments: args = {} } = params;
        let result;
        try {
          result = dispatch(name, args);
        } catch (err) {
          if (err.code === -32601) {
            sendError(id, -32601, err.message);
            continue;
          }
          sendResult(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
          continue;
        }
        const text = result?.error
          ? `Error: ${result.error}`
          : JSON.stringify(result, null, 2);
        sendResult(id, { content: [{ type: 'text', text }], isError: !!result?.error });
        continue;
      }

      sendError(id, -32601, `Method not found: ${method}`);
    }
  });

  process.stdin.on('end', () => process.exit(0));
}

module.exports = { runMcpServer, TOOLS };

if (require.main === module) {
  runMcpServer();
}
