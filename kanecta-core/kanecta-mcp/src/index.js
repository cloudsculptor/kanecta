#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { spawnSync } = require('child_process');
const {
  Datastore,
  VALID_TYPES,
  VALID_CONFIDENCES,
  VALID_REL_TYPES,
  generateFunctionScaffold,
  toCamelCase,
} = require('@kanecta/lib');

// ─── Config ───────────────────────────────────────────────────────────────────

const APP_CONFIG_PATH = path.join(
  os.homedir(),
  '.config',
  'kanecta',
  'config.json',
);
const MCP_CONFIG_PATH = path.join(os.homedir(), '.kanecta-config.json');

function readAppConfig() {
  try {
    return JSON.parse(fs.readFileSync(APP_CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

// Optional registry of named datastores, supplied as a JSON map of name→path via the
// KANECTA_DATASTORES env var, e.g. {"store-a":"/data/a","store-b":"~/data/b"}. This lets a
// single server instance serve several datastores, selected per call (see the `datastore`
// tool argument). When unset, the server behaves exactly as a single-datastore server.
function readDatastoreRegistry() {
  const raw = process.env.KANECTA_DATASTORES;
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('KANECTA_DATASTORES must be valid JSON — a map of name→path, e.g. {"store-a":"/data/a"}');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('KANECTA_DATASTORES must be a JSON object mapping datastore names to paths');
  }
  return parsed;
}

function resolveWorkspace() {
  const appCfg = readAppConfig();
  const workspaces = appCfg?.workspaces ?? {};
  const names = Object.keys(workspaces);
  const requested = process.env.KANECTA_WORKSPACE || appCfg?.default;
  if (requested) {
    if (!workspaces[requested]) {
      throw new Error(
        `Workspace '${requested}' not found in ${APP_CONFIG_PATH} — known workspaces:\n${names.join('\n')}`,
      );
    }
    return workspaces[requested];
  }
  if (names.length === 1) return workspaces[names[0]];
  if (names.length > 1) {
    throw new Error(
      `Multiple Kanecta workspaces configured in ${APP_CONFIG_PATH} — set KANECTA_WORKSPACE to one of:\n${names.join('\n')}`,
    );
  }
  throw new Error(`No Kanecta workspaces found in ${APP_CONFIG_PATH}`);
}

async function openDs(selector) {
  // Per-call datastore selection (multi-datastore support). When a selector is supplied it must
  // name an entry in the KANECTA_DATASTORES registry; that store is opened in filesystem mode.
  // When the selector is omitted the resolution below is byte-for-byte the original behavior, so
  // single-datastore deployments are completely unaffected.
  if (selector !== undefined && selector !== null && selector !== '') {
    const registry = readDatastoreRegistry();
    if (!registry || !Object.prototype.hasOwnProperty.call(registry, selector)) {
      const known = registry ? Object.keys(registry).join(', ') || '(empty)' : '(none configured)';
      throw new Error(
        `Unknown datastore '${selector}'. Configure KANECTA_DATASTORES as a JSON map of name→path. Known datastores: ${known}`
      );
    }
    const datastorePath = String(registry[selector]).replace(/^~/, os.homedir());
    const cfg = readConfig();
    return { ds: Datastore.open(datastorePath), cfg, datastorePath };
  }
  // KANECTA_DATASTORE env var explicitly forces filesystem mode (used by tests and CLI overrides)
  if (process.env.KANECTA_DATASTORE) {
    const datastorePath = process.env.KANECTA_DATASTORE.replace(
      /^~/,
      os.homedir(),
    );
    const cfg = readConfig();
    return { ds: Datastore.open(datastorePath), cfg, datastorePath };
  }
  const workspace = resolveWorkspace();
  const ds = await Datastore.openWorkspace(workspace);
  const cfg = readConfig();
  return {
    ds,
    cfg,
    datastorePath: workspace.datastore
      ? workspace.datastore.replace(/^~/, os.homedir())
      : null,
  };
}


// ─── Secret detection ─────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', re: /gh[psoure]_[a-zA-Z0-9]{36,}/ },
  {
    name: 'JWT',
    re: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
  },
  { name: 'private key', re: /-----BEGIN [A-Z ]+ PRIVATE KEY-----/ },
  {
    name: 'secret/password field',
    re: /(password|passwd|secret|api[_-]?key|private[_-]?key|access[_-]?token)\s*[=:]\s*\S{8,}/i,
  },
];

function detectSecrets(text) {
  if (!text || typeof text !== 'string') return [];
  return SECRET_PATTERNS.filter(({ re }) => re.test(text)).map(
    ({ name }) => name,
  );
}

// ─── Link resolution ──────────────────────────────────────────────────────────

const WIKILINK_RE =
  /\[\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]\]/g;

async function resolveLinks(ds, value) {
  if (!value || typeof value !== 'string') return value;
  const matches = [...value.matchAll(WIKILINK_RE)];
  if (!matches.length) return value;
  const fetched = await Promise.all(matches.map((m) => ds.get(m[1])));
  const map = new Map(matches.map((m, i) => [m[1], fetched[i]]));
  return value.replace(WIKILINK_RE, (match, uuid) => {
    const item = map.get(uuid);
    return item ? `[[${uuid}|${item.value}]]` : match;
  });
}

async function resolveItem(ds, item) {
  if (!item || typeof item.value !== 'string') return item;
  return { ...item, value: await resolveLinks(ds, item.value) };
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────

async function getAncestorChain(ds, id) {
  const ancestors = [];
  const seen = new Set([id]);
  let item = await ds.get(id);
  while (
    item &&
    item.parentId &&
    item.parentId !== item.id &&
    !seen.has(item.parentId)
  ) {
    seen.add(item.parentId);
    const parent = await ds.get(item.parentId);
    if (!parent) break;
    ancestors.unshift({
      id: parent.id,
      value: parent.value,
      type: parent.type,
    });
    item = parent;
  }
  return ancestors;
}

async function collectSubtreeIds(ds, id) {
  const ids = [id];
  for (const child of await ds.children(id)) {
    ids.push(...(await collectSubtreeIds(ds, child.id)));
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
    license: source.license || null,
    owner: actor || source.owner,
  });
  for (const child of await ds.children(sourceId)) {
    await cloneSubtree(ds, child.id, cloned.id, actor);
  }
  return cloned;
}

// ─── Tools ────────────────────────────────────────────────────────────────────

const TOOLS = [
  // ── Capture & search ────────────────────────────────────────────────────────
  {
    name: 'kanecta_capture',
    description:
      'Save context, decisions, insights, or facts to the Kanecta knowledge base. Use for anything worth remembering across sessions. Never call this with secrets, API keys, passwords, or tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The content to capture' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags (e.g. ["decision", "architecture"])',
        },
        type: {
          type: 'string',
          enum: ['text', 'string', 'decision'],
          description: 'Item type — defaults to "text"',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'kanecta_search',
    description:
      'Search the Kanecta knowledge base for past context, decisions, or facts. Case-insensitive substring match across all item values and objectData fields. Pass rootId to scope the search to a subtree.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        rootId: {
          type: 'string',
          description:
            'Optional item UUID — restrict results to descendants of this item',
        },
        limit: { type: 'number', description: 'Maximum results (default: 10)' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of objectData fields to restrict the search to',
        },
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
        n: {
          type: 'number',
          description: 'Number of items to return (default: 10)',
        },
      },
    },
  },

  // ── Item CRUD ────────────────────────────────────────────────────────────────
  {
    name: 'kanecta_get',
    description:
      'Get a specific item from the knowledge base by UUID or alias.',
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
    description:
      'Get the direct children of an item. Omit parentId to list root-level items.',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: {
          type: 'string',
          description: 'Parent UUID — omit for root items',
        },
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
    description:
      'Get the full ancestor chain (path to root) for an item. Returns an array ordered from root down to the immediate parent.',
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
    description:
      'Add a new item to the knowledge base with explicit placement. Use kanecta_capture for saving insights — this is for structured data entry.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Item value/content' },
        type: {
          type: 'string',
          description: `Item type (${VALID_TYPES.join(', ')})`,
        },
        parentId: {
          type: 'string',
          description: 'Parent UUID — omit for root',
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
        alias: {
          type: 'string',
          description: 'Optional human-readable alias for this item',
        },
        sortOrder: {
          type: 'number',
          description: 'Sort position among siblings (omit to append)',
        },
        confidence: {
          type: 'string',
          enum: VALID_CONFIDENCES,
          description: 'Confidence level',
        },
        status: {
          type: 'string',
          description:
            'Arbitrary status string (e.g. "active", "archived", "draft")',
        },
        objectData: {
          type: 'object',
          description:
            'Field values for typed objects (type: "object"). Written to object.json and rendered as synthetic children in the tree.',
        },
        strict: {
          type: 'boolean',
          description:
            'Optional. When true, writing an object whose typeId has no registered type definition throws instead of writing. Default false: the write succeeds but the result includes a "warning".',
        },
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
        typeId: {
          type: 'string',
          description:
            'Type UUID — set when converting an item to a typed object',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replace tags',
        },
        parentId: {
          type: 'string',
          description: 'Move item to a new parent UUID',
        },
        sortOrder: {
          type: 'number',
          description: 'New sort position among siblings',
        },
        confidence: {
          type: 'string',
          enum: VALID_CONFIDENCES,
          description: 'Confidence level',
        },
        status: {
          type: 'string',
          description:
            'Arbitrary status string (e.g. "active", "archived", "draft")',
        },
        completedAt: {
          type: 'string',
          description:
            'ISO8601 timestamp to mark as completed, or null to clear',
        },
        objectData: {
          type: 'object',
          description:
            'Replace the object.json field values for a typed object item.',
        },
        strict: {
          type: 'boolean',
          description:
            'Optional. When true, changing typeId to one with no registered type definition throws instead of writing. Default false: the write succeeds but the result includes a "warning".',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'kanecta_complete_item',
    description:
      'Mark an item as completed (sets completedAt to now) or uncomplete it (clears completedAt). Use this instead of kanecta_update_item when the only intent is to mark something done or undone.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Item UUID' },
        completed: {
          type: 'boolean',
          description: 'true to mark completed now, false to clear completedAt',
        },
      },
      required: ['id', 'completed'],
    },
  },
  {
    name: 'kanecta_delete_item',
    description:
      'Delete an item and all its descendants from the knowledge base.',
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
    description:
      'Create multiple items in one call. Items are created in array order — use this for template instantiation instead of 9 sequential kanecta_add_item calls.',
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
              status: { type: 'string' },
            },
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'kanecta_bulk_update',
    description:
      'Update multiple items in one call. Accepts an array of {id, ...changes} objects.',
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
              status: { type: 'string' },
              completedAt: { type: 'string' },
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
    description:
      'Deep-copy an item and all its descendants under a new parent. Returns the new root item. Use for template instantiation.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'UUID of the item (and subtree) to clone',
        },
        targetParentId: {
          type: 'string',
          description: 'UUID of the parent to place the clone under',
        },
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
        targetId: {
          type: 'string',
          description: 'Item UUID the alias points to',
        },
      },
      required: ['alias', 'targetId'],
    },
  },

  // ── Relationships ────────────────────────────────────────────────────────────
  {
    name: 'kanecta_relate',
    description: `Create a typed semantic relationship between two items. Built-in types: ${VALID_REL_TYPES.join(', ')}. A datastore may register additional types in its config (config.relTypes), so the accepted set can be larger; an invalid type returns the full valid list.`,
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'UUID of the source item' },
        type: {
          type: 'string',
          description:
            'Relationship type (built-in default or datastore-registered)',
        },
        targetId: { type: 'string', description: 'UUID of the target item' },
        note: {
          type: 'string',
          description: 'Optional note about the relationship',
        },
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
    description:
      'Get all items that contain [[uuid]] inline links pointing to this item.',
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
    description:
      'Add a threaded comment or annotation to an item without modifying it.',
    inputSchema: {
      type: 'object',
      properties: {
        targetId: {
          type: 'string',
          description: 'UUID of the item to annotate',
        },
        content: { type: 'string', description: 'Annotation text' },
        parentAnnotationId: {
          type: 'string',
          description: 'UUID of parent annotation for threaded replies',
        },
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
    name: 'kanecta_create_type',
    description:
      'Create a new custom type definition in the Kanecta datastore. Returns the full metadata record for the new type.',
    inputSchema: {
      type: 'object',
      properties: {
        value: {
          type: 'string',
          description: 'Name of the type (e.g. "Person", "Place", "Event")',
        },
      },
      required: ['value'],
    },
  },
  {
    name: 'kanecta_list_types',
    description:
      'List all custom type definitions in the Kanecta datastore. Returns metadata including icon, description, keywords, and tags for each type.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'kanecta_get_type_schema',
    description:
      'Get the full type definition (type.json) for a custom type by UUID. Returns the meta and jsonSchema fields.',
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
    description:
      'Update the type definition (type.json) for a custom type. Pass the full updated definition including meta and jsonSchema.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Type definition UUID' },
        schema: {
          type: 'object',
          description:
            'Full type definition object with meta and jsonSchema fields',
        },
      },
      required: ['id', 'schema'],
    },
  },

  // ── Tag queries ──────────────────────────────────────────────────────────────
  {
    name: 'kanecta_get_function',
    description:
      "Read a function item's definition (parameters, return type, body, dependencies) and scaffold status.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the function item' },
      },
      required: ['id'],
    },
  },
  {
    name: 'kanecta_create_function',
    description:
      'Create a new function item, write its definition, and generate the TypeScript scaffold. Use compile:true to also run npm install + tsc.',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: { type: 'string', description: 'UUID of the parent item' },
        name: {
          type: 'string',
          description:
            'Function name (becomes the item value and the TypeScript function name)',
        },
        description: {
          type: 'string',
          description: 'JSDoc description of what the function does',
        },
        async: {
          type: 'boolean',
          description: 'Whether the function is async (default: false)',
        },
        ai: {
          type: 'boolean',
          description:
            'Whether the function calls AI internally (default: false)',
        },
        parameters: {
          type: 'array',
          description: 'Ordered list of function parameters',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Parameter name' },
              type: {
                type: 'string',
                description:
                  'TypeScript primitive type (string, number, boolean, etc.)',
              },
              typeId: {
                type: 'string',
                description:
                  'Kanecta type UUID (use instead of type for structured objects)',
              },
              optional: { type: 'boolean' },
              rest: {
                type: 'boolean',
                description: 'Variadic ...rest parameter',
              },
              defaultValue: {
                type: 'string',
                description:
                  'Default value as a TypeScript expression e.g. "0" or "\"hello\""',
              },
              description: {
                type: 'string',
                description:
                  'What this parameter is for — used as @param JSDoc and to prompt for values when running',
              },
            },
            required: ['name'],
          },
        },
        returnType: {
          type: 'string',
          description:
            'TypeScript return type (default: "void"). Use this OR returnTypeId.',
        },
        returnTypeId: {
          type: 'string',
          description:
            'Kanecta type UUID for the return value. Use this OR returnType.',
        },
        body: {
          type: 'string',
          description:
            'Function implementation source code (TypeScript, inside the function body)',
        },
        includeKanectaSdk: {
          type: 'boolean',
          description:
            'Auto-import @kanecta/sdk and create a kanecta client (default: true)',
        },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Additional npm packages e.g. ["axios@^1.0.0", "lodash"]',
        },
        compile: {
          type: 'boolean',
          description:
            'Run npm install + tsc after generating the scaffold (default: false)',
        },
      },
      required: ['parentId', 'name'],
    },
  },
  {
    name: 'kanecta_edit_function',
    description:
      "Update an existing function's definition and regenerate the TypeScript scaffold. Only the fields you provide are changed; everything else is preserved.",
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'UUID of the function item to edit',
        },
        description: { type: 'string' },
        async: { type: 'boolean' },
        ai: { type: 'boolean' },
        parameters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              typeId: { type: 'string' },
              optional: { type: 'boolean' },
              rest: { type: 'boolean' },
              defaultValue: { type: 'string' },
              description: {
                type: 'string',
                description:
                  'What this parameter is for — used as @param JSDoc and to prompt for values when running',
              },
            },
            required: ['name'],
          },
        },
        returnType: { type: 'string' },
        returnTypeId: { type: 'string' },
        body: {
          type: 'string',
          description:
            'Full replacement function body (TypeScript source inside the function)',
        },
        includeKanectaSdk: { type: 'boolean' },
        dependencies: { type: 'array', items: { type: 'string' } },
        compile: {
          type: 'boolean',
          description:
            'Run npm install + tsc after regenerating the scaffold (default: false)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'kanecta_execute_function',
    description:
      'Run a compiled Kanecta function. Auto-recompiles if the code is stale. The response includes parameter definitions (with descriptions) so you can see what each arg expects.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'UUID of the function item to execute',
        },
        args: {
          type: 'object',
          description:
            'Argument values keyed by parameter name. Values are strings and are JSON-parsed at runtime (so pass "42" for a number, "true" for a boolean, or a plain string for text). Check parameter descriptions via kanecta_get_function if unsure what to pass.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['id'],
    },
  },
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
  {
    name: 'kanecta_query',
    description:
      'Query the Kanecta knowledge base for items matching specific criteria. Returns items with their metadata and inline objectData. severity and status filters are case-insensitive. Supports mode="count" → {count:N} and mode="group_by" with group_by_field → {groups:{value:count}} — both modes fetch all matches (limit ignored).',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            'Optional: match items of this primitive or custom type name',
        },
        where: {
          type: 'object',
          description:
            'Optional: predicates over objectData fields, e.g. { severity: "P1", status: { op: "!=", value: "closed" } }. severity is normalised to uppercase, status to lowercase.',
        },
        rootId: {
          type: 'string',
          description: 'Optional: restrict results to descendants of this item',
        },
        sort: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Field to sort by (metadata or objectData field)',
            },
            dir: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: 'Sort direction',
            },
          },
          required: ['field'],
        },
        limit: {
          type: 'number',
          description:
            'Maximum results (default: 50). Ignored when mode is set.',
        },
        mode: {
          type: 'string',
          enum: ['count', 'group_by'],
          description:
            'Optional aggregation mode. "count" returns {count:N}. "group_by" returns {groups:{field_value:count}} — also requires group_by_field.',
        },
        group_by_field: {
          type: 'string',
          description:
            'Required when mode="group_by": objectData field to bucket by, e.g. "severity", "status", "screen_id".',
        },
        strictTypes: {
          type: 'boolean',
          description:
            'Optional. When true, querying a type name that is not a registered type definition (or built-in primitive) throws instead of returning an empty result. Default false: returns empty but includes a "warning" field so a typo or missing type definition is visible rather than silent.',
        },
      },
    },
  },
];

