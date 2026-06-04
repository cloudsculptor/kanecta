#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Datastore, VALID_TYPES, VALID_CONFIDENCES, VALID_REL_TYPES, UUID_RE } = require('@kanecta/lib');

// ─── Help text ────────────────────────────────────────────────────────────────

const HELP = `
kanecta — Kanecta filesystem datastore CLI  (spec v1.1.0)

USAGE
  kanecta [--datastore <path>] <command> [options]

DATASTORE DISCOVERY
  1. --datastore <path> flag
  2. KANECTA_DATASTORE environment variable
  3. Walk up from the current directory looking for a .kanecta/ folder

COMMANDS

  init [path]
    Initialize a new Kanecta datastore at <path> (default: ~/.kanecta).
    --owner <email>       Datastore owner email or domain (required)

  get <id|alias>
    Print details of a single item.
    --json                Output raw JSON instead of formatted text

  create
    Create a new item.
    --type <type>         Item type: string|number|text|file|symlink|object|decision|annotation
                          (default: string)
    --value <text>        Item content. Use [[uuid]] syntax to inline-link other items.
    --parent <id|alias>   Parent item UUID or alias (omit for root-level items)
    --alias <name>        Set an alias for the new item immediately after creation
    --tag <tag>           Add a tag; repeat for multiple (e.g. --tag perf --tag security)
    --confidence <level>  experimental | exploring | decided | locked
    --license <id>        License identifier (e.g. MIT, Apache-2.0, CC-BY)
    --sort-order <n>      Integer sort position among siblings (default: appended last)
    --type-id <uuid>      Type-definition UUID; required when --type is object

  update <id|alias>
    Update fields on an existing item. Only supplied flags are changed.
    --value <text>        New value
    --parent <id|alias>   New parent (or "none" to make it a root item)
    --type <type>         New type
    --type-id <uuid>      New type-definition UUID
    --add-tag <tag>       Add a tag; repeat for multiple
    --remove-tag <tag>    Remove a tag; repeat for multiple
    --confidence <level>  New confidence level (or "none" to clear)
    --license <id>        New license (or "none" to clear)
    --sort-order <n>      New sort order

  delete <id|alias>
    Delete an item and its entire subtree. Warns if external items link to or
    relate to the deleted item(s).
    --force               Skip the confirmation prompt

  tree [id|alias]
    Display the full item tree rooted at <id> (or all roots if omitted).
    --depth <n>           Maximum depth to traverse (default: unlimited)
    --ids                 Prefix each line with the item's UUID

  alias set <alias> <id|alias>
    Create or overwrite an alias pointing to an item.

  alias get <alias>
    Resolve an alias to its target UUID.

  alias list
    List all aliases in the datastore.

  alias remove <alias>
    Remove an alias.

  annotate <id|alias> <content>
    Add an annotation (comment) to an item without modifying it.
    --reply-to <annotation-id>  Reply to an existing annotation (threaded discussion)

  annotations <id|alias>
    List all annotations on an item, in chronological order.

  relate <source> <type> <target>
    Create a typed semantic relationship between two items.
    <source> and <target> are UUIDs or aliases.
    <type> must be one of:
      relates-to | depends-on | enables | contradicts | blocks |
      blocked-by | prerequisite-for | derived-from | supersedes
    --note <text>         Optional note explaining the relationship

  relationships <id|alias>
    List all outbound and inbound relationships for an item.

  backlinks <id|alias>
    List all items that reference this one via [[uuid]] inline links.

  history <id|alias>
    Show the full change history (create / update / delete snapshots) for an item.

  tag list <tag>
    List the UUIDs of all items tagged with <tag>.

  export [id|alias]
    Export the tree as indented plain text to stdout.
    --depth <n>           Maximum depth (default: unlimited)
    --ids                 Prefix each line with the item's UUID
    --output <file>       Write to a file instead of stdout

  search <query>
    Full-text search across all item values.
    --root <id|alias>     Restrict search to items within this subtree
    --limit <n>           Maximum number of results (default: 20)

  by-type <typeId>
    List all items with the given type-definition UUID.

  rebuild-indexes
    Rebuild all index caches (links/, tags/, types/) by scanning data/.
    Use after manual edits or a partial import.

ITEM TYPES
  string      Short text value
  number      Numeric value
  text        Long-form text (paragraphs, Markdown)
  file        File attachment — value is the filename
  symlink     Pointer to another item — value is the target UUID
  object      Structured instance of a type definition
  decision    Structured decision record (value is a JSON object)
  annotation  Annotation item type (see annotate command)

CONFIDENCE LEVELS
  experimental   Speculative; may change significantly
  exploring      Actively investigating; alternatives open
  decided        Decision made; could be revisited
  locked         Settled; not expected to change

EXAMPLES
  kanecta init ~/my-datastore --owner me@example.com
  kanecta --datastore ~/my-datastore create --value "Hello" --type string
  kanecta create --parent base-work-process --value "New step" --tag important
  kanecta get f1a00001-b45e-4c3d-9e7f-000000000001
  kanecta get base-work-process
  kanecta update base-work-process --add-tag reviewed --confidence decided
  kanecta delete f1a00001-b45e-4c3d-9e7f-000000000001 --force
  kanecta tree --depth 2 --ids
  kanecta alias set root f1a00001-b45e-4c3d-9e7f-000000000001
  kanecta annotate root "This is a top-level note"
  kanecta relate root depends-on f1a00002-b45e-4c3d-9e7f-000000000001 --note "clarify first"
  kanecta export --output kanecta.txt
  kanecta tag list security-related
  kanecta search "work process" --limit 10
  kanecta by-type f1a00001-b45e-4c3d-9e7f-000000000002
  kanecta rebuild-indexes
`.trimStart();

