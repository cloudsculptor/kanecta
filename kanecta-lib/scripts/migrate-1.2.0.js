'use strict';

/**
 * Migration: spec 1.1.0 → 1.2.0
 *
 * 1. Creates well-known root nodes (root, system_root, app_root, component_root, data_root)
 * 2. Reparents items with parentId: null to data_root
 * 3. Bumps specVersion to 1.2.0
 *
 * Usage: node scripts/migrate-1.2.0.js <datastore-root> [<datastore-root> ...]
 */

const fs = require('fs');
const path = require('path');
const { Datastore } = require('../src/index');

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error('Usage: node scripts/migrate-1.2.0.js <datastore-root> [...]');
  process.exit(1);
}

for (const root of roots) {
  const resolved = path.resolve(root.replace(/^~/, process.env.HOME));
  console.log(`\n── Migrating: ${resolved}`);

  if (!Datastore.isDatastore(resolved)) {
    console.error(`  ✗ Not a Kanecta datastore — skipping`);
    continue;
  }

  const ds = new Datastore(resolved);
  const cfg = ds.config;

  if (cfg.specVersion === '1.2.0') {
    console.log('  ✓ Already at 1.2.0 — skipping');
    continue;
  }

  // 1. Create well-known root nodes (idempotent).
  console.log('  → Creating well-known root nodes...');
  ds._initRoots();
  const dataRoot = ds.getDataRoot();
  console.log(`  ✓ data_root id: ${dataRoot.id}`);

  // 2. Find all items with parentId: null and reparent to data_root.
  const all = ds.loadAll();
  const nullParents = all.filter(i => i.parentId === null);
  console.log(`  → Reparenting ${nullParents.length} item(s) with parentId: null to data_root...`);

  for (const item of nullParents) {
    const updated = { ...item, parentId: dataRoot.id };
    const metaPath = path.join(ds._itemDir(item.id), 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify(updated, null, 2) + '\n');
    console.log(`    reparented: ${item.id} (${item.value ?? '(no value)'})`);
  }

  // 3. Bump specVersion.
  const cfgPath = path.join(ds.k, 'config', 'config.json');
  const newCfg = { ...cfg, specVersion: '1.2.0' };
  fs.writeFileSync(cfgPath, JSON.stringify(newCfg, null, 2) + '\n');
  console.log('  ✓ specVersion → 1.2.0');

  // Verify.
  const remaining = ds.loadAll().filter(i => i.parentId === null);
  if (remaining.length === 0) {
    console.log('  ✓ Migration complete — no items with null parentId remain');
  } else {
    console.error(`  ✗ ${remaining.length} item(s) still have null parentId — investigate`);
  }
}
