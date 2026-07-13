#!/usr/bin/env -S node --import tsx
'use strict';

import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import * as readline from 'readline';
import { execSync, spawn } from 'child_process';
import { Datastore, getConfigPath } from '@kanecta/lib';

const HOME = os.homedir();
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');

// Discovery honours KANECTA_CONFIG first (a dir or a .json path, resolved by the
// shared lib resolver), then the platform defaults — the same order every other
// entry point uses.
const POINTER_LOCATIONS = [
  ...(() => { try { return [getConfigPath()]; } catch { return []; } })(),
  path.join(XDG_CONFIG, 'kanecta', 'config.json'),
  path.join(HOME, '.kanecta', 'config.json'),
].filter((p, i, a) => a.indexOf(p) === i);

const NAME_RE = /^[a-zA-Z0-9-]+$/;

function checkPointerFileFormat(data: any, sourceFile: string) {
  const errors: string[] = [];
  // Accept current (workingSets/defaultWorkingSet) and legacy (workspaces/defaultWorkspace) keys.
  if (!data.workspaces && data.workingSets) data.workspaces = data.workingSets;
  if (!data.defaultWorkspace && data.defaultWorkingSet) data.defaultWorkspace = data.defaultWorkingSet;
  if (!data.specVersion) errors.push('missing required field "specVersion"');
  if (!data.defaultWorkspace) errors.push('missing required field "defaultWorkingSet"');
  if (typeof data.workspaces !== 'object' || data.workspaces === null || Array.isArray(data.workspaces))
    errors.push('"workspaces" must be an object');
  else if (Object.keys(data.workspaces).length === 0)
    errors.push('"workspaces" must have at least one entry');
  else {
    for (const [name, ws] of Object.entries(data.workspaces) as [string, any][]) {
      if (typeof ws !== 'object' || ws === null || Array.isArray(ws))
        errors.push(`"workspaces.${name}" must be an object`);
      else if (typeof ws.local !== 'string')
        errors.push(`"workspaces.${name}.local" must be a string path`);
    }
  }
  if (errors.length > 0) {
    console.error(`\n  ✗ Config file is invalid (${sourceFile}):`);
    errors.forEach(e => console.error(`    - ${e}`));
    console.error(`  Fix ${sourceFile} and try again.\n`);
    process.exit(1);
  }
  console.log(`  ✓ config format OK (${data.specVersion}; ${Object.keys(data.workspaces).length} workspace(s))`);
}

function checkPortFree(port: number) {
  return new Promise<boolean>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function expandHome(p: string) {
  return p.replace(/^~/, HOME);
}

// Migrates the old { default, datastores: [...] } + separate cloud.json shape
// into the merged { default, workspaces: { name -> { mode, datastore?, cloud? } } }
// shape. Runs automatically the first time the old shape is detected — backs up
// both old files (with a `.pre-workspace-refactor` suffix) and removes cloud.json
// (its contents now live inside the matching workspace's `cloud` block).
function migrateOldConfig(file: string, oldData: any) {
  console.log(`\n  → Migrating ${file} to the workspace-based config format...`);

  const cloudFile = path.join(XDG_CONFIG, 'kanecta', 'cloud.json');
  const backupConfigFile = `${file}.pre-workspace-refactor`;
  const backupCloudFile = `${cloudFile}.pre-workspace-refactor`;

  fs.copyFileSync(file, backupConfigFile);
  console.log(`    backed up ${file} → ${backupConfigFile}`);

  const workspaces: Record<string, any> = {};
  const usedNames = new Set<string>();
  const uniqueName = (base: string) => {
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
  };

  fs.writeFileSync(file, JSON.stringify(newData, null, 2) + '\n', 'utf8');
  if (fs.existsSync(cloudFile)) fs.unlinkSync(cloudFile);

  console.log(`  ✓ Migrated — workspaces: ${Object.keys(workspaces).join(', ')} (default: ${defaultName})`);
  console.log(`    ${cloudFile} removed (now redundant — its config lives in the workspace's \`cloud\` block)\n`);

  return newData;
}

// Normalises a workspace entry from either config format into:
//   { localPath, branch, remotes }
function normaliseWorkspace(ws: any) {
  if (!ws) return null;
  // 1.4.0 format: { local, remotes?, branch? }
  if (ws.local !== undefined) {
    const localPath = typeof ws.local === 'string' ? ws.local : ws.local?.path;
    return { localPath: expandHome(localPath), branch: ws.branch ?? 'main', remotes: ws.remotes ?? {} };
  }
  // 1.3.x format: { mode, datastore?, cloud? }
  if (ws.mode === 'FILESYSTEM') {
    return { localPath: expandHome(ws.datastore), branch: 'main', remotes: {} };
  }
  return null;
}

function readPointer(file: string): any {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Accept current (workingSets/defaultWorkingSet) and legacy (workspaces/defaultWorkspace) keys.
    if (!data.workspaces && data.workingSets) data.workspaces = data.workingSets;
    if (!data.defaultWorkspace && data.defaultWorkingSet) data.defaultWorkspace = data.defaultWorkingSet;
    // 1.4.0 format: specVersion + defaultWorkingSet
    if (data.specVersion && data.defaultWorkspace && typeof data.workspaces === 'object') {
      return { format: '1.4.0', specVersion: data.specVersion, defaultWorkspace: data.defaultWorkspace, default: data.defaultWorkspace, workspaces: data.workspaces, studioPort: data.studioPort ?? 9743, apiPort: data.apiPort ?? 9744 };
    }
    // 1.3.x format: default + workspaces map
    if (data.default && data.workspaces && typeof data.workspaces === 'object' && !Array.isArray(data.workspaces)) {
      return { format: '1.3.x', ...data };
    }
    if (data.default && Array.isArray(data.datastores)) return migrateOldConfig(file, data);
  } catch {}
  return null;
}

