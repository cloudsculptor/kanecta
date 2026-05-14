#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { Datastore, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE } = require('kanecta-cli/lib/datastore');
const { readConfig, writeConfig, getDatastorePath, isConfigured, expandHome } = require('./lib/config');
const { detectSecrets } = require('./lib/secrets');

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
kanecta — personal knowledge base for Claude  (spec v1.1.0)

USAGE
  kanecta [--datastore <path>] <command> [options]

CLAUDE INTEGRATION COMMANDS

  wizard
    Run the setup wizard (first run or re-configure).

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

DATASTORE COMMANDS

  init [path]
    Initialise a new Kanecta datastore.
    --owner <email>       Datastore owner (required)

  get <id|alias>
    Print details of a single item.
    --json                Raw JSON output

  create
    Create a new item.
    --type <type>         string|number|text|file|symlink|object|decision|annotation
    --value <text>        Item content (use [[uuid]] for inline links)
    --parent <id|alias>   Parent item
    --alias <name>        Set an alias on creation
    --tag <tag>           Add a tag (repeat for multiple)
    --confidence <level>  experimental|exploring|decided|locked
    --license <id>        License identifier
    --sort-order <n>      Sort position among siblings
    --type-id <uuid>      Type-definition UUID (required for --type object)

  update <id|alias>
    Update an item. Only supplied flags change.
    --value / --parent / --type / --type-id / --add-tag / --remove-tag
    --confidence / --license / --sort-order

  delete <id|alias>
    Delete an item. Warns if other items reference it.
    --force               Skip confirmation

  tree [id|alias]
    Display the item tree.
    --depth <n>           Max depth (default: unlimited)
    --ids                 Prefix lines with UUIDs

  alias set <alias> <id|alias>   Create or overwrite an alias
  alias get <alias>              Resolve an alias to its UUID
  alias list                     List all aliases
  alias remove <alias>           Remove an alias

  annotate <id|alias> <content>
    Add an annotation (comment) to an item.
    --reply-to <id>       Thread a reply

  annotations <id|alias>
    List annotations on an item.

  relate <source> <type> <target>
    Create a typed relationship. Types: relates-to | depends-on | enables |
    contradicts | blocks | blocked-by | prerequisite-for | derived-from | supersedes
    --note <text>         Optional note

  relationships <id|alias>      List outbound and inbound relationships
  backlinks <id|alias>          List items linking here via [[uuid]]
  history <id|alias>            Show change history
  tag list <tag>                List items tagged with <tag>

  export [id|alias]
    Export tree as indented text.
    --depth <n> / --ids / --output <file>

  rebuild-indexes
    Rebuild index caches by scanning data/. Use after manual edits.

DATASTORE DISCOVERY
  --datastore <path>  explicit path
  KANECTA_DATASTORE   environment variable
  ~/.kanecta-config.json  configured path from wizard
  walk up from cwd looking for .kanecta/

EXAMPLES
  kanecta                                          # first run → wizard
  kanecta capture "decided to use PostgreSQL" --tag decision
  kanecta search "postgres"
  kanecta recent --n 5
  kanecta tree --depth 2
  kanecta get base-work-process
  kanecta create --value "new item" --parent base-work-process --tag important
