'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync, spawnSync } = require('child_process');

const KANECTA_DIR = path.join(os.homedir(), '.kanecta');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m',
};

const ok   = (msg) => process.stdout.write(`  ${c.green}✓${c.reset} ${msg}\n`);
const warn = (msg) => process.stdout.write(`  ${c.yellow}!${c.reset} ${msg}\n`);
const info = (msg) => process.stdout.write(`${msg}\n`);
const header = (msg) => process.stdout.write(`\n${c.bold}${msg}${c.reset}\n`);

function ask(rl, question, defaultVal) {
  return new Promise(resolve => {
    const hint = defaultVal ? ` ${c.dim}[${defaultVal}]${c.reset}` : '';
    rl.question(`  ${question}${hint}: `, answer => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function askYN(rl, question, defaultY = true) {
  return new Promise(resolve => {
    const hint = defaultY ? 'Y/n' : 'y/N';
    rl.question(`  ${question} ${c.dim}(${hint})${c.reset}: `, answer => {
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defaultY);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

function tryInstallGlobal(pkg) {
  info(`\n  Installing ${c.cyan}${pkg}${c.reset}...`);
  try {
    execSync(`npm install -g ${pkg}`, { stdio: 'inherit' });
    return true;
  } catch {
    warn(`Could not install ${pkg} automatically.`);
    info(`  Install it manually: ${c.cyan}npm install -g ${pkg}${c.reset}`);
    return false;
  }
}

function resolvePackage(pkgName) {
  try {
    return require.resolve(pkgName);
  } catch {}
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const pkgMain = require(path.join(globalRoot, pkgName, 'package.json')).main || 'index.js';
    const entry = path.join(globalRoot, pkgName, pkgMain);
    if (fs.existsSync(entry)) return entry;
  } catch {}
  return null;
}

async function runSetup() {
  info('');
  info(`${c.bold}${c.cyan}Welcome to Kanecta${c.reset}`);
  info(`${c.dim}Personal knowledge base — context that persists across all your tools and sessions${c.reset}`);
  info('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    header('Available apps');
    info(`  ${c.bold}@kanecta/cli${c.reset}    ${c.dim}(included)${c.reset}   Datastore CLI — browse, search, and manage your knowledge base`);
    info(`  ${c.bold}@kanecta/claude${c.reset} ${c.dim}(optional)${c.reset}   Claude Code integration — automatic capture, MCP server, slash commands`);

    header('Setup');

    const installClaude = await askYN(rl, 'Install Claude Code integration (@kanecta/claude)?', true);

    // Ensure ~/.kanecta exists — marks setup as started
    fs.mkdirSync(KANECTA_DIR, { recursive: true });
    ok(`Created ${KANECTA_DIR}`);

    if (installClaude) {
      const installed = tryInstallGlobal('@kanecta/claude');
      if (installed) {
        ok('@kanecta/claude installed');
        info('');

        // Run the Claude app's own wizard
        const entry = resolvePackage('@kanecta/claude');
        if (entry) {
          info(`  Running Claude setup wizard...\n`);
          const result = spawnSync(process.execPath, [entry, 'wizard'], { stdio: 'inherit' });
          if (result.status !== 0) {
            warn('Claude wizard did not complete. Run `kanecta claude wizard` to finish setup.');
          }
        } else {
          warn('Could not find @kanecta/claude after install. Run `kanecta claude wizard` to finish setup.');
        }
      }
    }

    info('');
    info(`${c.bold}${c.green}Kanecta is ready.${c.reset}`);
    info('');
    info(`  ${c.dim}Datastore commands:${c.reset}   kanecta cli --help`);
    if (installClaude) {
      info(`  ${c.dim}Claude commands:${c.reset}      kanecta claude --help`);
    }
    info('');

  } finally {
    rl.close();
  }
}

module.exports = { runSetup };