// Convert the wizard's internal `workspace` shape into a 1.4.0 working-set entry.
// Filesystem → { local, defaultBranch } (schema-valid). Cloud keeps the legacy
// { mode:'CLOUD', cloud } shape, which Datastore.openWorkingSet still accepts.
function toWorkingSet(workspace: any) {
  if (workspace.mode === 'FILESYSTEM') return { local: workspace.datastore, defaultBranch: 'main' };
  if (workspace.mode === 'CLOUD')      return { mode: 'CLOUD', cloud: workspace.cloud, defaultBranch: 'main' };
  return { ...workspace, defaultBranch: workspace.defaultBranch || workspace.branch || 'main' };
}

function writePointer(name: string, workspace: any, apiPort: number, studioPort: number) {
  const file = POINTER_LOCATIONS[0];
  const isNew = !fs.existsSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // Load existing config in the canonical 1.4.0 shape (tolerating legacy keys).
  let raw: any = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const workingSets = raw.workingSets || raw.workspaces || {};

  const data: any = {
    specVersion: raw.specVersion || '1.4.0',
    defaultWorkingSet: name,
    workingSets,
    studioPort,
    apiPort,
  };
  data.workingSets[name] = toWorkingSet(workspace);

  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  if (isNew) {
    console.log(`  → Writing ${file}`);
    console.log(`    (config — records your working sets so npm start can find them next time)`);
  } else {
    console.log(`  → Updated ${file}`);
  }
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

function checkSpecVersion(datastorePath: string, branch = 'main') {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
  );
  const expectedVersion = rootPkg.version;

  // 1.4.0: datastore config lives in the root item's payload, in the active
  // branch's items tree (branches/<branch>/items/00/00/<root>/item.json).
  const ROOT = '00000000-0000-0000-0000-000000000000';
  const enc = branch.replace(/\//g, '__');
  const rootItem = path.join(datastorePath, '.kanecta', 'branches', enc, 'items', '00', '00', ROOT, 'item.json');
  if (!fs.existsSync(rootItem)) {
    console.log(`  spec version check: skipped (root item not found at ${rootItem})`);
    return;
  }

  let datastoreVersion = '(not set)';
  try {
    const doc = JSON.parse(fs.readFileSync(rootItem, 'utf8'));
    datastoreVersion = doc.payload?.specVersion ?? doc.meta?.specVersion ?? '(not set)';
  } catch {
    console.log('  spec version check: skipped (could not read root item)');
    return;
  }

  if (datastoreVersion === expectedVersion) {
    console.log(`  spec version check: ✓ ${datastoreVersion}`);
  } else {
    console.error(
      `\n  spec version check: ✗ datastore specVersion (${datastoreVersion}) does not match expected (${expectedVersion})\n` +
      `  Check kanecta-specification/kanecta-migrations for migration notes.\n`,
    );
    process.exit(1);
  }
}

function pathCompleter(line: string) {
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

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

async function pickWorkspace(names: string[]) {
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

async function wizard(): Promise<any> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, completer: pathCompleter });

  console.log('\n┌──────────────────────────────────────────┐');
  console.log('│         Kanecta — First Run Setup        │');
  console.log('└──────────────────────────────────────────┘\n');
  console.log('No datastore configured. How would you like to proceed?\n');
  console.log('  1. Create a new datastore (filesystem + SQLite)');
  console.log('  2. Create a new datastore (filesystem)');
  console.log('  3. Use an existing filesystem datastore');
  console.log('  4. Import from a zip file');
  console.log('  5. Connect to a Postgres + S3 cloud datastore');
  console.log('  6. Exit\n');

  const choice = await ask(rl, 'Choice [1-6]: ');

  // ── Collect all inputs before doing anything ──────────────────────────────

  let datastorePath;
  let zipPath = null;
  let owner = null;
  let cloudConfig: any = null;
  let isNewCloudDb = false;
  let mode; // 'create-sqlite' | 'create' | 'existing' | 'zip' | 'cloud'

  if (choice === '5') {
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

  } else if (choice === '6') {
    rl.close();
    console.log('Aborted.');
    process.exit(0);

  } else if (choice === '1') {
    mode = 'create-sqlite';
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

  } else if (choice === '3') {
    mode = 'existing';
    const dir = await ask(rl, 'Path to datastore: ');
    datastorePath = expandHome(dir);
    if (!Datastore.isDatastore(datastorePath)) {
      console.error(`Not a valid Kanecta datastore: ${datastorePath}`);
      rl.close();
      process.exit(1);
    }

  } else if (choice === '4') {
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

  // ── Summary + confirmation ─────────────────────────────────────────────────

  const summary = {
    workspace: workspaceName,
    datastore: datastorePath,
    ...(owner ? { owner } : {}),
    ...(zipPath ? { importFrom: zipPath } : {}),
    frontendPort: studioPort,
    apiPort,
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
    : mode === 'create-sqlite'
    ? `create datastore (filesystem + SQLite) at ${datastorePath}`
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
    writePointer(workspaceName, workspace, apiPort, studioPort);
    return { name: workspaceName, workspace, apiPort, studioPort };

  } else if (mode === 'create-sqlite') {
    fs.mkdirSync(datastorePath, { recursive: true });
    Datastore.init(datastorePath, owner); // TODO: replace with SQLiteFilesystemAdapter init
    console.log(`\n✓ Created datastore (filesystem + SQLite) at ${datastorePath}`);

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
  writePointer(workspaceName, workspace, apiPort, studioPort);
  return { name: workspaceName, workspace, apiPort, studioPort };
}


// `workspaceName` is null when launched via an explicit env override (no named
// working set involved); `datastorePath` is null for pure-cloud working sets.
// `configFile` is the config.json the API/Studio should resolve from.
async function launch(workspaceName: string | null, datastorePath: string | null, apiPort: number, studioPort: number, branch: string | null, configFile: string) {
  const [apiFree, studioFree] = await Promise.all([
    checkPortFree(apiPort),
    checkPortFree(studioPort),
  ]);

  function portError(label: string, port: number, configKey: string) {
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
      'npm run dev -w @kanecta/api',
      `npm run dev -w @kanecta/studio -- --port ${studioPort} --strictPort`,
    ],
    {
      cwd: repoRoot,
      env: (() => {
        // Build the child env on the new contract: the API/Studio resolve the
        // datastore from config.json via KANECTA_CONFIG, select the working set
        // with KANECTA_WORKING_SET, and the branch with KANECTA_BRANCH. The
        // legacy KANECTA_DATASTORE/KANECTA_WORKSPACE vars are removed so a stale
        // value in the parent shell can't leak in (the API ignores them anyway).
        const e = { ...process.env };
        delete e.KANECTA_DATASTORE;
        delete e.KANECTA_WORKSPACE;
        delete e.KANECTA_BRANCH;
        delete e.KANECTA_WORKING_SET;
        if (configFile)    e.KANECTA_CONFIG = configFile;
        if (workspaceName) e.KANECTA_WORKING_SET = workspaceName;
        if (branch)        e.KANECTA_BRANCH = branch;
        e.PORT = String(apiPort);
        e.KANECTA_API_URL = `http://localhost:${apiPort}`;
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

  // Datastore selection comes from config.json (the new single source of truth,
  // located via KANECTA_CONFIG or the platform default). The legacy
  // KANECTA_DATASTORE env override has been removed — point KANECTA_CONFIG at a
  // different config.json to switch datastores.
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

    const norm = normaliseWorkspace(workspace);
    if (!norm) {
      // CLOUD-only workspace (old format mode: CLOUD) — no local path
      console.log(`✓ Working set: ${name} (${selectionReason}; cloud)`);
      return launch(name, null, data.apiPort ?? 9744, data.studioPort ?? 9743, null, pointerFile);
    }
    if (!Datastore.isDatastore(norm.localPath)) {
      console.error(`Datastore not found at configured path: ${norm.localPath}`);
      process.exit(1);
    }
    console.log(`✓ Working set: ${name} (${selectionReason}; ${norm.localPath}; branch: ${norm.branch})`);
    checkSpecVersion(norm.localPath, norm.branch);

    return launch(name, norm.localPath, data.apiPort ?? 9744, data.studioPort ?? 9743, norm.branch, pointerFile);
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
  }
  launch(wizardResult.name, workspace.datastore ?? null, wizardResult.apiPort, wizardResult.studioPort, 'main', POINTER_LOCATIONS[0]);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
