#!/usr/bin/env -S node --import tsx
'use strict';

/**
 * Sync component packages from source into the device component store.
 *
 * Usage:
 *   kanecta-sync-components [sourceDir] [--force] [--store <path>]
 *
 *   sourceDir   Directory of component packages (each with package.json +
 *               kanecta.item.json). Default: the repo's kanecta-ui/kanecta-components.
 *   --force     Re-copy packages even if already installed at that version.
 *   --store     Override the store path (else config/env/platform default).
 *
 * This is the "run from source" population path. When packages later come from a
 * registry, the store layout and the resolution contract are identical.
 */

import path from 'path';
import fs from 'fs';
import { syncFromSource, storePath } from '../src/componentStore.ts';

function parseArgs(argv: any) {
  const flags: any = { force: false };
  const positional: any[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') flags.force = true;
    else if (a === '--store') flags.store = argv[++i];
    else if (a === '-h' || a === '--help') flags.help = true;
    else positional.push(a);
  }
  return { flags, positional };
}

// Default source: kanecta-ui/kanecta-components relative to this package.
function defaultSource() {
  return path.resolve(__dirname, '..', '..', '..', 'kanecta-ui', 'kanecta-components');
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(fs.readFileSync(__filename, 'utf8')
      .split('\n').filter((l) => l.startsWith(' *') || l.startsWith('/**'))
      .map((l) => l.replace(/^\/?\*+ ?/, '')).join('\n') + '\n');
    return;
  }

  const source = positional[0] ? path.resolve(positional[0]) : defaultSource();
  const store = flags.store ? path.resolve(flags.store) : storePath();

  if (!fs.existsSync(source)) {
    console.error(`Source directory not found: ${source}`);
    process.exit(1);
  }

  console.log(`Syncing components\n  from: ${source}\n  into: ${store}`);
  const results = syncFromSource(source, { store, force: flags.force });
  const installed = results.filter((r) => r.installed);
  for (const r of results) {
    console.log(`  ${r.installed ? '+ installed' : '· present  '}  ${r.name}@${r.version}`);
  }
  console.log(`\nDone. ${results.length} package(s); ${installed.length} newly installed.`);
}

main();
