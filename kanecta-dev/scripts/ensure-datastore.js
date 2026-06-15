#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const readline = require('readline');
const { execSync, spawn } = require('child_process');
const { Datastore } = require('@kanecta/lib');

const HOME = os.homedir();
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');

const POINTER_LOCATIONS = [
  path.join(XDG_CONFIG, 'kanecta', 'config.json'),
  path.join(HOME, '.kanecta', 'config.json'),
];

const NAME_RE = /^[a-zA-Z0-9-]+$/;

const POINTER_SPEC = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../pointer-file-spec.json'), 'utf8'),
);

function checkWorkspacesFormat(workspaces, propSpec, errors) {
  if (typeof workspaces !== 'object' || workspaces === null || Array.isArray(workspaces)) {
    errors.push('"workspaces" must be an object');
    return;
  }
  const names = Object.keys(workspaces);
  if (propSpec.minProperties && names.length < propSpec.minProperties) {
    errors.push(`"workspaces" must have at least ${propSpec.minProperties} entr${propSpec.minProperties === 1 ? 'y' : 'ies'}`);
    return;
  }
  for (const name of names) {
    const ws = workspaces[name];
    const prefix = `workspaces.${name}`;
    if (typeof ws !== 'object' || ws === null || Array.isArray(ws)) {
      errors.push(`"${prefix}" must be an object`);
      continue;
    }
    if (!ws.mode) {
      errors.push(`"${prefix}.mode" is required`);
    } else if (!propSpec.modes.includes(ws.mode)) {
      errors.push(`"${prefix}.mode" must be one of: ${propSpec.modes.join(', ')}`);
    }
    const needsDatastore = ws.mode === 'FILESYSTEM' || ws.mode === 'DUAL_FILESYSTEM_PRIMARY' || ws.mode === 'DUAL_CLOUD_PRIMARY';
    const needsCloud      = ws.mode === 'CLOUD'      || ws.mode === 'DUAL_FILESYSTEM_PRIMARY' || ws.mode === 'DUAL_CLOUD_PRIMARY';
    if (needsDatastore && typeof ws.datastore !== 'string') {
      errors.push(`"${prefix}.datastore" must be a string (required for ${ws.mode} mode)`);
    }
    if (needsCloud && (typeof ws.cloud !== 'object' || ws.cloud === null || Array.isArray(ws.cloud))) {
      errors.push(`"${prefix}.cloud" must be an object (required for ${ws.mode} mode)`);
    }
  }
}

