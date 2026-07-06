'use strict';

/**
 * Migration: spec 1.2.0 → 1.3.0
 *
 * 1. Patches every item's metadata.json:
 *    - license == null  → DEFAULT_LICENSE ("All Rights Reserved (Copyright)")
 *    - visibility missing → 'private'
 *    - aspect missing     → null
 * 2. Bumps specVersion to 1.3.0
 *
 * Usage: node scripts/migrate-1.3.0.js <datastore-root> [<datastore-root> ...]
 */

import fs from 'fs';
import path from 'path';
import { Datastore, DEFAULT_LICENSE } from '../src/index.ts';

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error('Usage: node scripts/migrate-1.3.0.js <datastore-root> [...]');
  process.exit(1);
}

function walkMetadataFiles(dataDir: any) {
  const files: any[] = [];
  const walk = (dir: any) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name === 'metadata.json') files.push(path.join(dir, e.name));
    }
  };
  walk(dataDir);
  return files;
}

for (const root of roots) {
  const resolved = path.resolve(root.replace(/^~/, process.env.HOME as string));
  console.log(`\n── Migrating: ${resolved}`);

  if (!Datastore.isDatastore(resolved)) {
    console.error('  ✗ Not a Kanecta datastore — skipping');
    continue;
  }

  const k = path.join(resolved, '.kanecta');
  const cfgPath = path.join(k, 'config', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

  if (cfg.specVersion === '1.3.0') {
    console.log('  ✓ Already at 1.3.0 — skipping');
    continue;
  }

  const metadataFiles = walkMetadataFiles(path.join(k, 'data'));
  console.log(`  → Scanning ${metadataFiles.length} item(s)...`);

  let licensePatched = 0;
  let visibilityPatched = 0;
  let aspectPatched = 0;

  for (const metaPath of metadataFiles) {
    const item = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    let changed = false;

    if (item.license == null) {
      item.license = DEFAULT_LICENSE;
      licensePatched += 1;
      changed = true;
    }
    if (!('visibility' in item)) {
      item.visibility = 'private';
      visibilityPatched += 1;
      changed = true;
    }
    if (!('aspect' in item)) {
      item.aspect = null;
      aspectPatched += 1;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(metaPath, JSON.stringify(item, null, 2) + '\n');
      console.log(`    patched: ${item.id} (${item.value ?? '(no value)'})`);
    }
  }

  console.log(`  ✓ license patched:    ${licensePatched}`);
  console.log(`  ✓ visibility patched: ${visibilityPatched}`);
  console.log(`  ✓ aspect patched:     ${aspectPatched}`);

  const newCfg = { ...cfg, specVersion: '1.3.0' };
  fs.writeFileSync(cfgPath, JSON.stringify(newCfg, null, 2) + '\n');
  console.log('  ✓ specVersion → 1.3.0');
}
