#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync, execSync } = require('child_process');
const { startUpdateCheck, runUpdate } = require('./lib/update-check');

const KANECTA_DIR = path.join(os.homedir(), '.kanecta');

const HELP = `
kanecta — personal knowledge base orchestrator

USAGE
  kanecta <app> <command> [options]
  kanecta                           # first-run setup (if not configured)

APPS
  cli <command>     Kanecta datastore CLI (@kanecta/cli)
  claude <command>  Claude Code integration (@kanecta/claude)
  studio            Launch the Kanecta Studio web UI (@kanecta/studio)
  update            Update all installed kanecta packages

EXAMPLES
  kanecta studio
  kanecta update
  kanecta claude wizard
  kanecta claude capture "decided to use PostgreSQL" --tag decision
  kanecta claude search "postgres"
  kanecta claude status
  kanecta cli tree
  kanecta cli get <id>

Run \`kanecta <app> --help\` for app-specific commands.
`.trimStart();

function die(msg) {
  process.stderr.write(`kanecta: ${msg}\n`);
  process.exit(1);
}

// Resolve a package entry point via global npm root, then fall back to local node_modules
function resolvePackage(pkgName) {
  // Try local node_modules first (handles dev/monorepo setups)
  try {
    return require.resolve(pkgName);
  } catch {}

  // Try global npm root
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const pkgMain = require(path.join(globalRoot, pkgName, 'package.json')).main || 'index.js';
    const entry = path.join(globalRoot, pkgName, pkgMain);
    if (fs.existsSync(entry)) return entry;
  } catch {}

  return null;
}

function runApp(entry, args) {
  const result = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

function isFirstRun() {
  return !fs.existsSync(KANECTA_DIR);
}

async function main() {
  const argv = process.argv.slice(2);

  // Start background update check immediately — won't block anything
  const flushUpdates = startUpdateCheck();

  if (argv.length === 0) {
    if (isFirstRun()) {
      const { runSetup } = require('./lib/setup');
      await runSetup();
      await flushUpdates();
      return;
    }
    process.stdout.write(HELP);
    await flushUpdates();
    process.exit(0);
  }

  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    process.stdout.write(HELP);
    await flushUpdates();
    process.exit(0);
  }

  const app = argv[0];
  const rest = argv.slice(1);

  switch (app) {
    case 'update': {
      await runUpdate();
      process.exit(0);
      break;
    }
    case 'cli': {
      const entry = resolvePackage('@kanecta/cli');
      if (!entry) die('@kanecta/cli not found. Try: npm install -g @kanecta/cli');
      // For long-running subprocesses (studio) we skip the update notification
      // to avoid interleaving output. For short commands (cli/claude) we flush after.
      runApp(entry, rest);
      break;
    }
    case 'claude': {
      const entry = resolvePackage('@kanecta/claude');
      if (!entry) die('@kanecta/claude is not installed.\nRun `kanecta` to run first-time setup, or install manually: npm install -g @kanecta/claude');
      runApp(entry, rest);
      break;
    }
    case 'studio': {
      const entry = resolvePackage('@kanecta/studio/server');
      if (!entry) die('@kanecta/studio is not installed.\nTry reinstalling: npm install -g kanecta');
      // Print update notification before handing off to the long-running studio process
      await flushUpdates();
      runApp(entry, rest);
      break;
    }
    default:
      die(`Unknown app: ${app}\nRun \`kanecta --help\` for usage.`);
  }
}

main().catch(err => {
  process.stderr.write(`kanecta: ${err.message}\n`);
  process.exit(1);
});