// Every tool accepts an optional `datastore` selector, injected here so the single source of
// truth is one description rather than 30+ duplicated schema fragments. Omitting it targets the
// default datastore, preserving the original single-datastore behavior.
const DATASTORE_ARG = {
  type: 'string',
  description:
    'Optional: name of a datastore in the KANECTA_DATASTORES registry to target for this call. Omit to use the default datastore (KANECTA_DATASTORE env or configured workspace).',
};
for (const tool of TOOLS) {
  if (tool.inputSchema && tool.inputSchema.type === 'object') {
    tool.inputSchema.properties = tool.inputSchema.properties || {};
    tool.inputSchema.properties.datastore = DATASTORE_ARG;
  }
}

// ─── Function helpers ─────────────────────────────────────────────────────────

function fnItemDir(datastorePath, id) {
  const s = id.replace(/-/g, '');
  return path.join(
    datastorePath,
    '.kanecta',
    'data',
    s.slice(0, 2),
    s.slice(2, 4),
    id,
  );
}

function hashIndexTs(fnDir) {
  try {
    return createHash('sha256')
      .update(fs.readFileSync(path.join(fnDir, 'index.ts'), 'utf8'))
      .digest('hex');
  } catch {
    return null;
  }
}

function fnScaffoldStatus(fnDir) {
  if (!fs.existsSync(fnDir)) return { exists: false, stale: false };
  const current = hashIndexTs(fnDir);
  const hashPath = path.join(fnDir, '.build-hash');
  const saved = fs.existsSync(hashPath)
    ? fs.readFileSync(hashPath, 'utf8').trim()
    : null;
  const distJs = path.join(fnDir, 'dist', 'index.js');
  const stale =
    !current || !saved || current !== saved || !fs.existsSync(distJs);
  return { exists: true, stale };
}

