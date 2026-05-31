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
  console.log('  1. Create a new datastore');
  console.log('  2. Use an existing directory');
  console.log('  3. Import from a zip file');
  console.log('  4. Exit\n');

  const choice = await ask(rl, 'Choice [1-4]: ');

  // ── Collect all inputs before doing anything ──────────────────────────────

  let datastorePath;
  let zipPath = null;
  let owner = null;
  let mode; // 'create' | 'existing' | 'zip'

  if (choice === '1') {
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
    : `create datastore at ${datastorePath}`;

  const confirm = await ask(rl, `OK to ${action} and write ${POINTER_LOCATIONS[0]}? [Y/n]: `);
  if (confirm.toLowerCase() === 'n') {
    rl.close();
    console.log('Aborted.');
    process.exit(0);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  if (mode === 'create') {
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
    return launch(datastorePath, 9744, 9743);
  }

  // 2. Pointer files
  const pointer = resolveFromPointers();
  if (pointer) {
    const { data } = pointer;
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
    return launch(datastorePath, data.apiPort ?? 9744, data.studioPort ?? 9743, data.systemItemsDir);
  }

  // 3. First-run wizard
  if (!process.stdin.isTTY) {
    console.error('No datastore configured. Run npm start to set up.');
    process.exit(1);
  }
  const wizardResult = await wizard();
  checkSpecVersion(wizardResult.datastorePath);
  launch(wizardResult.datastorePath, wizardResult.apiPort, wizardResult.studioPort, wizardResult.systemItemsDir);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
