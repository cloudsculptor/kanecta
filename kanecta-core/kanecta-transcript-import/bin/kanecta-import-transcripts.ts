#!/usr/bin/env -S node --import tsx

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
 *   -h, --help               Show this help.
 *
 * Transcripts import as typed objects (claude-session / claude-turn /
 * claude-tool-call) with each tool call's arguments as child `property` items.
 * Text is stored in full (never truncated). Import is idempotent — re-running
 * updates in place and appends new turns.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  Datastore,
  resolveWorkingSet,
  resolveBranch,
} from '@kanecta/lib';
import {
  parseTranscript,
  importSession,
  findTranscriptFiles,
} from '../src/index.js';

interface Flags {
  help?: boolean;
  dryRun?: boolean;
  [key: string]: any;
}

function parseArgs(argv: string[]): { flags: Flags; positional: string[] } {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { flags.help = true; }
    else if (a === '--dry-run') { flags.dryRun = true; }
    else if (a.startsWith('--')) { flags[a.slice(2)] = argv[++i]; }
    else { positional.push(a); }
  }
  return { flags, positional };
}

function help(): void {
  process.stdout.write(fs.readFileSync(__filename, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith(' *') || l.startsWith('/**'))
    .map((l) => l.replace(/^\/?\*+ ?/, ''))
    .join('\n') + '\n');
}

async function openDatastore(flags: Flags): Promise<any> {
  if (flags.datastore) return Datastore.open(flags.datastore);
  const { name, workingSet } = resolveWorkingSet(flags['working-set']);
  const branch = resolveBranch(name, flags.branch);
  return Datastore.openWorkingSet(workingSet, { branch });
}

async function main(): Promise<void> {
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
          const st = await importSession(ds, session);
          totals.sessions++;
          totals.created += st.created;
          totals.updated += st.updated;
          totals.turns += st.turns;
          totals.toolCalls += st.toolCalls;
        }
      }
      totals.files++;
    } catch (err: any) {
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
