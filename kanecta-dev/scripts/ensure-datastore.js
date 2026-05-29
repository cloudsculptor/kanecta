#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync, spawn } = require('child_process');
const { Datastore, ROOT_ID } = require('@kanecta/lib');

const HOME = os.homedir();
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');

const POINTER_LOCATIONS = [
  path.join(XDG_CONFIG, 'kanecta', 'config.json'),
  path.join(HOME, '.kanecta', 'config.json'),
];

const NAME_RE = /^[a-zA-Z0-9-]+$/;

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

function writePointer(datastorePath) {
  const file = POINTER_LOCATIONS[0];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = readPointer(file) || { default: null, datastores: [] };
  if (!data.datastores.includes(datastorePath)) {
    data.datastores.push(datastorePath);
  }
  data.default = datastorePath;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`✓ Config saved to ${file}`);
}

function resolveFromEnv() {
  const p = process.env.KANECTA_DATASTORE;
  return p && Datastore.isDatastore(p) ? p : null;
}

function resolveFromPointers() {
  for (const file of POINTER_LOCATIONS) {
    const data = readPointer(file);
    if (!data) continue;
    if (data.datastores.length === 0) continue;
    return { file, data };
  }
  return null;
}

function checkSpecVersion(datastorePath) {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(datastorePath, 'config', 'config.json'), 'utf8'),
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
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

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
    const dir = await ask(rl, 'Parent directory: ');
    if (!dir) { console.error('Directory required.'); rl.close(); process.exit(1); }

    let name;
    while (true) {
      name = await ask(rl, 'Datastore name (letters, numbers, hyphens only): ');
      if (NAME_RE.test(name)) break;
      console.log('  Invalid name. Use letters, numbers, and hyphens only.');
    }

    const rootNode = await ask(rl, 'Root node name (e.g. your name or organisation): ');
    if (!rootNode) { console.error('Root node name required.'); rl.close(); process.exit(1); }

    const email = await ask(rl, 'Owner email: ');
    if (!email) { console.error('Email required.'); rl.close(); process.exit(1); }

    datastorePath = path.join(expandHome(dir), name);
    fs.mkdirSync(datastorePath, { recursive: true });
    const ds = Datastore.init(datastorePath, email);
    ds.update(ROOT_ID, { value: rootNode }, email);
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

    const dir = await ask(rl, 'Extract to (parent directory): ');
    if (!dir) { console.error('Directory required.'); rl.close(); process.exit(1); }

    let name;
    while (true) {
      name = await ask(rl, 'Datastore name (letters, numbers, hyphens only): ');
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

  rl.close();
  writePointer(datastorePath);
  return datastorePath;
}

function launch(datastorePath) {
  const repoRoot = path.resolve(__dirname, '../..');
  const concurrentlyBin = path.join(repoRoot, 'node_modules', '.bin', 'concurrently');

  const proc = spawn(
    concurrentlyBin,
    [
      '-n', 'api,studio',
      '-c', 'cyan,magenta',
      '--kill-others-on-fail',
      'npm run dev -w kanecta-api',
      'npm run dev -w kanecta-apps/kanecta-app-studio',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, KANECTA_DATASTORE: datastorePath },
      stdio: 'inherit',
    },
  );

  proc.on('exit', (code) => process.exit(code ?? 0));
}

async function main() {
  // 1. Explicit env override
  let datastorePath = resolveFromEnv();
  if (datastorePath) {
    console.log(`✓ Datastore: ${datastorePath}`);
    checkSpecVersion(datastorePath);
    return launch(datastorePath);
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
    return launch(datastorePath);
  }

  // 3. First-run wizard
  if (!process.stdin.isTTY) {
    console.error('No datastore configured. Run npm start to set up.');
    process.exit(1);
  }
  datastorePath = await wizard();
  checkSpecVersion(datastorePath);
  launch(datastorePath);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