function compileFunctionScaffold(fnDir) {
  const chunks = [];
  const install = spawnSync('npm', ['install'], {
    cwd: fnDir,
    encoding: 'utf8',
    shell: true,
    timeout: 120_000,
  });
  if (install.stdout) chunks.push(install.stdout);
  if (install.stderr) chunks.push(install.stderr);
  if (install.status !== 0)
    return { success: false, output: chunks.join('\n').trim() };
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: fnDir,
    encoding: 'utf8',
    shell: true,
    timeout: 60_000,
  });
  if (build.stdout) chunks.push(build.stdout);
  if (build.stderr) chunks.push(build.stderr);
  const success = build.status === 0;
  if (success) {
    const h = hashIndexTs(fnDir);
    if (h) fs.writeFileSync(path.join(fnDir, '.build-hash'), h + '\n', 'utf8');
  }
  return { success, output: chunks.join('\n').trim() };
}

function buildFunctionJson(args, existing = {}) {
  const fn = { ...existing };
  if ('description' in args) fn.description = args.description;
  if ('async' in args) fn.async = args.async;
  if ('ai' in args) fn.ai = args.ai;
  if ('skill' in args) fn.skill = args.skill;
  if ('typeParameters' in args) fn.typeParameters = args.typeParameters;
  if ('parameters' in args) fn.parameters = args.parameters;
  if ('returnType' in args) fn.returnType = args.returnType;
  if ('returnTypeId' in args) fn.returnTypeId = args.returnTypeId;
  if ('throws' in args) fn.throws = args.throws;
  if ('deprecated' in args) fn.deprecated = args.deprecated;
  if ('body' in args) fn.body = args.body;
  if ('includeKanectaSdk' in args)
    fn.includeKanectaSdk = args.includeKanectaSdk;
  if ('dependencies' in args) fn.dependencies = args.dependencies;
  // ensure parameters always present
  if (!fn.parameters) fn.parameters = [];
  // ensure a return type
  if (!fn.returnType && !fn.returnTypeId) fn.returnType = 'void';
  return fn;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function ensureDateBucket(ds, cfg) {
  const today = new Date().toISOString().slice(0, 10);
  if (cfg?.lastCaptureDate === today && cfg?.lastCaptureDateId) {
    return cfg.lastCaptureDateId;
  }
  const bucket = await ds.create({
    value: today,
    type: 'string',
    parentId: cfg?.capturesRootId || null,
    owner: cfg?.owner || ds.config.owner,
    tags: ['kanecta-date'],
  });
  await ds.setAlias(`kanecta-date-${today}`, bucket.id);
  if (cfg) {
    cfg.lastCaptureDate = today;
    cfg.lastCaptureDateId = bucket.id;
    writeConfig(cfg);
  }
  return bucket.id;
}

async function handleCapture(args, ds, cfg) {
  const { text, tags = [], type = 'text' } = args;
  const secrets = detectSecrets(text);
  if (secrets.length) {
    return {
      error: `Capture rejected — possible secret detected (${secrets.join(', ')}). Kanecta never stores secrets.`,
    };
  }
  const dateBucketId = await ensureDateBucket(ds, cfg);
  const allTags = [
    'kanecta-capture',
    ...tags.filter(
      (t) =>
        !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t),
    ),
  ];
  const item = await ds.create({
    value: text,
    type,
    parentId: dateBucketId,
    owner: cfg?.owner || ds.config.owner,
    tags: allTags,
  });
  return {
    id: item.id,
    date: new Date().toISOString().slice(0, 10),
    tags: allTags.filter((t) => t !== 'kanecta-capture'),
    preview: text.slice(0, 120),
  };
}

