#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { KanectaConnector } = require('@kanecta/lib');
const { walkDataDir } = require('@kanecta/lib/src/datastore');

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), '.kanecta-config.json');
const DEFAULT_DATASTORE_PATH = path.join(os.homedir(), '.kanecta');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return null; }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

function getDatastorePath() {
  if (process.env.KANECTA_DATASTORE) {
    return process.env.KANECTA_DATASTORE.replace(/^~/, os.homedir());
  }
  const cfg = readConfig();
  if (cfg && cfg.datastorePath) return cfg.datastorePath.replace(/^~/, os.homedir());
  return DEFAULT_DATASTORE_PATH;
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
    description: 'Get a specific item from the knowledge base by UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Item UUID' },
      },
      required: ['id'],
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
        id: { type: 'string', description: 'Root item UUID' },
        depth: { type: 'number', description: 'Depth to expand (default: 3)' },
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
        type: { type: 'string', description: 'Item type (string, text, object, etc.)' },
        parentId: { type: 'string', description: 'Parent UUID — omit for root' },
        sortOrder: { type: 'number', description: 'Sort position (auto-assigned if omitted)' },
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
        force: { type: 'boolean', description: 'Delete even if other items link to this one' },
      },
      required: ['id'],
    },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleCapture(args, connector) {
  const { text, type = 'text' } = args;

  const secrets = detectSecrets(text);
  if (secrets.length) {
    return { error: `Capture rejected — possible secret detected (${secrets.join(', ')}). Kanecta never stores secrets.` };
  }

  const cfg = readConfig();
  const today = new Date().toISOString().slice(0, 10);

  let dateBucketId;
  if (cfg?.lastCaptureDate === today && cfg?.lastCaptureDateId) {
    dateBucketId = cfg.lastCaptureDateId;
  } else {
    const bucket = await connector.addItem({
      value: today,
      type: 'string',
      parentId: cfg?.capturesRootId || null,
      owner: cfg?.owner || 'kanecta',
    });
    dateBucketId = bucket.id;
    if (cfg) {
      cfg.lastCaptureDate = today;
      cfg.lastCaptureDateId = bucket.id;
      writeConfig(cfg);
    }
  }

  const item = await connector.addItem({
    value: text,
    type,
    parentId: dateBucketId,
    owner: cfg?.owner || 'kanecta',
  });

  return { id: item.id, date: today, preview: text.slice(0, 120) };
}

async function handleSearch(args, datastorePath) {
  const { query, limit = 10 } = args;
  const q = query.toLowerCase();
  const all = await walkDataDir(datastorePath);
  const results = all
    .filter(i => i.value && typeof i.value === 'string' && i.value.toLowerCase().includes(q))
    .sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0))
    .slice(0, limit)
    .map(i => ({ id: i.id, type: i.type, parentId: i.parentId, value: i.value }));
  return { query, count: results.length, results };
}

async function handleRecent(args, datastorePath) {
  const { n = 10 } = args;
  const all = await walkDataDir(datastorePath);

  // Captures live under date bucket items (value = YYYY-MM-DD)
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const dateBuckets = new Map(
    all.filter(i => typeof i.value === 'string' && datePattern.test(i.value)).map(i => [i.id, i.value])
  );

  const captures = all
    .filter(i => i.parentId && dateBuckets.has(i.parentId))
    .map(i => ({ ...i, _date: dateBuckets.get(i.parentId) }))
    .sort((a, b) => {
      if (b._date !== a._date) return b._date.localeCompare(a._date);
      return (b.sortOrder || 0) - (a.sortOrder || 0);
    })
    .slice(0, n)
    .map(({ _date, ...i }) => ({ id: i.id, type: i.type, date: _date, value: i.value }));

  return { count: captures.length, items: captures };
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

async function dispatch(name, args, connector, datastorePath) {
  switch (name) {
    case 'kanecta_capture':      return handleCapture(args, connector);
    case 'kanecta_search':       return handleSearch(args, datastorePath);
    case 'kanecta_recent':       return handleRecent(args, datastorePath);
    case 'kanecta_get':          return connector.getItem(args.id);
    case 'kanecta_get_children': return connector.getChildren(args.parentId ?? null);
    case 'kanecta_get_tree':     return connector.getTree(args.id, { depth: args.depth ?? 3 });
    case 'kanecta_add_item':     return connector.addItem(args);
    case 'kanecta_update_item':  { const { id, ...updates } = args; return connector.updateItem(id, updates); }
    case 'kanecta_delete_item':  return connector.deleteItem(args.id, { force: args.force ?? false }).then(() => ({ deleted: args.id }));
    default: {
      const err = new Error(`Unknown tool: ${name}`);
      err.code = -32601;
      throw err;
    }
  }
}

function runMcpServer() {
  const datastorePath = getDatastorePath();
  const connector = new KanectaConnector({ datastorePath });

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
        dispatch(name, args, connector, datastorePath)
          .then(result => {
            const text = result.error
              ? `Error: ${result.error}`
              : JSON.stringify(result, null, 2);
            sendResult(id, { content: [{ type: 'text', text }], isError: !!result.error });
          })
          .catch(err => {
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

module.exports = { runMcpServer, TOOLS };

if (require.main === module) {
  runMcpServer();
}
