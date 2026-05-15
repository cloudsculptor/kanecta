#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { Datastore } = require('@kanecta/lib');

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
  const p = cfg?.datastorePath
    ? cfg.datastorePath.replace(/^~/, os.homedir())
    : (process.env.KANECTA_DATASTORE?.replace(/^~/, os.homedir()) ?? DEFAULT_DATASTORE_PATH);
  return { ds: new Datastore(p), cfg };
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

// ─── Tools ────────────────────────────────────────────────────────────────────

const TOOLS = [
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
    description: 'Search the Kanecta knowledge base for past context, decisions, or facts. Case-insensitive substring match across all item values. Use before starting complex work to check for relevant prior context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
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
    name: 'kanecta_add_item',
    description: 'Add a new item to the knowledge base with explicit placement. Use kanecta_capture for saving insights — this is for structured data entry.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Item value/content' },
        type: { type: 'string', description: 'Item type (string, text, object, etc.)' },
        parentId: { type: 'string', description: 'Parent UUID — omit for root' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
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
      },
      required: ['id'],
    },
  },
  {
    name: 'kanecta_delete_item',
    description: 'Delete an item from the knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Item UUID' },
      },
      required: ['id'],
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
  const { query, limit = 10 } = args;
  const q = query.toLowerCase();
  const results = ds.loadAll()
    .filter(i => i.value && typeof i.value === 'string' && i.value.toLowerCase().includes(q))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, limit)
    .map(i => ({
      id: i.id,
      type: i.type,
      tags: (i.tags || []).filter(t => !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t)),
      date: (i.createdAt || '').slice(0, 10),
      value: i.value,
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
  const { ds, cfg } = openDs();
  switch (name) {
    case 'kanecta_capture':      return handleCapture(args, ds, cfg);
    case 'kanecta_search':       return handleSearch(args, ds);
    case 'kanecta_recent':       return handleRecent(args, ds);
    case 'kanecta_get': {
      const item = ds.resolve(args.ref);
      return item || { error: `Not found: ${args.ref}` };
    }
    case 'kanecta_get_children':
      return { items: ds.children(args.parentId ?? null) };
    case 'kanecta_get_tree': {
      const root = ds.resolve(args.ref);
      if (!root) return { error: `Not found: ${args.ref}` };
      return {
        count: 0,
        tree: ds.tree(root.id, args.depth ?? 3).map(({ item, depth }) => ({
          depth, id: item.id, value: item.value, type: item.type,
          tags: (item.tags || []).filter(t => t !== 'kanecta-internal'),
        })),
      };
    }
    case 'kanecta_add_item':
      return ds.create(args);
    case 'kanecta_update_item': {
      const { id, ...changes } = args;
      return ds.update(id, changes, cfg?.owner);
    }
    case 'kanecta_delete_item':
      ds.delete(args.id, cfg?.owner);
      return { deleted: args.id };
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