`.trimStart();

// ─── Arg parser ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  const positional = [];
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

// ─── Datastore discovery ──────────────────────────────────────────────────────

function findDatastore(explicit) {
  if (explicit) return explicit;
  if (process.env.KANECTA_DATASTORE) return process.env.KANECTA_DATASTORE;
  const cfg = readConfig();
  if (cfg && cfg.datastorePath) return expandHome(cfg.datastorePath);
  let dir = process.cwd();
  while (true) {
    if (Datastore.isDatastore(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function openDatastore(flags) {
  const root = findDatastore(flags['datastore']);
  if (!root) die('No Kanecta datastore found. Run `kanecta` to set up, or use --datastore.');
  return new Datastore(root);
}

// ─── Output helpers ───────────────────────────────────────────────────────────

function die(msg) {
  process.stderr.write(`kanecta: ${msg}\n`);
  process.exit(1);
}

function printItem(item) {
  const field = (label, val) => {
    if (val === null || val === undefined) return;
    if (Array.isArray(val) && val.length === 0) return;
    console.log(`  ${label.padEnd(20)} ${Array.isArray(val) ? val.join(', ') : String(val)}`);
  };
  console.log(`id:                  ${item.id}`);
  field('type', item.type);
  field('value', item.value);
  field('parent', item.parentId);
  field('owner', item.owner);
  field('createdBy', item.createdBy);
  field('modifiedBy', item.modifiedBy);
  field('createdAt', item.createdAt);
  field('modifiedAt', item.modifiedAt);
  field('sortOrder', item.sortOrder);
  field('confidence', item.confidence);
  field('tags', item.tags);
  field('license', item.license);
  field('typeId', item.typeId);
}

function printTree(nodes, showIds) {
  for (const { item, depth } of nodes) {
    const indent = '  '.repeat(depth);
    if (showIds) console.log(`${item.id} | ${indent}${item.value ?? '(no value)'}`);
    else console.log(`${indent}${item.value ?? '(no value)'}`);
  }
}

function confirm(question) {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) { resolve(false); return; }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, ans => { rl.close(); resolve(ans.trim().toLowerCase() === 'y'); });
  });
}

// ─── Capture helpers ──────────────────────────────────────────────────────────

function getOrCreateDateBucket(ds, cfg) {
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

// ─── Claude integration commands ──────────────────────────────────────────────

async function cmdWizard() {
  const { runWizard } = require('./lib/wizard');
  await runWizard();
}

async function cmdCapture(positional, flags) {
  const cfg = readConfig();
  if (!cfg) die('Kanecta not configured. Run `kanecta` to set up.');

  const text = positional.join(' ');
  if (!text) die('Usage: kanecta capture "<text>" [--tag t] [--type text|string|decision]');

  const secrets = detectSecrets(text);
  if (secrets.length) {
    process.stderr.write(`kanecta: capture rejected — possible secret detected (${secrets.join(', ')})\n`);
    process.stderr.write(`kanecta: Kanecta never stores secrets. Remove the sensitive data and try again.\n`);
    process.exit(1);
  }

  const ds = new Datastore(expandHome(cfg.datastorePath));
  const dateBucketId = getOrCreateDateBucket(ds, cfg);

  const userTags = [].concat(flags['tag'] || []).filter(t => !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t));
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

async function cmdRecent(positional, flags) {
  const cfg = readConfig();
  if (!cfg) die('Kanecta not configured. Run `kanecta` to set up.');

  const n = parseInt(flags['n'] || flags['count'] || '10', 10);
  const ds = new Datastore(expandHome(cfg.datastorePath));

  const items = ds.loadAll()
    .filter(i => (i.tags || []).includes('kanecta-capture'))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, n);

  if (items.length === 0) {
    console.log('No captures yet. Use `kanecta capture "text"` to save your first one.');
    return;
  }

  console.log(`${items.length} recent capture(s):\n`);
  for (const item of items) {
    const date = (item.createdAt || '').slice(0, 10);
    const userTags = (item.tags || []).filter(t => !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t));
    const tagStr = userTags.length ? ` [${userTags.join(', ')}]` : '';
    console.log(`${date}${tagStr}`);
    const val = String(item.value || '');
    console.log(`  ${val.length > 120 ? val.slice(0, 120) + '…' : val}`);
    console.log(`  id: ${item.id}`);
    console.log();
  }
}

async function cmdSearch(positional, flags) {
  const query = positional.join(' ');
  if (!query) die('Usage: kanecta search "<query>"');

  const cfg = readConfig();
  let ds;
  if (flags['datastore']) {
    ds = new Datastore(flags['datastore']);
  } else if (cfg) {
    ds = new Datastore(expandHome(cfg.datastorePath));
  } else {
    ds = openDatastore(flags);
  }

  const q = query.toLowerCase();
  const results = ds.loadAll()
    .filter(i => i.value && typeof i.value === 'string' && i.value.toLowerCase().includes(q))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, parseInt(flags['limit'] || '20', 10));

  if (results.length === 0) {
    console.log(`No results for "${query}"`);
    return;
  }

  console.log(`${results.length} result(s) for "${query}":\n`);
  for (const item of results) {
    const date = (item.createdAt || '').slice(0, 10);
    const userTags = (item.tags || []).filter(t => !['kanecta-capture', 'kanecta-date', 'kanecta-internal'].includes(t));
    const tagStr = userTags.length ? ` [${userTags.join(', ')}]` : '';
    console.log(`[${item.type}]${tagStr} ${date}`);
    const val = String(item.value || '');
    console.log(`  ${val.length > 120 ? val.slice(0, 120) + '…' : val}`);
    console.log(`  id: ${item.id}`);
    console.log();
  }
}

async function cmdMode(positional) {
  const mode = positional[0];
  const validModes = ['always', 'extended', 'ask-at-start', 'manual'];
  if (!mode || !validModes.includes(mode)) {
    die(`Usage: kanecta mode <always|extended|ask-at-start|manual>`);
  }
  const cfg = readConfig();
  if (!cfg) die('Kanecta not configured. Run `kanecta` to set up.');
  cfg.captureMode = mode;
  writeConfig(cfg);
  const { injectClaudeMd } = require('./lib/claude');
  injectClaudeMd(mode);
  console.log(`Capture mode: ${mode}`);
  console.log(`Updated ~/.claude/CLAUDE.md`);
}

async function cmdStatus() {
  const cfg = readConfig();
  if (!cfg || !cfg.wizardCompleted) {
    console.log('Not configured. Run `kanecta` to set up.');
    return;
  }
  console.log(`Datastore:    ${cfg.datastorePath}`);
  console.log(`Owner:        ${cfg.owner}`);
  console.log(`Capture mode: ${cfg.captureMode}`);
  if (cfg.lastCaptureDate) console.log(`Last capture: ${cfg.lastCaptureDate}`);

  const { CLAUDE_MD, COMMANDS_DIR } = require('./lib/claude');
  const { SETTINGS_PATH } = require('./lib/mcp-setup');
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

// ─── Datastore commands ───────────────────────────────────────────────────────

async function cmdInit(positional, flags) {
  const root = path.resolve(positional[0] || '.');
  const owner = flags['owner'];
  if (!owner) die('--owner <email> is required for init');
  if (Datastore.isDatastore(root)) die(`Already a Kanecta datastore: ${root}`);
  Datastore.init(root, owner);
  console.log(`Initialized Kanecta datastore at ${root}`);
  console.log(`Owner: ${owner}`);
}

async function cmdGet(positional, flags) {
  const ds = openDatastore(flags);
  const ref = positional[0];
  if (!ref) die('Usage: kanecta get <id|alias>');
  const item = ds.resolve(ref);
  if (!item) die(`Not found: ${ref}`);
  if (flags['json']) console.log(JSON.stringify(item, null, 2));
  else printItem(item);
}

async function cmdCreate(positional, flags) {
  const ds = openDatastore(flags);
  const type = flags['type'] || 'string';
  if (!VALID_TYPES.includes(type)) die(`Invalid type: ${type}`);
  const confidence = flags['confidence'] || null;
  if (confidence && !VALID_CONFIDENCES.includes(confidence)) die(`Invalid confidence: ${confidence}`);
  let parentId = null;
  if (flags['parent']) {
    const parent = ds.resolve(flags['parent']);
    if (!parent) die(`Parent not found: ${flags['parent']}`);
    parentId = parent.id;
  }
  const tags = [].concat(flags['tag'] || []);
  const sortOrder = flags['sort-order'] != null ? parseInt(flags['sort-order'], 10) : undefined;
  const item = ds.create({ parentId, value: flags['value'] || null, type, typeId: flags['type-id'] || null, license: flags['license'] || null, sortOrder, confidence, tags });
  if (flags['alias']) { ds.setAlias(flags['alias'], item.id); console.log(`Alias set: ${flags['alias']} → ${item.id}`); }
  console.log(`Created: ${item.id}`);
  printItem(item);
}

async function cmdUpdate(positional, flags) {
  const ds = openDatastore(flags);
  const ref = positional[0];
  if (!ref) die('Usage: kanecta update <id|alias> [options]');
  const item = ds.resolve(ref);
  if (!item) die(`Not found: ${ref}`);
  const changes = {};
  if ('value' in flags) changes.value = flags['value'];
  if ('type' in flags) {
    if (!VALID_TYPES.includes(flags['type'])) die(`Invalid type: ${flags['type']}`);
    changes.type = flags['type'];
    if ('type-id' in flags) changes.typeId = flags['type-id'];
  } else if ('type-id' in flags) { changes.typeId = flags['type-id']; }
  if ('parent' in flags) {
    if (flags['parent'] === 'none') { changes.parentId = null; }
    else { const p = ds.resolve(flags['parent']); if (!p) die(`Parent not found: ${flags['parent']}`); changes.parentId = p.id; }
  }
  if ('sort-order' in flags) changes.sortOrder = parseInt(flags['sort-order'], 10);
  if ('confidence' in flags) {
    const c = flags['confidence'];
    if (c === 'none') changes.confidence = null;
    else { if (!VALID_CONFIDENCES.includes(c)) die(`Invalid confidence: ${c}`); changes.confidence = c; }
  }
  if ('license' in flags) changes.license = flags['license'] === 'none' ? null : flags['license'];
  const addTags = [].concat(flags['add-tag'] || []);
  const removeTags = [].concat(flags['remove-tag'] || []);
  if (addTags.length || removeTags.length) {
    const current = new Set(item.tags || []);
    for (const t of removeTags) current.delete(t);
    for (const t of addTags) current.add(t);
    changes.tags = [...current];
  }
  if (Object.keys(changes).length === 0) die('No changes specified.');
  const updated = ds.update(item.id, changes);
  console.log(`Updated: ${updated.id}`);
  printItem(updated);
}

async function cmdDelete(positional, flags) {
  const ds = openDatastore(flags);
  const ref = positional[0];
  if (!ref) die('Usage: kanecta delete <id|alias>');
  const item = ds.resolve(ref);
  if (!item) die(`Not found: ${ref}`);
  const warnings = ds.deleteWarnings(item.id);
  if (warnings.length && !flags['force']) {
    console.warn('Warning:');
    for (const w of warnings) console.warn(`  ${w}`);
    const ok = await confirm(`Delete ${item.id} anyway?`);
    if (!ok) { console.log('Aborted.'); process.exit(0); }
  }
  ds.delete(item.id);
  console.log(`Deleted: ${item.id}  "${item.value ?? ''}"`);
}

async function cmdTree(positional, flags) {
  const ds = openDatastore(flags);
  let rootId = null;
  if (positional[0]) {
    const item = ds.resolve(positional[0]);
    if (!item) die(`Not found: ${positional[0]}`);
    rootId = item.id;
  }
  const maxDepth = flags['depth'] != null ? parseInt(flags['depth'], 10) : Infinity;
  const nodes = ds.tree(rootId, maxDepth);
  if (nodes.length === 0) console.log('(empty)');
  else printTree(nodes, !!flags['ids']);
}

async function cmdAlias(positional, flags) {
  const ds = openDatastore(flags);
  const sub = positional[0];
  if (sub === 'set') {
    const [,alias, ref] = positional;
    if (!alias || !ref) die('Usage: kanecta alias set <alias> <id|alias>');
    const item = ds.resolve(ref);
    if (!item) die(`Not found: ${ref}`);
    ds.setAlias(alias, item.id);
    console.log(`${alias} → ${item.id}`);
  } else if (sub === 'get') {
    const alias = positional[1];
    if (!alias) die('Usage: kanecta alias get <alias>');
    const id = ds.resolveAlias(alias);
    if (!id) die(`Alias not found: ${alias}`);
    console.log(id);
  } else if (sub === 'list') {
    const aliases = ds.listAliases();
    if (aliases.length === 0) { console.log('(no aliases)'); return; }
    for (const { alias, targetId } of aliases) console.log(`${alias.padEnd(30)} ${targetId}`);
  } else if (sub === 'remove') {
    const alias = positional[1];
    if (!alias) die('Usage: kanecta alias remove <alias>');
    ds.removeAlias(alias);
    console.log(`Removed alias: ${alias}`);
  } else { die('Usage: kanecta alias <set|get|list|remove> ...'); }
}

async function cmdAnnotate(positional, flags) {
  const ds = openDatastore(flags);
  const ref = positional[0], content = positional.slice(1).join(' ') || flags['content'];
  if (!ref || !content) die('Usage: kanecta annotate <id|alias> <content>');
  const item = ds.resolve(ref);
  if (!item) die(`Not found: ${ref}`);
  const annotation = ds.annotate(item.id, { content, parentAnnotationId: flags['reply-to'] || null });
  console.log(`Annotation created: ${annotation.id}`);
  console.log(`  Target:  ${annotation.targetId}`);
  console.log(`  Content: ${annotation.content}`);
}

async function cmdAnnotations(positional, flags) {
  const ds = openDatastore(flags);
  const ref = positional[0];
  if (!ref) die('Usage: kanecta annotations <id|alias>');
  const item = ds.resolve(ref);
  if (!item) die(`Not found: ${ref}`);
  const list = ds.annotations(item.id);
  if (list.length === 0) { console.log('(no annotations)'); return; }
  for (const a of list) {
    const thread = a.parentAnnotationId ? ` (reply to ${a.parentAnnotationId})` : '';
    console.log(`[${a.id}] ${a.createdAt}  ${a.author}${thread}`);
    console.log(`  ${a.content}`);
  }
}

async function cmdRelate(positional, flags) {
  const ds = openDatastore(flags);
  const [srcRef, type, tgtRef] = positional;
  if (!srcRef || !type || !tgtRef) die('Usage: kanecta relate <source> <type> <target>');
  if (!VALID_REL_TYPES.includes(type)) die(`Invalid type: ${type}\nValid: ${VALID_REL_TYPES.join(', ')}`);
  const src = ds.resolve(srcRef); if (!src) die(`Source not found: ${srcRef}`);
  const tgt = ds.resolve(tgtRef); if (!tgt) die(`Target not found: ${tgtRef}`);
  const rel = ds.relate(src.id, type, tgt.id, { note: flags['note'] || null });
  console.log(`Relationship created: ${rel.id}`);
  console.log(`  ${src.id} --[${type}]--> ${tgt.id}`);
  if (rel.note) console.log(`  Note: ${rel.note}`);
}

async function cmdRelationships(positional, flags) {
  const ds = openDatastore(flags);
  const ref = positional[0];
  if (!ref) die('Usage: kanecta relationships <id|alias>');
  const item = ds.resolve(ref); if (!item) die(`Not found: ${ref}`);
  const rels = ds.relationships(item.id);
  if (!(rels.outbound || []).length && !(rels.inbound || []).length) { console.log('(no relationships)'); return; }
  if ((rels.outbound || []).length) { console.log('Outbound:'); for (const r of rels.outbound) console.log(`  [${r.type}] → ${r.targetId}${r.note ? '  ' + r.note : ''}`); }
  if ((rels.inbound || []).length) { console.log('Inbound:'); for (const r of rels.inbound) console.log(`  [${r.type}] ← ${r.sourceId}${r.note ? '  ' + r.note : ''}`); }
}

async function cmdBacklinks(positional, flags) {
  const ds = openDatastore(flags);
  const ref = positional[0]; if (!ref) die('Usage: kanecta backlinks <id|alias>');
  const item = ds.resolve(ref); if (!item) die(`Not found: ${ref}`);
  const ids = ds.backlinks(item.id);
  if (ids.length === 0) { console.log('(no backlinks)'); return; }
  console.log(`${ids.length} item(s) link to ${item.id}:`);
  for (const id of ids) console.log(`  ${id}`);
}

async function cmdHistory(positional, flags) {
  const ds = openDatastore(flags);
  const ref = positional[0]; if (!ref) die('Usage: kanecta history <id|alias>');
  const item = ds.resolve(ref); if (!item) die(`Not found: ${ref}`);
  const entries = ds.history(item.id);
  if (entries.length === 0) { console.log('(no history)'); return; }
  for (const e of entries) {
    console.log(`[${e.changeType.toUpperCase()}] ${e.snapshotAt}  by ${e.changedBy}`);
    if (e.value != null) console.log(`  value: ${String(e.value).slice(0, 80)}`);
  }
}

async function cmdTagList(positional, flags) {
  const ds = openDatastore(flags);
  const tag = positional[0]; if (!tag) die('Usage: kanecta tag list <tag>');
  const ids = ds.byTag(tag);
  if (ids.length === 0) { console.log(`(no items tagged "${tag}")`); return; }
  console.log(`${ids.length} item(s) tagged "${tag}":`);
  for (const id of ids) console.log(`  ${id}`);
}

async function cmdExport(positional, flags) {
  const ds = openDatastore(flags);
  let rootId = null;
  if (positional[0]) {
    const item = ds.resolve(positional[0]); if (!item) die(`Not found: ${positional[0]}`);
    rootId = item.id;
  }
  const maxDepth = flags['depth'] != null ? parseInt(flags['depth'], 10) : Infinity;
  const nodes = ds.tree(rootId, maxDepth);
  const lines = nodes.map(({ item, depth }) => {
    const indent = '  '.repeat(depth);
    return flags['ids'] ? `${item.id} | ${indent}${item.value ?? ''}` : `${indent}${item.value ?? ''}`;
  });
  const output = lines.join('\n') + '\n';
  if (flags['output']) { fs.writeFileSync(flags['output'], output); console.log(`Wrote ${flags['output']}`); }
  else process.stdout.write(output);
}

async function cmdRebuildIndexes(positional, flags) {
  const ds = openDatastore(flags);
  const count = ds.rebuildIndexes();
  console.log(`Rebuilt indexes from ${count} items.`);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    if (argv.length === 0 && !isConfigured()) {
      // First run — launch wizard
      const { runWizard } = require('./lib/wizard');
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
    // ── Claude integration ──────────────────────────────────────────────────
    case 'wizard':          await cmdWizard(); break;
    case 'capture':         await cmdCapture(rest, flags); break;
    case 'recent':          await cmdRecent(rest, flags); break;
    case 'search':          await cmdSearch(rest, flags); break;
    case 'mode':            await cmdMode(rest); break;
    case 'status':          await cmdStatus(); break;
    case 'mcp':             { const { runMcpServer } = require('./lib/mcp'); runMcpServer(); return; }
    // ── Datastore spec ──────────────────────────────────────────────────────
    case 'init':            await cmdInit(rest, flags); break;
    case 'get':             await cmdGet(rest, flags); break;
    case 'create':          await cmdCreate(rest, flags); break;
    case 'update':          await cmdUpdate(rest, flags); break;
    case 'delete':          await cmdDelete(rest, flags); break;
    case 'tree':            await cmdTree(rest, flags); break;
    case 'alias':           await cmdAlias(rest, flags); break;
    case 'annotate':        await cmdAnnotate(rest, flags); break;
    case 'annotations':     await cmdAnnotations(rest, flags); break;
    case 'relate':          await cmdRelate(rest, flags); break;
    case 'relationships':   await cmdRelationships(rest, flags); break;
    case 'backlinks':       await cmdBacklinks(rest, flags); break;
    case 'history':         await cmdHistory(rest, flags); break;
    case 'tag':
      if (rest[0] === 'list') await cmdTagList(rest.slice(1), flags);
      else die('Usage: kanecta tag list <tag>');
      break;
    case 'export':          await cmdExport(rest, flags); break;
    case 'rebuild-indexes': await cmdRebuildIndexes(rest, flags); break;
    default:
      die(`Unknown command: ${cmd}\nRun \`kanecta --help\` for usage.`);
  }
}

main().catch(err => {
  process.stderr.write(`kanecta: ${err.message}\n`);
  process.exit(1);
});
