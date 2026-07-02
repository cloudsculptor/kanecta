#!/usr/bin/env node
'use strict';

/**
 * Import Claude Code session transcripts into a Kanecta datastore.
 *
 * Usage:
 *   kanecta-import-transcripts [path] [options]
 *
 *   path                     A .jsonl transcript file, or a directory scanned
 *                            recursively for *.jsonl. Default:
 *                            ~/.claude/projects
 *
 * Datastore selection (same resolution as the CLI):
 *   --datastore <path>       Open this filesystem datastore directly.
 *   --working-set <name>     Use this working set from config.json.
 *   --branch <name>          Import into this branch (default: active/resolved).
 *
 * Options:
 *   --dry-run                Parse and report only; write nothing.
 *   --max-text-chars <n>     Cap stored turn text (default 20000; 0 = unlimited).
 *   --max-result-chars <n>   Cap stored tool-result text (default 20000; 0 = unlimited).
 *   -h, --help               Show this help.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const {
  Datastore,
  resolveWorkingSet,
  resolveBranch,
} = require('@kanecta/lib');
const {
  parseTranscript,
  importSession,
  findTranscriptFiles,
} = require('../src');

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { flags.help = true; }
    else if (a === '--dry-run') { flags.dryRun = true; }
    else if (a.startsWith('--')) { flags[a.slice(2)] = argv[++i]; }
    else { positional.push(a); }
  }
  return { flags, positional };
}

function help() {
  process.stdout.write(fs.readFileSync(__filename, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith(' *') || l.startsWith('/**'))
    .map((l) => l.replace(/^\/?\*+ ?/, ''))
    .join('\n') + '\n');
}

async function openDatastore(flags) {
  if (flags.datastore) return Datastore.open(flags.datastore);
  const { name, workingSet } = resolveWorkingSet(flags['working-set']);
  const branch = resolveBranch(name, flags.branch);
  return Datastore.openWorkingSet(workingSet, { branch });
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.help) { help(); return; }

  const target = positional[0] || path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(target)) {
    console.error(`Path not found: ${target}`);
    process.exit(1);
  }

  const stat = fs.statSync(target);
  const files = stat.isDirectory() ? findTranscriptFiles(target) : [target];
  if (files.length === 0) {
    console.error(`No .jsonl transcripts found under ${target}`);
    process.exit(1);
  }

  const toNum = (v, dflt) => {
    if (v == null) return dflt;
    const n = Number(v);
    return n === 0 ? Infinity : n; // 0 = unlimited
  };
  const opts = {
    maxTextChars: toNum(flags['max-text-chars'], 20000),
    maxResultChars: toNum(flags['max-result-chars'], 20000),
  };

  console.log(`${flags.dryRun ? '[dry-run] ' : ''}Importing ${files.length} transcript file(s) from ${target}`);

  const ds = flags.dryRun ? null : await openDatastore(flags);
  const totals = { files: 0, sessions: 0, created: 0, updated: 0, turns: 0, toolCalls: 0, errors: 0 };

  for (const file of files) {
    try {
      if (flags.dryRun) {
        const sessions = parseTranscript(fs.readFileSync(file, 'utf8'));
        for (const s of sessions) {
          totals.sessions++;
          totals.turns += s.turnCount;
          totals.toolCalls += s.toolCallCount;
        }
      } else {
        const text = fs.readFileSync(file, 'utf8');
        for (const session of parseTranscript(text)) {
          const st = await importSession(ds, session, opts);
          totals.sessions++;
          totals.created += st.created;
          totals.updated += st.updated;
          totals.turns += st.turns;
          totals.toolCalls += st.toolCalls;
        }
      }
      totals.files++;
    } catch (err) {
      totals.errors++;
      console.error(`  ✗ ${file}: ${err.message}`);
    }
  }

  console.log(
    `\nDone. files=${totals.files} sessions=${totals.sessions} ` +
    `turns=${totals.turns} toolCalls=${totals.toolCalls}` +
    (flags.dryRun ? '' : ` created=${totals.created} updated=${totals.updated}`) +
    (totals.errors ? ` errors=${totals.errors}` : ''),
  );
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(1);
});