// ─── Arg parser ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        flags[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        // Boolean flags (no value, or next arg is another flag / positional)
        const boolFlags = ['force', 'ids', 'json'];
        if (boolFlags.includes(key) || !next || next.startsWith('--')) {
          flags[key] = true;
        } else {
          // Repeatable flags: tag, add-tag, remove-tag
          const repeatableFlags = ['tag', 'add-tag', 'remove-tag'];
          if (repeatableFlags.includes(key)) {
            if (!flags[key]) flags[key] = [];
            flags[key].push(next);
          } else {
            flags[key] = next;
          }
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
  let dir = process.cwd();
  while (true) {
    if (Datastore.isDatastore(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function openDatastore(flags) {
  const root = findDatastore(flags['datastore']);
  if (!root) {
    if (flags['datastore']) {
      die(`Datastore not found at: ${flags['datastore']}`);
    }
    const defaultPath = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.kanecta');
    console.log('No Kanecta datastore found.');
    const ok = await confirm(`Create a new datastore at ${defaultPath}?`);
    if (!ok) {
      console.log('Aborted. Run `kanecta init [path] --owner <email>` to create a datastore.');
      process.exit(0);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const owner = await new Promise(resolve => rl.question('Owner email: ', ans => { rl.close(); resolve(ans.trim()); }));
    if (!owner) die('Owner email is required.');
    Datastore.init(defaultPath, owner);
    console.log(`\nInitialized Kanecta datastore at ${defaultPath}\n`);
    return Datastore.open(defaultPath);
  }
  return Datastore.open(root);
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
    const display = Array.isArray(val) ? val.join(', ') : String(val);
    console.log(`  ${label.padEnd(20)} ${display}`);
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
  field('cachedAt', item.cachedAt);
  field('subscribedAt', item.subscribedAt);
  field('subscriptionSource', item.subscriptionSource);
}

function printTree(nodes, showIds) {
  for (const { item, depth } of nodes) {
    const indent = '  '.repeat(depth);
    if (showIds) {
      console.log(`${item.id} | ${indent}${item.value ?? '(no value)'}`);
    } else {
      console.log(`${indent}${item.value ?? '(no value)'}`);
    }
  }
}

function confirm(question) {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) { resolve(false); return; }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, ans => {
      rl.close();
      resolve(ans.trim().toLowerCase() === 'y');
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectSubtreeIds(ds, id) {
  const ids = [id];
  for (const child of ds.children(id)) {
    ids.push(...collectSubtreeIds(ds, child.id));
  }
  return ids;
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function cmdInit(positional, flags) {
  const defaultPath = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.kanecta');
  const root = path.resolve(positional[0] || defaultPath);
  const owner = flags['owner'];
  if (!owner) die('--owner <email> is required for init');
  if (Datastore.isDatastore(root)) die(`Already a Kanecta datastore: ${root}`);
  Datastore.init(root, owner);
  console.log(`Initialized Kanecta datastore at ${root}`);
  console.log(`Owner: ${owner}`);
}

async function cmdGet(positional, flags) {
  const ds = await openDatastore(flags);
  const ref = positional[0];
  if (!ref) die('Usage: kanecta get <id|alias>');
  const item = ds.resolve(ref);
  if (!item) die(`Not found: ${ref}`);
  if (flags['json']) {
    console.log(JSON.stringify(item, null, 2));
  } else {
    printItem(item);
  }
}

async function cmdCreate(positional, flags) {
  const ds = await openDatastore(flags);

  const type = flags['type'] || 'string';
  if (!VALID_TYPES.includes(type)) die(`Invalid type: ${type}. Valid: ${VALID_TYPES.join(', ')}`);

  const confidence = flags['confidence'] || null;
  if (confidence && !VALID_CONFIDENCES.includes(confidence))
    die(`Invalid confidence: ${confidence}. Valid: ${VALID_CONFIDENCES.join(', ')}`);

  let parentId = null;
  if (flags['parent']) {
    const parent = ds.resolve(flags['parent']);
    if (!parent) die(`Parent not found: ${flags['parent']}`);
    parentId = parent.id;
  }

  const tags = [].concat(flags['tag'] || []);
  const sortOrder = flags['sort-order'] != null ? parseInt(flags['sort-order'], 10) : undefined;

  const item = ds.create({
    parentId,
    value: flags['value'] || null,
    type,
    typeId: flags['type-id'] || null,
    license: flags['license'] || null,
    sortOrder,
    confidence,
    tags,
  });

  if (flags['alias']) {
    ds.setAlias(flags['alias'], item.id);
    console.log(`Alias set: ${flags['alias']} → ${item.id}`);
  }

  console.log(`Created: ${item.id}`);
  printItem(item);
}

async function cmdUpdate(positional, flags) {
  const ds = await openDatastore(flags);
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
  } else if ('type-id' in flags) {
    changes.typeId = flags['type-id'];
  }

  if ('parent' in flags) {
    if (flags['parent'] === 'none') {
      changes.parentId = null;
    } else {
      const parent = ds.resolve(flags['parent']);
      if (!parent) die(`Parent not found: ${flags['parent']}`);
      changes.parentId = parent.id;
    }
  }

  if ('sort-order' in flags) changes.sortOrder = parseInt(flags['sort-order'], 10);

  if ('confidence' in flags) {
    const c = flags['confidence'];
    if (c === 'none') {
      changes.confidence = null;
    } else {
      if (!VALID_CONFIDENCES.includes(c)) die(`Invalid confidence: ${c}`);
      changes.confidence = c;
    }
  }

  if ('license' in flags) {
    changes.license = flags['license'] === 'none' ? null : flags['license'];
  }

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
  const ds = await openDatastore(flags);
  const ref = positional[0];
  if (!ref) die('Usage: kanecta delete <id|alias>');

  const item = ds.resolve(ref);
  if (!item) die(`Not found: ${ref}`);

  const subtreeIds = collectSubtreeIds(ds, item.id);
  const childCount = subtreeIds.length - 1;

  if (!flags['force']) {
    const warnings = ds.deleteWarnings(item.id);
    if (warnings.length) {
      console.warn('Warning:');
      for (const w of warnings) console.warn(`  ${w}`);
    }
    const suffix = childCount > 0 ? ` and ${childCount} child item(s)` : '';
    const ok = await confirm(`Delete "${item.value ?? item.id}"${suffix}?`);
    if (!ok) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  for (const id of subtreeIds.reverse()) {
    ds.delete(id);
  }
  const suffix = childCount > 0 ? ` (+ ${childCount} children)` : '';
  console.log(`Deleted: ${item.id}  "${item.value ?? ''}"${suffix}`);
}

async function cmdTree(positional, flags) {
  const ds = await openDatastore(flags);
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
  const ds = await openDatastore(flags);
  const sub = positional[0];

  if (sub === 'set') {
    const alias = positional[1], ref = positional[2];
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
    for (const { alias, targetId } of aliases) {
      console.log(`${alias.padEnd(30)} ${targetId}`);
    }
  } else if (sub === 'remove') {
    const alias = positional[1];
    if (!alias) die('Usage: kanecta alias remove <alias>');
    ds.removeAlias(alias);
    console.log(`Removed alias: ${alias}`);
  } else {
    die('Usage: kanecta alias <set|get|list|remove> ...');
  }
}

async function cmdAnnotate(positional, flags) {
  const ds = await openDatastore(flags);
  const ref = positional[0], content = positional.slice(1).join(' ') || flags['content'];
  if (!ref || !content) die('Usage: kanecta annotate <id|alias> <content>');
  const item = ds.resolve(ref);
  if (!item) die(`Not found: ${ref}`);
  const annotation = ds.annotate(item.id, {
    content,
    parentAnnotationId: flags['reply-to'] || null,
  });
  console.log(`Annotation created: ${annotation.id}`);
  console.log(`  Target:  ${annotation.targetId}`);
  console.log(`  Author:  ${annotation.author}`);
  console.log(`  Created: ${annotation.createdAt}`);
  if (annotation.parentAnnotationId)
    console.log(`  Reply to: ${annotation.parentAnnotationId}`);
  console.log(`  Content: ${annotation.content}`);
}

async function cmdAnnotations(positional, flags) {
  const ds = await openDatastore(flags);
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
  const ds = await openDatastore(flags);
  const [srcRef, type, tgtRef] = positional;
  if (!srcRef || !type || !tgtRef) die('Usage: kanecta relate <source> <type> <target> [--note <text>]');
  if (!ds.relTypes.includes(type)) die(`Invalid relationship type: ${type}\nValid: ${ds.relTypes.join(', ')}`);
  const src = ds.resolve(srcRef);
  if (!src) die(`Source not found: ${srcRef}`);
  const tgt = ds.resolve(tgtRef);
  if (!tgt) die(`Target not found: ${tgtRef}`);
  const rel = ds.relate(src.id, type, tgt.id, { note: flags['note'] || null });
  console.log(`Relationship created: ${rel.id}`);
  console.log(`  ${src.id} --[${type}]--> ${tgt.id}`);
  if (rel.note) console.log(`  Note: ${rel.note}`);
}

async function cmdRelationships(positional, flags) {
  const ds = await openDatastore(flags);
  const ref = positional[0];
  if (!ref) die('Usage: kanecta relationships <id|alias>');
  const item = ds.resolve(ref);
  if (!item) die(`Not found: ${ref}`);
  const rels = ds.relationships(item.id);
  const outbound = rels.outbound || [];
  const inbound = rels.inbound || [];
  if (outbound.length === 0 && inbound.length === 0) { console.log('(no relationships)'); return; }
  if (outbound.length) {
    console.log('Outbound:');
    for (const r of outbound)
      console.log(`  [${r.type}] → ${r.targetId}${r.note ? '  ' + r.note : ''}`);
  }
  if (inbound.length) {
    console.log('Inbound:');
    for (const r of inbound)
      console.log(`  [${r.type}] ← ${r.sourceId}${r.note ? '  ' + r.note : ''}`);
  }
}

async function cmdBacklinks(positional, flags) {
  const ds = await openDatastore(flags);
  const ref = positional[0];
  if (!ref) die('Usage: kanecta backlinks <id|alias>');
  const item = ds.resolve(ref);
  if (!item) die(`Not found: ${ref}`);
  const ids = ds.backlinks(item.id);
  if (ids.length === 0) { console.log('(no backlinks)'); return; }
  console.log(`${ids.length} item(s) link to ${item.id}:`);
  for (const id of ids) console.log(`  ${id}`);
}

async function cmdHistory(positional, flags) {
  const ds = await openDatastore(flags);
  const ref = positional[0];
  if (!ref) die('Usage: kanecta history <id|alias>');
  const item = ds.resolve(ref);
  if (!item) die(`Not found: ${ref}`);
  const entries = ds.history(item.id);
  if (entries.length === 0) { console.log('(no history)'); return; }
  for (const e of entries) {
    console.log(`[${e.changeType.toUpperCase()}] ${e.snapshotAt}  by ${e.changedBy}`);
    if (e.value != null) console.log(`  value: ${String(e.value).slice(0, 80)}`);
  }
}

async function cmdTagList(positional, flags) {
  const ds = await openDatastore(flags);
  const tag = positional[0];
  if (!tag) die('Usage: kanecta tag list <tag>');
  const ids = ds.byTag(tag);
  if (ids.length === 0) { console.log(`(no items tagged "${tag}")`); return; }
  console.log(`${ids.length} item(s) tagged "${tag}":`);
  for (const id of ids) console.log(`  ${id}`);
}

async function cmdExport(positional, flags) {
  const ds = await openDatastore(flags);
  let rootId = null;
  if (positional[0]) {
    const item = ds.resolve(positional[0]);
    if (!item) die(`Not found: ${positional[0]}`);
    rootId = item.id;
  }
  const maxDepth = flags['depth'] != null ? parseInt(flags['depth'], 10) : Infinity;
  const nodes = ds.tree(rootId, maxDepth);
  const lines = [];
  for (const { item, depth } of nodes) {
    const indent = '  '.repeat(depth);
    if (flags['ids']) {
      lines.push(`${item.id} | ${indent}${item.value ?? ''}`);
    } else {
      lines.push(`${indent}${item.value ?? ''}`);
    }
  }
  const output = lines.join('\n') + '\n';

  if (flags['output']) {
    fs.writeFileSync(flags['output'], output);
    console.log(`Wrote ${flags['output']}`);
  } else {
    process.stdout.write(output);
  }
}

async function cmdSearch(positional, flags) {
  const ds = await openDatastore(flags);
  const query = positional[0];
  if (!query) die('Usage: kanecta search <query> [--root <id|alias>] [--limit <n>]');

  const limit = flags['limit'] != null ? parseInt(flags['limit'], 10) : 20;
  const lower = query.toLowerCase();

  let items;
  if (flags['root']) {
    const rootItem = ds.resolve(flags['root']);
    if (!rootItem) die(`Root not found: ${flags['root']}`);
    const subtreeIds = new Set(collectSubtreeIds(ds, rootItem.id));
    items = ds.loadAll().filter(i => subtreeIds.has(i.id));
  } else {
    items = ds.loadAll();
  }

  const results = items
    .filter(i => i.value && i.value.toLowerCase().includes(lower))
    .slice(0, limit);

  if (results.length === 0) {
    console.log(`No results for "${query}"`);
    return;
  }
  console.log(`${results.length} result(s) for "${query}":`);
  for (const r of results) {
    console.log(`  ${r.id}  ${r.value}`);
  }
}

async function cmdByType(positional, flags) {
  const ds = await openDatastore(flags);
  const typeId = positional[0];
  if (!typeId) die('Usage: kanecta by-type <typeId>');
  const ids = ds.byType(typeId);
  if (ids.length === 0) { console.log(`(no items with type-id "${typeId}")`); return; }
  console.log(`${ids.length} item(s) with type-id "${typeId}":`);
  for (const id of ids) console.log(`  ${id}`);
}

async function cmdRebuildIndexes(positional, flags) {
  const ds = await openDatastore(flags);
  const count = ds.rebuildIndexes();
  console.log(`Rebuilt indexes from ${count} items.`);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const { flags, positional } = parseArgs(argv);

  // Strip global --datastore from positional command routing
  const cmd = positional[0];
  const rest = positional.slice(1);

  switch (cmd) {
    case 'init':           await cmdInit(rest, flags); break;
    case 'get':            await cmdGet(rest, flags); break;
    case 'create':         await cmdCreate(rest, flags); break;
    case 'update':         await cmdUpdate(rest, flags); break;
    case 'delete':         await cmdDelete(rest, flags); break;
    case 'tree':           await cmdTree(rest, flags); break;
    case 'alias':          await cmdAlias(rest, flags); break;
    case 'annotate':       await cmdAnnotate(rest, flags); break;
    case 'annotations':    await cmdAnnotations(rest, flags); break;
    case 'relate':         await cmdRelate(rest, flags); break;
    case 'relationships':  await cmdRelationships(rest, flags); break;
    case 'backlinks':      await cmdBacklinks(rest, flags); break;
    case 'history':        await cmdHistory(rest, flags); break;
    case 'tag':
      if (rest[0] === 'list') await cmdTagList(rest.slice(1), flags);
      else die('Usage: kanecta tag list <tag>');
      break;
    case 'export':         await cmdExport(rest, flags); break;
    case 'search':         await cmdSearch(rest, flags); break;
    case 'by-type':        await cmdByType(rest, flags); break;
    case 'rebuild-indexes': await cmdRebuildIndexes(rest, flags); break;
    default:
      die(`Unknown command: ${cmd}\nRun \`kanecta --help\` for usage.`);
  }
}

main().catch(err => {
  process.stderr.write(`kanecta: ${err.message}\n`);
  process.exit(1);
});