function checkPointerFileFormat(data, sourceFile) {
  const spec = POINTER_SPEC;
  const errors = [];

  for (const key of spec.required) {
    if (!(key in data)) errors.push(`missing required field "${key}"`);
  }

  for (const [key, val] of Object.entries(data)) {
    if (spec.additionalProperties === false && !(key in spec.properties)) {
      errors.push(`unexpected field "${key}"`);
      continue;
    }
    const propSpec = spec.properties[key];
    if (!propSpec) continue;
    if (key === 'workspaces') {
      checkWorkspacesFormat(val, propSpec, errors);
    } else if (propSpec.type === 'integer' && !Number.isInteger(val)) {
      errors.push(`"${key}" must be an integer`);
    } else if (propSpec.type === 'string' && typeof val !== 'string') {
      errors.push(`"${key}" must be a string`);
    } else if (propSpec.type === 'array') {
      if (!Array.isArray(val)) {
        errors.push(`"${key}" must be an array`);
      } else if (propSpec.minItems && val.length < propSpec.minItems) {
        errors.push(`"${key}" must have at least ${propSpec.minItems} item(s)`);
      } else if (propSpec.items?.type) {
        val.forEach((item, i) => {
          if (typeof item !== propSpec.items.type) {
            errors.push(`"${key}[${i}]" must be a ${propSpec.items.type}`);
          }
        });
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\n  ✗ Pointer file format is invalid (${sourceFile}):`);
    errors.forEach(e => console.error(`    - ${e}`));
    console.error(`\n  Expected format is defined in kanecta-dev/pointer-file-spec.json`);
    console.error(`  Fix ${sourceFile} and try again.\n`);
    process.exit(1);
  }
  console.log(`  ✓ pointer file format OK (checked against pointer-file-spec.json)`);
}

function checkPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function expandHome(p) {
  return p.replace(/^~/, HOME);
}

// Migrates the old { default, datastores: [...] } + separate cloud.json shape
// into the merged { default, workspaces: { name -> { mode, datastore?, cloud? } } }
// shape. Runs automatically the first time the old shape is detected — backs up
// both old files (with a `.pre-workspace-refactor` suffix) and removes cloud.json
// (its contents now live inside the matching workspace's `cloud` block).
function migrateOldConfig(file, oldData) {
  console.log(`\n  → Migrating ${file} to the workspace-based config format...`);

  const cloudFile = path.join(XDG_CONFIG, 'kanecta', 'cloud.json');
  const backupConfigFile = `${file}.pre-workspace-refactor`;
  const backupCloudFile = `${cloudFile}.pre-workspace-refactor`;

  fs.copyFileSync(file, backupConfigFile);
  console.log(`    backed up ${file} → ${backupConfigFile}`);

  const workspaces = {};
  const usedNames = new Set();
  const uniqueName = (base) => {
    let name = base, n = 2;
    while (usedNames.has(name)) name = `${base}-${n++}`;
    usedNames.add(name);
    return name;
  };

  // The old runtime gave `cloud.json` existence absolute priority — every consumer
  // checked `fs.existsSync(cloud.json)` first and, if true, opened cloud mode
  // regardless of what `datastores`/`default` said. So if cloud.json is present,
  // CLOUD is the workspace that's actually active right now, even when the
  // 'cloud' sentinel is missing from `datastores` (e.g. cloud.json was added
  // by hand after `datastores` was already populated with filesystem paths).
  const cloudFileExists = fs.existsSync(cloudFile);
  let cloudWorkspaceName = null;
  const loadCloudConfig = () => {
    const { new: _isNew, ...rest } = JSON.parse(fs.readFileSync(cloudFile, 'utf8'));
    if (!fs.existsSync(backupCloudFile)) {
      fs.copyFileSync(cloudFile, backupCloudFile);
      console.log(`    backed up ${cloudFile} → ${backupCloudFile}`);
    }
    return rest;
  };

  let defaultName = null;
  for (const datastorePath of oldData.datastores) {
    let name, workspace;
    if (datastorePath === 'cloud') {
      name = uniqueName('cloud');
      workspace = { mode: 'CLOUD', cloud: cloudFileExists ? loadCloudConfig() : {} };
      cloudWorkspaceName = name;
    } else {
      name = uniqueName(path.basename(datastorePath) || 'datastore');
      workspace = { mode: 'FILESYSTEM', datastore: datastorePath };
    }
    workspaces[name] = workspace;
    if (datastorePath === oldData.default) defaultName = name;
  }

  // cloud.json existed but no 'cloud' sentinel was found — the user was actually
  // running in cloud mode (per the old priority rule). Add the workspace and make
  // it the default, since that's the mode that was actually active.
  if (cloudFileExists && !cloudWorkspaceName) {
    cloudWorkspaceName = uniqueName('cloud');
    workspaces[cloudWorkspaceName] = { mode: 'CLOUD', cloud: loadCloudConfig() };
    console.log(`    note: ${cloudFile} existed without a 'cloud' entry in datastores —`);
    console.log(`    your setup was actually running in CLOUD mode (cloud.json took priority over`);
    console.log(`    the filesystem datastore), so workspace '${cloudWorkspaceName}' is now the default.`);
    defaultName = cloudWorkspaceName;
  }

  if (!defaultName) defaultName = Object.keys(workspaces)[0];

  const newData = {
    default: defaultName,
    workspaces,
    studioPort: oldData.studioPort ?? 9743,
    apiPort: oldData.apiPort ?? 9744,
    ...(oldData.systemItemsDir ? { systemItemsDir: oldData.systemItemsDir } : {}),
  };

  fs.writeFileSync(file, JSON.stringify(newData, null, 2) + '\n', 'utf8');
  if (fs.existsSync(cloudFile)) fs.unlinkSync(cloudFile);

  console.log(`  ✓ Migrated — workspaces: ${Object.keys(workspaces).join(', ')} (default: ${defaultName})`);
  console.log(`    ${cloudFile} removed (now redundant — its config lives in the workspace's \`cloud\` block)\n`);

  return newData;
}

function readPointer(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.default && data.workspaces && typeof data.workspaces === 'object' && !Array.isArray(data.workspaces)) {
      return data;
    }
    if (data.default && Array.isArray(data.datastores)) return migrateOldConfig(file, data);
  } catch {}
  return null;
}

function writePointer(name, workspace, apiPort, studioPort, systemItemsDir) {
  const file = POINTER_LOCATIONS[0];
  const isNew = !fs.existsSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = readPointer(file) || { default: null, workspaces: {}, studioPort: 9743, apiPort: 9744 };
  data.workspaces[name] = workspace;
  data.default = name;
  data.apiPort = apiPort;
  data.studioPort = studioPort;
  if (systemItemsDir) data.systemItemsDir = systemItemsDir;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  if (isNew) {
    console.log(`  → Writing ${file}`);
    console.log(`    (XDG pointer file — records where your datastore lives so npm start can find it next time)`);
  } else {
    console.log(`  → Updated ${file}`);
  }
}

function resolveFromEnv() {
  const raw = process.env.KANECTA_DATASTORE;
  console.log(`  checking KANECTA_DATASTORE env → ${raw || '(not set)'}`);
  if (!raw) return null;
  const p = expandHome(raw);
  if (Datastore.isDatastore(p)) return p;
  console.log(`  ✗ not a valid datastore`);
  return null;
}

function resolveFromPointers() {
  for (const file of POINTER_LOCATIONS) {
    console.log(`  checking ${file}`);
    const data = readPointer(file);
    const names = data ? Object.keys(data.workspaces) : [];
    if (names.length === 0) {
      console.log(`  ✗ not found`);
      continue;
    }
    console.log(`  ✓ found (${names.length} workspace${names.length > 1 ? 's' : ''})`);
    return { file, data };
  }
  return null;
}

function checkSpecVersion(datastorePath) {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
  );
  const expectedVersion = rootPkg.version;

  const configPath = path.join(datastorePath, '.kanecta', 'config', 'config.json');
  if (!fs.existsSync(configPath)) {
    console.log(`  spec version check: skipped (no config.json found at ${configPath})`);
    return;
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const datastoreVersion = config.specVersion ?? '(not set)';

  if (datastoreVersion === expectedVersion) {
    console.log(`  spec version check: ✓ ${datastoreVersion}`);
  } else {
    console.error(
      `\n  spec version check: ✗ datastore specVersion (${datastoreVersion}) does not match expected (${expectedVersion})\n` +
      `  Update config.json specVersion or check kanecta-specification for migration notes.\n`,
    );
    process.exit(1);
  }
}

function pathCompleter(line) {
  try {
    const expanded = line.replace(/^~/, HOME);
    const trailingSlash = expanded.endsWith('/');
    const dir = trailingSlash || expanded === '' ? (expanded || '.') : path.dirname(expanded) || '.';
    const base = trailingSlash ? '' : path.basename(expanded);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const matches = entries
      .filter(e => e.name.startsWith(base))
      .map(e => {
        const full = dir === '.' ? e.name : path.join(dir, e.name);
        const display = line.startsWith('~') ? full.replace(HOME, '~') : full;
        return e.isDirectory() ? display + '/' : display;
      });
    return [matches, line];
  } catch {
    return [[], line];
  }
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

async function pickWorkspace(names) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\nMultiple workspaces found. Which one would you like to use?\n');
  names.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
  console.log();
  const answer = await ask(rl, `Choice [1-${names.length}]: `);
  rl.close();
  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= names.length) {
    console.error('Invalid choice.');
    process.exit(1);
  }
  return names[idx];
}

async function wizard() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, completer: pathCompleter });

  console.log('\n┌──────────────────────────────────────────┐');
  console.log('│         Kanecta — First Run Setup        │');
  console.log('└──────────────────────────────────────────┘\n');
  console.log('No datastore configured. How would you like to proceed?\n');
  console.log('  1. Create a new datastore (filesystem)');
  console.log('  2. Use an existing filesystem datastore');
  console.log('  3. Import from a zip file');
  console.log('  4. Connect to a Postgres + S3 cloud datastore');
  console.log('  5. Exit\n');

  const choice = await ask(rl, 'Choice [1-5]: ');

  // ── Collect all inputs before doing anything ──────────────────────────────

  let datastorePath;
  let zipPath = null;
  let owner = null;
  let cloudConfig = null;
  let isNewCloudDb = false;
  let mode; // 'create' | 'existing' | 'zip' | 'cloud'

  if (choice === '4') {
    mode = 'cloud';
    console.log('\nCloud datastore setup — you will need a Postgres connection string and S3-compatible credentials.\n');

    const pgConn = await ask(rl, 'Postgres connection string (e.g. postgres://user:pass@host:5432/db): ');
    if (!pgConn) { console.error('Connection string required.'); rl.close(); process.exit(1); }

    const s3Endpoint = await ask(rl, 'S3 endpoint URL (e.g. http://localhost:45900 for MinIO): ');
    const s3Key      = await ask(rl, 'S3 access key ID: ');
    const s3Secret   = await ask(rl, 'S3 secret access key: ');
    const s3Bucket   = await ask(rl, 'S3 bucket name [kanecta]: ') || 'kanecta';
    const isNewAnswer = await ask(rl, 'Is this a brand-new database? (creates schema + root nodes) [y/N]: ');
    isNewCloudDb = isNewAnswer.toLowerCase() === 'y';
    owner = isNewCloudDb
      ? await ask(rl, 'Owner identifier (email or domain): ')
      : null;

    cloudConfig = {
      pg: { connectionString: pgConn },
      s3: { endpoint: s3Endpoint, accessKeyId: s3Key, secretAccessKey: s3Secret, bucket: s3Bucket },
    };
    datastorePath = 'cloud'; // placeholder — not a real path

  } else if (choice === '5') {
    rl.close();
    console.log('Aborted.');
    process.exit(0);

  } else if (choice === '1') {
    mode = 'create';
    const dirInput = await ask(rl, 'Datastore parent directory [~/]:');
    const dir = dirInput || '~/';

    let name;
    while (true) {
      name = await ask(rl, 'Datastore name (letters, numbers, hyphens only) [kanecta]: ') || 'kanecta';
      if (NAME_RE.test(name)) break;
      console.log('  Invalid name. Use letters, numbers, and hyphens only.');
    }

    console.log('  (used to mark data ownership — not for communication. Should be globally unique: an email or domain is ideal.)');
    owner = await ask(rl, 'Owner identifier: ');
    if (!owner) { console.error('Owner identifier required.'); rl.close(); process.exit(1); }

    datastorePath = path.join(expandHome(dir), name);

  } else if (choice === '2') {
    mode = 'existing';
    const dir = await ask(rl, 'Path to datastore: ');
    datastorePath = expandHome(dir);
    if (!Datastore.isDatastore(datastorePath)) {
      console.error(`Not a valid Kanecta datastore: ${datastorePath}`);
      rl.close();
      process.exit(1);
    }

  } else if (choice === '3') {
    mode = 'zip';
    const zipInput = await ask(rl, 'Path to zip file: ');
    zipPath = expandHome(zipInput);
    if (!fs.existsSync(zipPath)) {
      console.error(`File not found: ${zipPath}`);
      rl.close();
      process.exit(1);
    }

    const dirInput = await ask(rl, 'Datastore parent directory [~/]: ');
    const dir = dirInput || '~/';

    let name;
    while (true) {
      name = await ask(rl, 'Datastore name (letters, numbers, hyphens only) [kanecta]: ') || 'kanecta';
      if (NAME_RE.test(name)) break;
      console.log('  Invalid name. Use letters, numbers, and hyphens only.');
    }

    datastorePath = path.join(expandHome(dir), name);

  } else {
    rl.close();
    console.log('Aborted.');
    process.exit(0);
  }

  // ── Workspace naming ───────────────────────────────────────────────────────

  const defaultWorkspaceName = mode === 'cloud' ? 'cloud' : (path.basename(datastorePath) || 'kanecta');
  let workspaceName;
  while (true) {
    workspaceName = await ask(rl, `Workspace name [${defaultWorkspaceName}]: `) || defaultWorkspaceName;
    if (NAME_RE.test(workspaceName)) break;
    console.log('  Invalid name. Use letters, numbers, and hyphens only.');
  }

  const frontendPortInput = await ask(rl, 'Frontend port [9743]: ');
  const studioPort = parseInt(frontendPortInput || '9743', 10);
  const apiPortInput = await ask(rl, `API port [${studioPort + 1}]: `);
  const apiPort = parseInt(apiPortInput || String(studioPort + 1), 10);

  const defaultCommonTypesDir = path.resolve(__dirname, '../../kanecta-system-items/items');
  const systemItemsDirInput = await ask(rl, `System items directory [${defaultCommonTypesDir}]: `);
  const systemItemsDir = expandHome(systemItemsDirInput || defaultCommonTypesDir);

  // ── Summary + confirmation ─────────────────────────────────────────────────

  const summary = {
    workspace: workspaceName,
    datastore: datastorePath,
    ...(owner ? { owner } : {}),
    ...(zipPath ? { importFrom: zipPath } : {}),
    frontendPort: studioPort,
    apiPort,
    systemItemsDir,
    pointerFile: POINTER_LOCATIONS[0],
  };

  console.log('\nReady to set up:\n');
  console.log(JSON.stringify(summary, null, 2));
  console.log();

  const action = mode === 'existing'
    ? `register ${datastorePath} in pointer file`
    : mode === 'zip'
    ? `extract zip and create datastore at ${datastorePath}`
    : mode === 'cloud'
    ? `connect to Postgres at ${cloudConfig.pg.connectionString.replace(/:\/\/[^@]+@/, '://<credentials>@')}`
    : `create datastore at ${datastorePath}`;

  const confirm = await ask(rl, `OK to ${action} and write ${POINTER_LOCATIONS[0]}? [Y/n]: `);
  if (confirm.toLowerCase() === 'n') {
    rl.close();
    console.log('Aborted.');
    process.exit(0);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  if (mode === 'cloud') {
    console.log('\n✓ Cloud datastore configured — Postgres + S3 will be used as the backend.');
    if (isNewCloudDb) {
      const { Datastore } = require('@kanecta/lib');
      await Datastore.initCloud(cloudConfig, owner);
      console.log('  ✓ Schema migrated and root nodes created.');
    }
    rl.close();
    const workspace = { mode: 'CLOUD', cloud: cloudConfig };
    writePointer(workspaceName, workspace, apiPort, studioPort, systemItemsDir);
    return { name: workspaceName, workspace, apiPort, studioPort, systemItemsDir };

  } else if (mode === 'create') {
    fs.mkdirSync(datastorePath, { recursive: true });
    Datastore.init(datastorePath, owner);
    console.log(`\n✓ Created datastore at ${datastorePath}`);

  } else if (mode === 'zip') {
    fs.mkdirSync(datastorePath, { recursive: true });
    try {
      execSync(`unzip -o "${zipPath}" -d "${datastorePath}"`, { stdio: 'inherit' });
    } catch {
      console.error('\nFailed to extract zip. Make sure unzip is installed: sudo apt install unzip');
      rl.close();
      process.exit(1);
    }
    if (!Datastore.isDatastore(datastorePath)) {
      console.error(`Extracted files do not look like a Kanecta datastore: ${datastorePath}`);
      rl.close();
      process.exit(1);
    }
    console.log(`\n✓ Imported datastore to ${datastorePath}`);
  }

  rl.close();
  const workspace = { mode: 'FILESYSTEM', datastore: datastorePath };
  writePointer(workspaceName, workspace, apiPort, studioPort, systemItemsDir);
  return { name: workspaceName, workspace, apiPort, studioPort, systemItemsDir };
}

