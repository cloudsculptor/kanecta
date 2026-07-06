#!/usr/bin/env -S node --import tsx

import fs from 'fs';
// @ts-expect-error — runtime subpath re-export; not resolvable at typecheck time
import { Datastore } from '@kanecta/cli/lib/datastore';
import { readConfig, writeConfig, getDatastorePath, isConfigured, expandHome } from './lib/config.ts';
import { detectSecrets } from './lib/secrets.ts';

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
kanecta claude — Claude Code integration for Kanecta

USAGE
  kanecta claude [--datastore <path>] <command> [options]

COMMANDS

  setup
    Quickly register Kanecta as an MCP server in Claude Code (no wizard).
    Equivalent to: claude mcp add --transport stdio kanecta -- npx -y @kanecta/mcp

  wizard
    Run the full setup wizard (first run or re-configure).

  capture "<text>" [--tag <t>] [--type text|string|decision]
    Save context to your knowledge base. Claude calls this automatically
    based on your configured capture mode. Never captures secrets.

  recent [--n <count>]
    Show the most recent captures (default: 10).

  search "<query>"
    Full-text search across all items.

  mode <always|extended|ask-at-start|manual>
    Change Claude capture mode and update ~/.claude/CLAUDE.md.

  status
    Show current configuration.

  mcp
    Start as an MCP server (used by Claude Code — not typically called directly).

DATASTORE DISCOVERY
  --datastore <path>  explicit path
  ~/.kanecta-config.json  configured path from wizard
  walk up from cwd looking for .kanecta/

EXAMPLES
  kanecta claude setup
  kanecta claude wizard
  kanecta claude capture "decided to use PostgreSQL" --tag decision
  kanecta claude search "postgres"
  kanecta claude recent --n 5
  kanecta claude status