function matchObjectData(objectData, q, fields) {
  if (!objectData || typeof objectData !== 'object') return false;

  const keys =
    Array.isArray(fields) && fields.length > 0
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

async function handleSearch(args, ds) {
  const { query, rootId, limit = 10, fields } = args;

  // Adapters that maintain a native full-text index (e.g. Postgres, via
  // search_index + triggers) expose ds.search — already ranked and limited.
  // Field-restricted searches fall through to the generic scan below, since
  // the native index covers whole rows rather than individual fields.
  let ranked;
  if (typeof ds.search === 'function' && !fields) {
    ranked = await ds.search(query, { rootId, limit });
  } else {
    const q = query.toLowerCase();
    const all = await ds.loadAll();

    const candidates = [];
    for (const i of all) {
      if (
        i.value &&
        typeof i.value === 'string' &&
        i.value.toLowerCase().includes(q)
      ) {
        candidates.push(i);
        continue;
      }
      if (i.type === 'object') {
        const objectData = await ds.readObjectJson(i.id);
        if (matchObjectData(objectData, q, fields)) candidates.push(i);
      }
    }

    let filtered = candidates;
    if (rootId) {
      const subtreeIds = new Set(await collectSubtreeIds(ds, rootId));
      filtered = candidates.filter((i) => subtreeIds.has(i.id));
    }

    ranked = filtered
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, limit);
  }

  const results = await Promise.all(
    ranked.map(async (i) => ({
      id: i.id,
      type: i.type,
      tags: (i.tags || []).filter(
        (t) =>
          !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t),
      ),
      date: (i.createdAt || '').slice(0, 10),
      value: await resolveLinks(ds, i.value),
      ancestors: await getAncestorChain(ds, i.id),
    })),
  );

  return { query, count: results.length, results };
}

