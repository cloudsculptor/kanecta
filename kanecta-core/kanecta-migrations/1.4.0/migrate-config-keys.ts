#!/usr/bin/env node
'use strict';

// Migrate a Kanecta config.json from the legacy shape to the working-set shape:
//   workspaces               -> workingSets
//   defaultWorkspace/default -> defaultWorkingSet
//   workingSets[*].branch    -> workingSets[*].defaultBranch
//
// The runtime resolver already tolerates the legacy keys, so this is a one-time
// cleanup that rewrites config.json to the canonical on-disk shape. Idempotent.
//
// Usage:
//   node migrate-config-keys.js [path/to/config.json]
//   (no arg → KANECTA_CONFIG / platform default, via @kanecta/lib)

const fs = require('fs');
const path = require('path');
const { getConfigPath, migrateConfigShape } = require('@kanecta/lib');

function resolvePath() {
  const arg = process.argv[2];
  if (arg) {
    const p = path.resolve(arg);
    return p.toLowerCase().endsWith('.json') ? p : path.join(p, 'config.json');
  }
  return getConfigPath();
}

function main() {
  const configPath = resolvePath();
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    console.error(`No config.json found at ${configPath}`);
    process.exit(1);
  }

  const before = JSON.parse(raw);
  const after = migrateConfigShape(before);

  if (JSON.stringify(before) === JSON.stringify(after)) {
    console.log(`Already migrated — no changes: ${configPath}`);
    return;
  }

  const backup = `${configPath}.bak`;
  fs.writeFileSync(backup, raw);
  fs.writeFileSync(configPath, JSON.stringify(after, null, 2) + '\n');
  console.log(`Migrated ${configPath}`);
  console.log(`  backup written to ${backup}`);
  console.log('  workspaces→workingSets, defaultWorkspace→defaultWorkingSet, branch→defaultBranch');
}

main();