async function syncSystemItems(datastorePath, systemItemsDir) {
  if (!systemItemsDir) {
    console.log('\n  system items check: skipped (systemItemsDir not configured)');
    return;
  }
  if (!fs.existsSync(systemItemsDir)) {
    console.log(`\n  system items check: skipped (systemItemsDir not found: ${systemItemsDir})`);
    return;
  }

  console.log('\n  system items check...');

  // Scan systemItemsDir — 2+2+UUID sharding
  const allSystemItems = [];
  for (const shard1 of fs.readdirSync(systemItemsDir)) {
    const shard1Path = path.join(systemItemsDir, shard1);
    if (!fs.statSync(shard1Path).isDirectory()) continue;
    for (const shard2 of fs.readdirSync(shard1Path)) {
      const shard2Path = path.join(shard1Path, shard2);
      if (!fs.statSync(shard2Path).isDirectory()) continue;
      for (const itemId of fs.readdirSync(shard2Path)) {
        const itemPath = path.join(shard2Path, itemId);
        const metaPath = path.join(itemPath, 'metadata.json');
        if (!fs.existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          allSystemItems.push({ id: itemId, meta, sourcePath: itemPath });
        } catch {}
      }
    }
  }

  // Calculate: non-type items missing from the datastore
  const dataRoot = path.join(datastorePath, '.kanecta', 'data');
  const nonTypeItems = allSystemItems.filter(item => item.meta.type !== 'type');
  const itemsToAdd = nonTypeItems.filter(({ id }) =>
    !fs.existsSync(path.join(dataRoot, id.slice(0, 2), id.slice(2, 4), id, 'metadata.json'))
  );

  // Calculate: types required by those items that are missing from .kanecta/types
  const typesRoot = path.join(datastorePath, '.kanecta', 'types');
  const typeIds = [...new Set(itemsToAdd.map(i => i.meta.typeId).filter(Boolean))];
  const typesToAdd = allSystemItems.filter(i =>
    typeIds.includes(i.id) &&
    !fs.existsSync(path.join(typesRoot, i.id.slice(0, 2), i.id.slice(2, 4), i.id, 'metadata.json'))
  );

  if (itemsToAdd.length === 0 && typesToAdd.length === 0) {
    console.log('  system items check: all system items already present');
    return;
  }

  // Show proposed changes
  console.log('\n  Proposed changes:');
  if (itemsToAdd.length > 0) {
    console.log(`\n  Items to add to .kanecta/data (${itemsToAdd.length}):`);
    for (const { id, meta } of itemsToAdd) {
      console.log(`    + "${meta.value || id}"  (${id})`);
    }
  }
  if (typesToAdd.length > 0) {
    console.log(`\n  Types to add to .kanecta/types (${typesToAdd.length}):`);
    for (const { id, meta } of typesToAdd) {
      console.log(`    + "${meta.value || id}"  (${id})`);
    }
  }

  // Prompt for confirmation
  if (!process.stdin.isTTY) {
    console.log('\n  system items check: non-interactive session, skipping apply');
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await ask(rl, '\n  Apply these changes? [Y/n]: ');
  rl.close();

  if (answer.toLowerCase() === 'n') {
    console.log('  system items check: skipped by user');
    return;
  }

  // Apply
  for (const { id, meta, sourcePath } of itemsToAdd) {
    const destPath = path.join(dataRoot, id.slice(0, 2), id.slice(2, 4), id);
    fs.mkdirSync(destPath, { recursive: true });
    for (const file of fs.readdirSync(sourcePath)) {
      fs.copyFileSync(path.join(sourcePath, file), path.join(destPath, file));
    }
    console.log(`  + added item: "${meta.value || id}" (${id})`);
  }

  for (const { id, meta, sourcePath } of typesToAdd) {
    const destPath = path.join(typesRoot, id.slice(0, 2), id.slice(2, 4), id);
    fs.mkdirSync(destPath, { recursive: true });
    for (const file of fs.readdirSync(sourcePath)) {
      fs.copyFileSync(path.join(sourcePath, file), path.join(destPath, file));
    }
    console.log(`  + added type: "${meta.value || id}" (${id})`);
  }
}

// `workspaceName` is null when launched via an explicit KANECTA_DATASTORE env
// override (no named workspace involved); `datastorePath` is null for pure-cloud
// workspaces (no filesystem path to expose).
async function launch(workspaceName, datastorePath, apiPort, studioPort, systemItemsDir) {
  const [apiFree, studioFree] = await Promise.all([
    checkPortFree(apiPort),
    checkPortFree(studioPort),
  ]);

  function portError(label, port, configKey) {
    console.error(`\n  ✗ ${label} port ${port} is already in use. Free the port or update ${configKey} in your config.\n`);
    console.error(`  To kill the process using port ${port}:\n`);
    console.error(`    Linux / macOS (bash)   fuser -k ${port}/tcp`);
    console.error(`                           kill $(lsof -ti tcp:${port})`);
    console.error(`    macOS                  lsof -ti tcp:${port} | xargs kill -9`);
    console.error(`    Windows (cmd)          for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /PID %a /F`);
    console.error(`    Windows (PowerShell)   Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force\n`);
  }

  if (!apiFree) {
    portError('API', apiPort, 'apiPort');
    process.exit(1);
  }
  if (!studioFree) {
    portError('Studio', studioPort, 'studioPort');
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, '../..');
  const concurrentlyBin = path.join(repoRoot, 'node_modules', '.bin', 'concurrently');

  console.log(`  API port:    ${apiPort}`);
  console.log(`  Studio port: ${studioPort}`);

  const proc = spawn(
    concurrentlyBin,
    [
      '-n', 'api,studio',
      '-c', 'cyan,magenta',
      '--kill-others-on-fail',
      'npm run dev -w kanecta-api',
      `npm run dev -w kanecta-apps/kanecta-app-studio -- --port ${studioPort} --strictPort`,
    ],
    {
      cwd: repoRoot,
      env: (() => {
        // Build child env from scratch so a stale or mis-quoted KANECTA_DATASTORE
        // in the parent shell (e.g. unexpanded tilde) can't leak into the server.
        const e = { ...process.env };
        delete e.KANECTA_DATASTORE;
        if (workspaceName) e.KANECTA_WORKSPACE = workspaceName;
        if (datastorePath) e.KANECTA_DATASTORE = datastorePath;
        e.PORT = String(apiPort);
        e.KANECTA_API_URL = `http://localhost:${apiPort}`;
        if (systemItemsDir) e.KANECTA_SYSTEM_ITEMS_DIR = systemItemsDir;
        // `npm start` from source has no Keycloak instance to point at — force
        // both sides into auth-disabled mode so the local dev loop never needs
        // one. Real auth is only exercised by deploying with KEYCLOAK_URL/
        // VITE_KEYCLOAK_URL set (or against the kanecta-keycloak dev stack).
        e.AUTH_DISABLED = 'true';
        e.VITE_AUTH_DISABLED = 'true';
        return e;
      })(),
      stdio: 'inherit',
    },
  );

  proc.on('exit', (code) => process.exit(code ?? 0));
}

async function main() {
  console.log('\nKanecta — locating datastore...');

  // 1. Explicit env override — forces filesystem mode at this path
  let datastorePath = resolveFromEnv();
  if (datastorePath) {
    console.log(`✓ Datastore: ${datastorePath}`);
    checkSpecVersion(datastorePath);
    await syncSystemItems(datastorePath, process.env.KANECTA_SYSTEM_ITEMS_DIR);
    return launch(null, datastorePath, 9744, 9743);
  }

  // 2. Pointer files
  const pointer = resolveFromPointers();
  if (pointer) {
    const { file: pointerFile, data } = pointer;
    checkPointerFileFormat(data, pointerFile);
    const names = Object.keys(data.workspaces);
    let name;
    let selectionReason;
    if (names.length === 1) {
      name = names[0];
      selectionReason = 'only workspace';
    } else if (data.default && data.workspaces[data.default]) {
      name = data.default;
      selectionReason = 'default';
    } else if (!process.stdin.isTTY) {
      console.error(`Multiple workspaces found and no valid default set in ${pointerFile}.`);
      process.exit(1);
    } else {
      name = await pickWorkspace(names);
      selectionReason = 'selected';
    }

    const workspace = data.workspaces[name];
    if (!workspace) {
      console.error(`Workspace '${name}' not found in ${pointerFile}`);
      process.exit(1);
    }

    if (workspace.mode === 'CLOUD') {
      console.log(`✓ Workspace: ${name} (${selectionReason}; cloud — Postgres + S3)`);
      return launch(name, null, data.apiPort ?? 9744, data.studioPort ?? 9743, data.systemItemsDir);
    }
    if (!Datastore.isDatastore(workspace.datastore)) {
      console.error(`Datastore not found at configured path: ${workspace.datastore}`);
      process.exit(1);
    }
    console.log(`✓ Workspace: ${name} (${selectionReason}; ${workspace.datastore})`);
    checkSpecVersion(workspace.datastore);
    await syncSystemItems(workspace.datastore, data.systemItemsDir);

    return launch(name, workspace.datastore, data.apiPort ?? 9744, data.studioPort ?? 9743, data.systemItemsDir);
  }

  // 3. First-run wizard
  if (!process.stdin.isTTY) {
    console.error('No datastore configured. Run npm start to set up.');
    process.exit(1);
  }
  const wizardResult = await wizard();
  const workspace = wizardResult.workspace;
  if (workspace.mode !== 'CLOUD') {
    checkSpecVersion(workspace.datastore);
    await syncSystemItems(workspace.datastore, wizardResult.systemItemsDir);
  }
  launch(wizardResult.name, workspace.datastore ?? null, wizardResult.apiPort, wizardResult.studioPort, wizardResult.systemItemsDir);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
