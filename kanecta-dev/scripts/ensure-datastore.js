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
    if (propSpec.type === 'integer' && !Number.isInteger(val)) {
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

function readPointer(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.default && Array.isArray(data.datastores)) return data;
  } catch {}
  return null;
}

function writePointer(datastorePath, apiPort, studioPort, systemItemsDir) {
  const file = POINTER_LOCATIONS[0];
  const isNew = !fs.existsSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = readPointer(file) || { default: null, datastores: [], studioPort: 9743, apiPort: 9744 };
  if (!data.datastores.includes(datastorePath)) {
    data.datastores.push(datastorePath);
  }
  data.default = datastorePath;
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
  const p = process.env.KANECTA_DATASTORE;
  console.log(`  checking KANECTA_DATASTORE env → ${p || '(not set)'}`);
  if (!p) return null;
  if (Datastore.isDatastore(p)) return p;
  console.log(`  ✗ not a valid datastore`);
  return null;
}

function resolveFromPointers() {
  for (const file of POINTER_LOCATIONS) {
    console.log(`  checking ${file}`);
    const data = readPointer(file);
    if (!data || data.datastores.length === 0) {
      console.log(`  ✗ not found`);
      continue;
    }
    console.log(`  ✓ found (${data.datastores.length} datastore${data.datastores.length > 1 ? 's' : ''})`);
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

async function pickDatastore(datastores) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\nMultiple datastores found. Which one would you like to use?\n');
  datastores.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  console.log();
  const answer = await ask(rl, `Choice [1-${datastores.length}]: `);
  rl.close();
  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= datastores.length) {
    console.error('Invalid choice.');
    process.exit(1);
  }
  return datastores[idx];
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
    const isNew      = await ask(rl, 'Is this a brand-new database? (creates schema + root nodes) [y/N]: ');
    owner = isNew.toLowerCase() === 'y'
      ? await ask(rl, 'Owner identifier (email or domain): ')
      : null;

    cloudConfig = {
      pg:  { connectionString: pgConn },
      s3:  { endpoint: s3Endpoint, accessKeyId: s3Key, secretAccessKey: s3Secret, bucket: s3Bucket },
      new: isNew.toLowerCase() === 'y',
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



  const frontendPortInput = await ask(rl, 'Frontend port [9743]: ');
  const studioPort = parseInt(frontendPortInput || '9743', 10);
  const apiPortInput = await ask(rl, `API port [${studioPort + 1}]: `);
  const apiPort = parseInt(apiPortInput || String(studioPort + 1), 10);

  const defaultCommonTypesDir = path.resolve(__dirname, '../../kanecta-system-items/items');
  const systemItemsDirInput = await ask(rl, `System items directory [${defaultCommonTypesDir}]: `);
  const systemItemsDir = expandHome(systemItemsDirInput || defaultCommonTypesDir);

  // ── Summary + confirmation ─────────────────────────────────────────────────

  const summary = {
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
    const cloudFile = path.join(XDG_CONFIG, 'kanecta', 'cloud.json');
    fs.mkdirSync(path.dirname(cloudFile), { recursive: true });
    fs.writeFileSync(cloudFile, JSON.stringify(cloudConfig, null, 2) + '\n', 'utf8');
    console.log(`\n✓ Cloud config written to ${cloudFile}`);
    console.log('  Postgres + S3 will be used as the datastore backend.');
    if (cloudConfig.new) {
      const { Datastore } = require('@kanecta/lib');
      await Datastore.initCloud(cloudConfig, owner);
      console.log('  ✓ Schema migrated and root nodes created.');
    }
    rl.close();
    // For cloud mode, write a sentinel pointer so the app knows the mode.
    writePointer('cloud', studioPort, apiPort, systemItemsDir);
    return { datastorePath: 'cloud', apiPort, studioPort, systemItemsDir };

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
  writePointer(datastorePath, apiPort, studioPort, systemItemsDir);
  return { datastorePath, apiPort, studioPort, systemItemsDir };
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

async function launch(datastorePath, apiPort, studioPort, systemItemsDir) {
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
      env: {
        ...process.env,
        KANECTA_DATASTORE: datastorePath,
        PORT: String(apiPort),
        KANECTA_API_URL: `http://localhost:${apiPort}`,
        ...(systemItemsDir ? { KANECTA_SYSTEM_ITEMS_DIR: systemItemsDir } : {}),
      },
      stdio: 'inherit',
    },
  );

  proc.on('exit', (code) => process.exit(code ?? 0));
}

async function main() {
  console.log('\nKanecta — locating datastore...');

  // 1. Explicit env override
  let datastorePath = resolveFromEnv();
  if (datastorePath) {
    console.log(`✓ Datastore: ${datastorePath}`);
    checkSpecVersion(datastorePath);
    await syncSystemItems(datastorePath, process.env.KANECTA_SYSTEM_ITEMS_DIR);

    return launch(datastorePath, 9744, 9743);
  }

  // 2. Pointer files
  const pointer = resolveFromPointers();
  if (pointer) {
    const { file: pointerFile, data } = pointer;
    checkPointerFileFormat(data, pointerFile);
    if (data.datastores.length === 1) {
      datastorePath = data.datastores[0];
    } else {
      if (!process.stdin.isTTY) {
        datastorePath = data.default;
      } else {
        datastorePath = await pickDatastore(data.datastores);
      }
    }
    if (!Datastore.isDatastore(datastorePath)) {
      console.error(`Datastore not found at configured path: ${datastorePath}`);
      process.exit(1);
    }
    console.log(`✓ Datastore: ${datastorePath}`);
    checkSpecVersion(datastorePath);
    await syncSystemItems(datastorePath, data.systemItemsDir);

    return launch(datastorePath, data.apiPort ?? 9744, data.studioPort ?? 9743, data.systemItemsDir);
  }

  // 3. First-run wizard
  if (!process.stdin.isTTY) {
    console.error('No datastore configured. Run npm start to set up.');
    process.exit(1);
  }
  const wizardResult = await wizard();
  checkSpecVersion(wizardResult.datastorePath);
  await syncSystemItems(wizardResult.datastorePath, wizardResult.systemItemsDir);
  launch(wizardResult.datastorePath, wizardResult.apiPort, wizardResult.studioPort, wizardResult.systemItemsDir);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
