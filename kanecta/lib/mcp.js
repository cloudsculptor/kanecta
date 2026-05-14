'use strict';

// MCP stdio server — run via `kanecta mcp`
// Implements MCP protocol v2024-11-05 for Claude Code integration

const { Datastore } = require('kanecta-cli/lib/datastore');
const { readConfig, getDatastorePath } = require('./config');
const { detectSecrets } = require('./secrets');

const TOOLS = [
  {
    name: 'kanecta_capture',
    description: 'Save a piece of context, decision, insight, or fact to the Kanecta knowledge base. Use for things worth remembering across sessions. Never call this with secrets, API keys, passwords, or tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The content to save' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to categorise the capture (e.g. ["decision", "bug-fix"])' },
        type: { type: 'string', enum: ['text', 'string', 'decision'], description: 'Item type (default: text)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'kanecta_search',
    description: 'Search the Kanecta knowledge base for past context, decisions, or facts. Use before starting complex work to check for relevant prior context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (case-insensitive substring match)' },
        limit: { type: 'number', description: 'Maximum results to return (default: 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'kanecta_recent',
    description: 'List the most recent captures from the Kanecta knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        n: { type: 'number', description: 'Number of recent items to show (default: 10)' },
      },
    },
  },
  {
    name: 'kanecta_get',
    description: 'Get a specific item from the Kanecta knowledge base by ID or alias.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Item UUID or alias' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'kanecta_tree',
    description: 'Browse the Kanecta knowledge base as a hierarchical tree.',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Root item UUID or alias (omit for full tree)' },
        depth: { type: 'number', description: 'Maximum depth (default: 3)' },
      },
    },
  },
];

function openDs() {
  const cfg = readConfig();
  const p = cfg ? (cfg.datastorePath.replace(/^~/, require('os').homedir())) : getDatastorePath();
  return { ds: new Datastore(p), cfg };
}

function ensureDateBucket(ds, cfg) {
  const today = new Date().toISOString().slice(0, 10);
  if (cfg && cfg.lastCaptureDate === today && cfg.lastCaptureDateId) {
    return cfg.lastCaptureDateId;
  }
  const { writeConfig } = require('./config');
  const bucket = ds.create({
    value: today,
    type: 'string',
    parentId: cfg?.capturesRootId || null,
    owner: cfg?.owner || 'kanecta',
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
    return { error: `Capture rejected: possible secret detected (${secrets.join(', ')}). Kanecta does not store secrets.` };
  }
  const dateBucketId = ensureDateBucket(ds, cfg);
  const allTags = ['kanecta-capture', ...tags.filter(t => !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t))];
  const item = ds.create({
    value: text,
    type,
    parentId: dateBucketId,
    owner: cfg?.owner || 'kanecta',
    tags: allTags,
  });
  return { id: item.id, date: today(), tags: allTags.filter(t => t !== 'kanecta-capture'), preview: text.slice(0, 100) };
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

function handleGet(args, ds) {
  const item = ds.resolve(args.ref);
  if (!item) return { error: `Not found: ${args.ref}` };
  return item;
}

function handleTree(args, ds) {
  let rootId = null;
  if (args.root) {
    const item = ds.resolve(args.root);
    if (!item) return { error: `Not found: ${args.root}` };
    rootId = item.id;
  }
  const maxDepth = args.depth ?? 3;
  const nodes = ds.tree(rootId, maxDepth);
  return {
    count: nodes.length,
    tree: nodes.map(({ item, depth }) => ({
      depth,
      id: item.id,
      value: item.value,
      type: item.type,
      tags: (item.tags || []).filter(t => !['kanecta-internal'].includes(t)),
    })),
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
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
          serverInfo: { name: 'kanecta', version: '1.0.0' },
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
          const { ds, cfg } = openDs();
          switch (name) {
            case 'kanecta_capture': result = handleCapture(args, ds, cfg); break;
            case 'kanecta_search':  result = handleSearch(args, ds); break;
            case 'kanecta_recent':  result = handleRecent(args, ds); break;
            case 'kanecta_get':     result = handleGet(args, ds); break;
            case 'kanecta_tree':    result = handleTree(args, ds); break;
            default: sendError(id, -32601, `Unknown tool: ${name}`); continue;
          }
        } catch (e) {
          result = { error: e.message };
        }

        const text = result.error
          ? `Error: ${result.error}`
          : JSON.stringify(result, null, 2);

        sendResult(id, {
          content: [{ type: 'text', text }],
          isError: !!result.error,
        });
        continue;
      }

      sendError(id, -32601, `Method not found: ${method}`);
    }
  });

  process.stdin.on('end', () => process.exit(0));
}

module.exports = { runMcpServer, TOOLS };