async function handleRecent(args, ds) {
  const { n = 10 } = args;
  const all = await ds.loadAll();
  const items = all
    .filter((i) => (i.tags || []).includes('kanecta-capture'))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, n)
    .map((i) => ({
      id: i.id,
      date: (i.createdAt || '').slice(0, 10),
      tags: (i.tags || []).filter(
        (t) =>
          !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t),
      ),
      value: i.value,
    }));
  return { count: items.length, items };
}

// ─── Type definition helpers ──────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function typesDir(datastorePath) {
  return path.join(datastorePath, '.kanecta', 'types');
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
              meta.icon = typeDef.meta.icon ?? null;
              meta.description = typeDef.meta.description ?? null;
              meta.details = typeDef.meta.details ?? null;
              meta.keywords = typeDef.meta.keywords ?? null;
              meta.tags = typeDef.meta.tags ?? null;
              meta.primaryField = typeDef.meta.primaryField ?? null;
              meta['ai-instructions'] = typeDef.meta['ai-instructions'] ?? null;
            }
          }
          results.push(meta);
        } catch (_) {
          /* skip malformed */
        }
      }
    }
  }
  results.sort((a, b) => (a.value || '').localeCompare(b.value || ''));
  return { types: results };
}

function handleGetTypeSchema(datastorePath, id) {
  if (!UUID_RE.test(id)) return { error: 'Invalid UUID format' };
  const schemaPath = path.join(typeShardPath(datastorePath, id), 'type.json');
  if (!fs.existsSync(schemaPath))
    return { error: `Type schema not found: ${id}` };
  try {
    return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (err) {
    return { error: err.message };
  }
}

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
  if (
    js['$schema'] !==
    typeFileSpec.properties.jsonSchema.properties['$schema'].const
  )
    return `jsonSchema.$schema must be "${typeFileSpec.properties.jsonSchema.properties['$schema'].const}"`;
  if (js.type !== typeFileSpec.properties.jsonSchema.properties.type.const)
    return `jsonSchema.type must be "${typeFileSpec.properties.jsonSchema.properties.type.const}"`;
  if (!js.properties || typeof js.properties !== 'object')
    return 'jsonSchema.properties is required';
  return null;
}

