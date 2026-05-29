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

function findFreePort(preferred) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      const s2 = net.createServer();
      s2.unref();
      s2.on('error', reject);
      s2.listen(0, '127.0.0.1', () => {
        const { port } = s2.address();
        s2.close(() => resolve(port));
      });
    });
    server.listen(preferred, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
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

function writePointer(datastorePath, apiPort, studioPort) {
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
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(datastorePath, '.kanecta', 'config', 'config.json'), 'utf8'),
    );
    const specMd = fs.readFileSync(
      path.join(__dirname, '../../kanecta-specification/specification.md'),
      'utf8',
    );
    const match = specMd.match(/^\*\*Version:\*\*\s*(.+)$/m);
    if (!match) return;
    const specVersion = match[1].trim();
    if (config.specVersion !== specVersion) {
      console.error(
        `\nError: datastore specVersion (${config.specVersion}) does not match specification (${specVersion})\n` +
        `Update your datastore or check kanecta-specification/specification.md\n`,
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(`\nError reading spec version: ${err.message}\n`);
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
  let datastorePath;

  if (choice === '1') {
    const dirInput = await ask(rl, 'Datastore parent directory [~/]:');
    const dir = dirInput || '~/';

    let name;
    while (true) {
      name = await ask(rl, 'Datastore name (letters, numbers, hyphens only) [kanecta]: ') || 'kanecta';
      if (NAME_RE.test(name)) break;
      console.log('  Invalid name. Use letters, numbers, and hyphens only.');
    }

    console.log('  (used to mark data ownership — not for communication. Should be globally unique: an email or domain is ideal.)');
    const email = await ask(rl, 'Owner identifier: ');
    if (!email) { console.error('Owner identifier required.'); rl.close(); process.exit(1); }

    datastorePath = path.join(expandHome(dir), name);
    fs.mkdirSync(datastorePath, { recursive: true });
    Datastore.init(datastorePath, email);
    console.log(`\n✓ Created datastore at ${datastorePath}\n`);

  } else if (choice === '2') {
    const dir = await ask(rl, 'Path to datastore: ');
    datastorePath = expandHome(dir);
    if (!Datastore.isDatastore(datastorePath)) {
      console.error(`Not a valid Kanecta datastore: ${datastorePath}`);
      rl.close();
      process.exit(1);
    }
    console.log(`\n✓ Using datastore at ${datastorePath}\n`);

  } else if (choice === '3') {
    const zipInput = await ask(rl, 'Path to zip file: ');
    const zipPath = expandHome(zipInput);
    if (!fs.existsSync(zipPath)) {
      console.error(`File not found: ${zipPath}`);
      rl.close();
      process.exit(1);
    }

    const dirInput = await ask(rl, 'Extract to (parent directory) [~/]: ');
    const dir = dirInput || '~/';

    let name;
    while (true) {
      name = await ask(rl, 'Datastore name (letters, numbers, hyphens only) [kanecta]: ') || 'kanecta';
      if (NAME_RE.test(name)) break;
      console.log('  Invalid name. Use letters, numbers, and hyphens only.');
    }

    datastorePath = path.join(expandHome(dir), name);
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
    console.log(`\n✓ Imported datastore to ${datastorePath}\n`);

  } else {
    rl.close();
    console.log('Aborted.');
    process.exit(0);
  }

  const frontendPortInput = await ask(rl, 'Frontend port [9743]: ');
  const studioPort = parseInt(frontendPortInput || '9743', 10);
  const apiPortInput = await ask(rl, `API port [${studioPort + 1}]: `);
  const apiPort = parseInt(apiPortInput || String(studioPort + 1), 10);
  console.log(`  Frontend: ${studioPort}  API: ${apiPort}`);

  rl.close();
  writePointer(datastorePath, apiPort, studioPort);
  return { datastorePath, apiPort, studioPort };
}

async function launch(datastorePath, preferredApiPort, preferredStudioPort) {
  const [apiPort, studioPort] = await Promise.all([
    findFreePort(preferredApiPort),
    findFreePort(preferredStudioPort),
  ]);

  const repoRoot = path.resolve(__dirname, '../..');
  const concurrentlyBin = path.join(repoRoot, 'node_modules', '.bin', 'concurrently');

  console.log(`  API port:    ${apiPort}${apiPort !== preferredApiPort ? ` (${preferredApiPort} was busy)` : ''}`);
  console.log(`  Studio port: ${studioPort}${studioPort !== preferredStudioPort ? ` (${preferredStudioPort} was busy)` : ''}`);

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
    return launch(datastorePath, data.apiPort ?? 9744, data.studioPort ?? 9743);
  }

  // 3. First-run wizard
  if (!process.stdin.isTTY) {
    console.error('No datastore configured. Run npm start to set up.');
    process.exit(1);
  }
  const wizardResult = await wizard();
  checkSpecVersion(wizardResult.datastorePath);
  launch(wizardResult.datastorePath, wizardResult.apiPort, wizardResult.studioPort);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