`.trimStart();

// ─── Arg parser ───────────────────────────────────────────────────────────────

type Flags = Record<string, any>;

function parseArgs(argv: string[]) {
  const flags: Flags = {};
  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        const boolFlags = ['force', 'ids', 'json'];
        const repeatableFlags = ['tag', 'add-tag', 'remove-tag'];
        if (boolFlags.includes(key) || !next || next.startsWith('--')) {
          flags[key] = true;
        } else if (repeatableFlags.includes(key)) {
          if (!flags[key]) flags[key] = [];
          flags[key].push(next);
          i++;
        } else {
          flags[key] = next;
          i++;
        }
      }
    } else {
      positional.push(arg);
    }
    i++;
  }
  return { flags, positional };
}

// ─── Output helpers ───────────────────────────────────────────────────────────

function die(msg: string): never {
  process.stderr.write(`kanecta claude: ${msg}\n`);
  process.exit(1);
}

// ─── Capture helpers ──────────────────────────────────────────────────────────

function getOrCreateDateBucket(ds: any, cfg: any) {
  const today = new Date().toISOString().slice(0, 10);
  if (cfg && cfg.lastCaptureDate === today && cfg.lastCaptureDateId) {
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

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdWizard() {
  const { runWizard } = require('./lib/wizard.ts');
  await runWizard();
}

async function cmdCapture(positional: string[], flags: Flags) {
  const cfg = readConfig();
  if (!cfg) die('Kanecta not configured. Run `kanecta claude wizard` to set up.');

  const text = positional.join(' ');
  if (!text) die('Usage: kanecta claude capture "<text>" [--tag t] [--type text|string|decision]');

  const secrets = detectSecrets(text);
  if (secrets.length) {
    process.stderr.write(`kanecta claude: capture rejected — possible secret detected (${secrets.join(', ')})\n`);
    process.stderr.write(`kanecta claude: Kanecta never stores secrets. Remove the sensitive data and try again.\n`);
    process.exit(1);
  }

  const ds = new Datastore(expandHome(cfg.datastorePath));
  const dateBucketId = getOrCreateDateBucket(ds, cfg);

  const userTags = ([] as any[]).concat(flags['tag'] || []).filter((t: any) => !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t));
  const tags = ['kanecta-capture', ...userTags];
  const type = flags['type'] || 'text';
  if (!['text', 'string', 'decision', 'annotation'].includes(type)) die(`Invalid capture type: ${type}`);

  const item = ds.create({
    value: text,
    type,
    parentId: dateBucketId,
    owner: cfg.owner,
    tags,
    confidence: flags['confidence'] || null,
  });

  if (flags['alias']) ds.setAlias(flags['alias'], item.id);

  console.log(`Captured: ${item.id}`);
  if (userTags.length) console.log(`  Tags: ${userTags.join(', ')}`);
  const preview = text.length > 100 ? text.slice(0, 100) + '…' : text;
  console.log(`  ${preview}`);
}

async function cmdRecent(positional: string[], flags: Flags) {
  const cfg = readConfig();
  if (!cfg) die('Kanecta not configured. Run `kanecta claude wizard` to set up.');

  const n = parseInt(flags['n'] || flags['count'] || '10', 10);
  const ds = new Datastore(expandHome(cfg.datastorePath));

  const items = ds.loadAll()
    .filter((i: any) => (i.tags || []).includes('kanecta-capture'))
    .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, n);

  if (items.length === 0) {
    console.log('No captures yet. Use `kanecta claude capture "text"` to save your first one.');
    return;
  }

  console.log(`${items.length} recent capture(s):\n`);
  for (const item of items) {
    const date = (item.createdAt || '').slice(0, 10);
    const userTags = (item.tags || []).filter((t: any) => !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t));
    const tagStr = userTags.length ? ` [${userTags.join(', ')}]` : '';
    console.log(`${date}${tagStr}`);
    const val = String(item.value || '');
    console.log(`  ${val.length > 120 ? val.slice(0, 120) + '…' : val}`);
    console.log(`  id: ${item.id}`);
    console.log();
  }
}

async function cmdSearch(positional: string[], flags: Flags) {
  const query = positional.join(' ');
  if (!query) die('Usage: kanecta claude search "<query>"');

  const cfg = readConfig();
  let ds: any;
  if (flags['datastore']) {
    ds = new Datastore(flags['datastore']);
  } else if (cfg) {
    ds = new Datastore(expandHome(cfg.datastorePath));
  } else {
    die('Kanecta not configured. Run `kanecta claude wizard` to set up.');
  }

  const q = query.toLowerCase();
  const results = ds.loadAll()
    .filter((i: any) => i.value && typeof i.value === 'string' && i.value.toLowerCase().includes(q))
    .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, parseInt(flags['limit'] || '20', 10));

  if (results.length === 0) {
    console.log(`No results for "${query}"`);
    return;
  }

  console.log(`${results.length} result(s) for "${query}":\n`);
  for (const item of results) {
    const date = (item.createdAt || '').slice(0, 10);
    const userTags = (item.tags || []).filter((t: any) => !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t));
    const tagStr = userTags.length ? ` [${userTags.join(', ')}]` : '';
    console.log(`[${item.type}]${tagStr} ${date}`);
    const val = String(item.value || '');
    console.log(`  ${val.length > 120 ? val.slice(0, 120) + '…' : val}`);
    console.log(`  id: ${item.id}`);
    console.log();
  }
}

async function cmdSetup() {
  const { setupMcpServer } = require('./lib/mcp-setup.ts');
  const result = setupMcpServer();
  if (!result.ok) {
    process.stderr.write(`kanecta claude: MCP setup failed — ${result.error}\n`);
    process.exit(1);
  }
  if (result.method === 'claude-mcp-add') {
    console.log('MCP server registered via claude mcp add.');
  } else {
    console.log(`MCP server registered in ${result.file}`);
  }
  console.log('Restart Claude Code to activate.');
}

async function cmdMode(positional: string[]) {
  const mode = positional[0];
  const validModes = ['always', 'extended', 'ask-at-start', 'manual'];
  if (!mode || !validModes.includes(mode)) {
    die(`Usage: kanecta claude mode <always|extended|ask-at-start|manual>`);
  }
  const cfg = readConfig();
  if (!cfg) die('Kanecta not configured. Run `kanecta claude wizard` to set up.');
  cfg.captureMode = mode;
  writeConfig(cfg);
  const { injectClaudeMd } = require('./lib/claude.ts');
  injectClaudeMd(mode);
  console.log(`Capture mode: ${mode}`);
  console.log(`Updated ~/.claude/CLAUDE.md`);
}

async function cmdStatus() {
  const cfg = readConfig();
  if (!cfg || !cfg.wizardCompleted) {
    console.log('Not configured. Run `kanecta claude wizard` to set up.');
    return;
  }
  console.log(`Datastore:    ${cfg.datastorePath}`);
  console.log(`Owner:        ${cfg.owner}`);
  console.log(`Capture mode: ${cfg.captureMode}`);
  if (cfg.lastCaptureDate) console.log(`Last capture: ${cfg.lastCaptureDate}`);

  const { CLAUDE_MD, COMMANDS_DIR } = require('./lib/claude.ts');
  const { SETTINGS_PATH } = require('./lib/mcp-setup.ts');
  const hasClaude = fs.existsSync(CLAUDE_MD);
  const hasMcp = (() => {
    try {
      const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      return !!(s.mcpServers && s.mcpServers.kanecta);
    } catch { return false; }
  })();
  console.log(`CLAUDE.md:    ${hasClaude ? 'configured' : 'not found'}`);
  console.log(`MCP server:   ${hasMcp ? 'registered' : 'not registered'}`);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    if (argv.length === 0 && !isConfigured()) {
      const { runWizard } = require('./lib/wizard.ts');
      await runWizard();
      return;
    }
    process.stdout.write(HELP);
    process.exit(0);
  }

  const { flags, positional } = parseArgs(argv);
  const cmd = positional[0];
  const rest = positional.slice(1);

  switch (cmd) {
    case 'setup':   await cmdSetup(); break;
    case 'wizard':  await cmdWizard(); break;
    case 'capture': await cmdCapture(rest, flags); break;
    case 'recent':  await cmdRecent(rest, flags); break;
    case 'search':  await cmdSearch(rest, flags); break;
    case 'mode':    await cmdMode(rest); break;
    case 'status':  await cmdStatus(); break;
    case 'mcp':     { const { runMcpServer } = require('./lib/mcp.ts'); runMcpServer(); return; }
    default:
      die(`Unknown command: ${cmd}\nRun \`kanecta claude --help\` for usage.`);
  }
}

main().catch((err: any) => {
  process.stderr.write(`kanecta claude: ${err.message}\n`);
  process.exit(1);
});