function handleUpdateTypeSchema(datastorePath, id, schema) {
  if (!UUID_RE.test(id)) return { error: 'Invalid UUID format' };
  const validationError = validateTypeSchema(schema);
  if (validationError) return { error: validationError };
  const schemaPath = path.join(typeShardPath(datastorePath, id), 'type.json');
  if (!fs.existsSync(schemaPath))
    return { error: `Type schema not found: ${id}` };
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

async function dispatch(name, args) {
  // Pull the optional per-call datastore selector out of the arguments before they reach any
  // handler, so it can never be mistaken for a tool parameter (e.g. a kanecta_query where-clause).
  let datastore;
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    ({ datastore, ...args } = args);
  }
  const { ds, cfg, datastorePath } = await openDs(datastore);
  switch (name) {
    case 'kanecta_capture':
      return handleCapture(args, ds, cfg);

    case 'kanecta_search':
      return handleSearch(args, ds);

    case 'kanecta_recent':
      return handleRecent(args, ds);

    case 'kanecta_get': {
      const item = await ds.resolve(args.ref);
      return item ? resolveItem(ds, item) : { error: `Not found: ${args.ref}` };
    }

    case 'kanecta_get_children': {
      const children = await ds.children(args.parentId ?? null);
      return {
        items: await Promise.all(children.map((i) => resolveItem(ds, i))),
      };
    }

    case 'kanecta_get_tree': {
      const root = await ds.resolve(args.ref);
      if (!root) return { error: `Not found: ${args.ref}` };
      const treeItems = await ds.tree(root.id, args.depth ?? 3);
      return {
        tree: await Promise.all(
          treeItems.map(async ({ item, depth }) => ({
            depth,
            id: item.id,
            value: await resolveLinks(ds, item.value),
            type: item.type,
            tags: (item.tags || []).filter((t) => t !== 'kanecta-internal'),
          })),
        ),
      };
    }

    case 'kanecta_get_ancestors': {
      const item = await ds.get(args.id);
      if (!item) return { error: `Not found: ${args.id}` };
      return { ancestors: await getAncestorChain(ds, args.id) };
    }

    case 'kanecta_add_item': {
      const { alias, ...createArgs } = args;
      const item = await ds.create(createArgs);
      if (alias) await ds.setAlias(alias, item.id);
      const out = await resolveItem(ds, item);
      return item.warning ? { ...out, warning: item.warning } : out;
    }

    case 'kanecta_update_item': {
      const { id, objectData, strict, ...changes } = args;
      const updated = await ds.update(id, changes, cfg?.owner, { strict });
      if (objectData !== undefined) await ds.writeObjectJson(id, objectData);
      const out = await resolveItem(ds, updated);
      return updated.warning ? { ...out, warning: updated.warning } : out;
    }

    case 'kanecta_complete_item': {
      const completedAt = args.completed ? new Date().toISOString() : null;
      const updated = await ds.update(args.id, { completedAt }, cfg?.owner);
      return resolveItem(ds, updated);
    }

    case 'kanecta_delete_item': {
      const ids = (await collectSubtreeIds(ds, args.id)).reverse();
      for (const itemId of ids) await ds.delete(itemId, cfg?.owner);
      return { deleted: ids };
    }

    case 'kanecta_bulk_create': {
      const created = [];
      const errors = [];
      for (const [i, itemArgs] of args.items.entries()) {
        try {
          const { alias, ...createArgs } = itemArgs;
          const item = await ds.create(createArgs);
          if (alias) await ds.setAlias(alias, item.id);
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
          updated.push(await ds.update(id, changes, cfg?.owner));
        } catch (err) {
          errors.push({ index: i, id, error: err.message });
        }
      }
      return { updated, errors };
    }

    case 'kanecta_clone': {
      const { sourceId, targetParentId } = args;
      if (!(await ds.get(sourceId))) return { error: `Not found: ${sourceId}` };
      if (!(await ds.get(targetParentId)))
        return { error: `Target parent not found: ${targetParentId}` };
      const cloned = await cloneSubtree(
        ds,
        sourceId,
        targetParentId,
        cfg?.owner,
      );
      return cloned || { error: `Clone failed for: ${sourceId}` };
    }

    case 'kanecta_set_alias': {
      const { alias, targetId } = args;
      if (!(await ds.get(targetId))) return { error: `Not found: ${targetId}` };
      await ds.setAlias(alias, targetId);
      return { alias, targetId };
    }

    case 'kanecta_relate': {
      const { sourceId, type, targetId, note } = args;
      if (!ds.relTypes.includes(type))
        return {
          error: `Invalid relationship type: ${type}. Valid: ${ds.relTypes.join(', ')}`,
        };
      if (!(await ds.get(sourceId)))
        return { error: `Source not found: ${sourceId}` };
      if (!(await ds.get(targetId)))
        return { error: `Target not found: ${targetId}` };
      return await ds.relate(sourceId, type, targetId, {
        note,
        createdBy: cfg?.owner,
      });
    }

    case 'kanecta_get_relationships': {
      if (!(await ds.get(args.id))) return { error: `Not found: ${args.id}` };
      return await ds.relationships(args.id);
    }

    case 'kanecta_get_backlinks': {
      if (!(await ds.get(args.id))) return { error: `Not found: ${args.id}` };
      return await ds.backlinks(args.id);
    }

    case 'kanecta_annotate': {
      const { targetId, content, parentAnnotationId = null } = args;
      if (!(await ds.get(targetId))) return { error: `Not found: ${targetId}` };
      return await ds.annotate(targetId, {
        content,
        author: cfg?.owner,
        parentAnnotationId,
      });
    }

    case 'kanecta_get_annotations': {
      if (!(await ds.get(args.targetId)))
        return { error: `Not found: ${args.targetId}` };
      return { annotations: await ds.annotations(args.targetId) };
    }

    case 'kanecta_by_tag':
      return { tag: args.tag, items: await ds.byTag(args.tag) };

    case 'kanecta_query': {
      // Normalise known enum fields so filters are case-insensitive
      const { mode, group_by_field, ...dsArgs } = args;
      if (dsArgs.where) {
        const w = { ...dsArgs.where };
        if (w.severity !== undefined) {
          w.severity =
            typeof w.severity === 'string'
              ? w.severity.toUpperCase()
              : w.severity &&
                  typeof w.severity === 'object' &&
                  w.severity.value !== undefined
                ? {
                    ...w.severity,
                    value: String(w.severity.value).toUpperCase(),
                  }
                : w.severity;
        }
        if (w.status !== undefined) {
          w.status =
            typeof w.status === 'string'
              ? w.status.toLowerCase()
              : w.status &&
                  typeof w.status === 'object' &&
                  w.status.value !== undefined
                ? { ...w.status, value: String(w.status.value).toLowerCase() }
                : w.status;
        }
        dsArgs.where = w;
      }

      if (mode === 'count') {
        // limit:0 means "no limit / return all" per the adapter contract. Merely STRIPPING
        // limit leaves it undefined, which the adapter treats as the default cap of 50 — so
        // count silently under-counted any bucket larger than 50. Pass 0 to count all matches.
        const items = await ds.query({ ...dsArgs, limit: 0 });
        const out = { count: items.length };
        if (items.warning) out.warning = items.warning;
        return out;
      }

      if (mode === 'group_by') {
        if (!group_by_field)
          return { error: 'group_by mode requires group_by_field' };
        // limit:0 = return all (see the count-mode note above) — otherwise buckets cap at 50.
        const items = await ds.query({ ...dsArgs, limit: 0 });
        const groups = {};
        for (const item of items) {
          const val =
            item.objectData && item.objectData[group_by_field] !== undefined
              ? item.objectData[group_by_field]
              : (item[group_by_field] ?? 'unknown');
          const key = String(val);
          groups[key] = (groups[key] || 0) + 1;
        }
        const out = { groups };
        if (items.warning) out.warning = items.warning;
        return out;
      }

      const items = await ds.query(dsArgs);
      const out = {
        items: await Promise.all(items.map((item) => resolveItem(ds, item))),
      };
      if (items.warning) out.warning = items.warning;
      return out;
    }

    case 'kanecta_create_type': {
      const { metadata, schema } = await ds.createType(args.value);
      return { ...metadata, schema };
    }

    case 'kanecta_list_types':
      if (!datastorePath)
        return { error: 'kanecta_list_types requires filesystem mode' };
      return handleListTypes(datastorePath);

    case 'kanecta_get_type_schema':
      if (!datastorePath)
        return { error: 'kanecta_get_type_schema requires filesystem mode' };
      return handleGetTypeSchema(datastorePath, args.id);

    case 'kanecta_update_type_schema':
      if (!datastorePath)
        return { error: 'kanecta_update_type_schema requires filesystem mode' };
      return handleUpdateTypeSchema(datastorePath, args.id, args.schema);

    // ─── Function tools ────────────────────────────────────────────────────────

    case 'kanecta_get_function': {
      if (!datastorePath)
        return { error: 'kanecta_get_function requires filesystem mode' };
      const item = await ds.get(args.id);
      if (!item) return { error: `Not found: ${args.id}` };
      const fnData = await ds.readFunctionJson(args.id);
      if (!fnData) return { error: `No function definition for: ${args.id}` };
      const dir = path.join(fnItemDir(datastorePath, args.id), 'function');
      return { ...fnData, scaffold: fnScaffoldStatus(dir) };
    }

    case 'kanecta_create_function': {
      if (!datastorePath)
        return { error: 'kanecta_create_function requires filesystem mode' };
      const { parentId, name, compile = false, ...fnArgs } = args;
      if (parentId && !(await ds.get(parentId)))
        return { error: `Parent not found: ${parentId}` };
      const item = await ds.create({
        parentId: parentId ?? null,
        value: name,
        type: VALID_TYPES.includes('function') ? 'function' : 'string',
        owner: cfg?.owner,
      });
      const fnData = buildFunctionJson(fnArgs);
      const itemDir = fnItemDir(datastorePath, item.id);
      await ds.writeFunctionJson(item.id, fnData);
      generateFunctionScaffold(itemDir, name, fnData, datastorePath);
      const dir = path.join(itemDir, 'function');
      const result = {
        item,
        definition: fnData,
        scaffold: fnScaffoldStatus(dir),
      };
      if (compile) result.compile = compileFunctionScaffold(dir);
      return result;
    }

    case 'kanecta_edit_function': {
      if (!datastorePath)
        return { error: 'kanecta_edit_function requires filesystem mode' };
      const { id, compile = false, ...fnArgs } = args;
      const item = await ds.get(id);
      if (!item) return { error: `Not found: ${id}` };
      const existing = (await ds.readFunctionJson(id)) ?? {};
      const fnData = buildFunctionJson(fnArgs, existing);
      const itemDir = fnItemDir(datastorePath, id);
      await ds.writeFunctionJson(id, fnData);
      generateFunctionScaffold(
        itemDir,
        item.value ?? id,
        fnData,
        datastorePath,
      );
      const dir = path.join(itemDir, 'function');
      const result = { definition: fnData, scaffold: fnScaffoldStatus(dir) };
      if (compile) result.compile = compileFunctionScaffold(dir);
      return result;
    }

    case 'kanecta_execute_function': {
      if (!datastorePath)
        return { error: 'kanecta_execute_function requires filesystem mode' };
      const { id, args: fnArgs = {} } = args;
      const item = await ds.get(id);
      if (!item) return { error: `Not found: ${id}` };
      const fnData = (await ds.readFunctionJson(id)) ?? {};
      const dir = path.join(fnItemDir(datastorePath, id), 'function');
      const distIndex = path.join(dir, 'dist', 'index.js');

      if (!fs.existsSync(dir)) {
        return {
          error:
            'Function scaffold not found. Use kanecta_create_function or kanecta_edit_function first.',
        };
      }

      const status = fnScaffoldStatus(dir);
      let compileLog = null;
      if (status.stale || !fs.existsSync(distIndex)) {
        const compiled = compileFunctionScaffold(dir);
        compileLog = compiled.output;
        if (!compiled.success) {
          return {
            success: false,
            output: null,
            logs: `Compile failed:\n${compiled.output}`,
            parameters: fnData.parameters ?? [],
          };
        }
      }

      const fnName = toCamelCase(item.value ?? id);
      const params = fnData.parameters ?? [];
      const RESULT_START = '__KANECTA_RESULT_START__';
      const RESULT_END = '__KANECTA_RESULT_END__';
      const runnerCode = `
const mod = require(${JSON.stringify(distIndex)});
const params = ${JSON.stringify(params)};
const rawArgs = ${JSON.stringify(fnArgs)};
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
      const run = spawnSync('node', ['-e', runnerCode], {
        encoding: 'utf8',
        timeout: 300_000,
        env: {
          ...process.env,
          KANECTA_DATASTORE: datastorePath,
        },
      });
      const stdout = run.stdout ?? '';
      const stderr = run.stderr ?? '';
      const match = stdout.match(
        new RegExp(`${RESULT_START}([\\s\\S]*?)${RESULT_END}`),
      );
      const output = match ? match[1].trim() : null;
      const logsFromStdout = stdout
        .replace(new RegExp(`${RESULT_START}[\\s\\S]*?${RESULT_END}\\n?`), '')
        .trim();
      const logs = [compileLog, logsFromStdout, stderr]
        .filter(Boolean)
        .join('\n')
        .trim();
      return { success: run.status === 0, output, logs, parameters: params };
    }

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
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        send({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        });
        continue;
      }

      const { id, method, params = {} } = msg;

      if (method === 'initialize') {
        sendResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'kanecta',
            version: require('../package.json').version,
          },
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
        dispatch(name, args)
          .then((result) => {
            const text = result?.error
              ? `Error: ${result.error}`
              : JSON.stringify(result, null, 2);
            sendResult(id, {
              content: [{ type: 'text', text }],
              isError: !!result?.error,
            });
          })
          .catch((err) => {
            if (err.code === -32601) {
              sendError(id, -32601, err.message);
            } else {
              sendResult(id, {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
              });
            }
          });
        continue;
      }

      sendError(id, -32601, `Method not found: ${method}`);
    }
  });

  process.stdin.on('end', () => process.exit(0));
}

module.exports = { runMcpServer, TOOLS, resolveWorkspace, readDatastoreRegistry, openDs, dispatch };

if (require.main === module) {
  runMcpServer();
}
