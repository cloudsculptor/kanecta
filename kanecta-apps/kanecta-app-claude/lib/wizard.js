'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { Datastore } = require('@kanecta/cli/lib/datastore');
const { readConfig, writeConfig, KANECTA_DIR, LOCATION_FILE } = require('./config');
const { injectClaudeMd, installSlashCommands, isClaudeInstalled, CLAUDE_MD, COMMANDS_DIR } = require('./claude');
const { setupMcpServer } = require('./mcp-setup');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m',
};

const ok = (msg) => process.stdout.write(`  ${c.green}✓${c.reset} ${msg}\n`);
const warn = (msg) => process.stdout.write(`  ${c.yellow}!${c.reset} ${msg}\n`);
const err = (msg) => process.stdout.write(`  ${c.red}✗${c.reset} ${msg}\n`);
const header = (msg) => process.stdout.write(`\n${c.bold}${msg}${c.reset}\n`);
const info = (msg) => process.stdout.write(`${msg}\n`);

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

function askChoice(rl, choices, defaultVal) {
  return new Promise(resolve => {
    choices.forEach((choice, i) => info(`    ${c.bold}${i + 1}.${c.reset} ${choice}`));
    rl.question(`\n  Choose ${c.dim}[${defaultVal}]${c.reset}: `, answer => {
      const n = parseInt(answer.trim() || String(defaultVal), 10);
      resolve((n >= 1 && n <= choices.length) ? n : parseInt(String(defaultVal), 10));
    });
  });
}

async function runWizard() {
  info('');
  info(`${c.bold}${c.cyan}Welcome to Kanecta${c.reset}`);
  info(`${c.dim}Personal knowledge base for Claude — context that persists across all sessions${c.reset}`);
  info('');

  header('Checking requirements...');

  ok(`Node.js ${process.version}`);

  if (!isClaudeInstalled()) {
    err('Claude CLI not found');
    info('');
    info('  Kanecta integrates with Claude Code. Please install it first:');
    info(`    ${c.cyan}https://claude.ai/code${c.reset}`);
    info('');
    info('  Then run `kanecta` again to complete setup.');
    process.exit(1);
  }
  ok('Claude CLI found');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // ── Datastore location ──────────────────────────────────────────────────
    header('Where should Kanecta store your data?');
    info(`  Default: ${c.cyan}~/.kanecta${c.reset}  (or choose any directory)`);
    const rawPath = await ask(rl, 'Path', '~/.kanecta');
    const datastorePath = rawPath.replace(/^~/, os.homedir());

    // ── Owner ───────────────────────────────────────────────────────────────
    header('Your identity');
    const existingConfig = readConfig();
    const defaultOwner = existingConfig?.owner || process.env.USER || '';
    const owner = await ask(rl, 'Your email or name (used as author on captured items)', defaultOwner);
    if (!owner) { err('Owner is required'); rl.close(); process.exit(1); }

    // ── Capture mode ────────────────────────────────────────────────────────
    header('How should Claude capture context to Kanecta?');
    const modeChoice = await askChoice(rl, [
      `${c.bold}Auto-capture${c.reset} ${c.dim}(recommended)${c.reset} — Claude saves key decisions and insights automatically`,
      `${c.bold}Extended${c.reset} — Also saves Claude's reasoning chains (uses more tokens)`,
      `${c.bold}Ask each session${c.reset} — Claude asks which mode to use at the start of each conversation`,
      `${c.bold}Manual only${c.reset} — You control what gets saved with \`kanecta capture "..."\``,
    ], 1);
    const modes = ['always', 'extended', 'ask-at-start', 'manual'];
    const captureMode = modes[modeChoice - 1];

    // ── Claude integration options ──────────────────────────────────────────
    header('Claude integration');

    info(`  ${c.bold}MCP server${c.reset} ${c.dim}(recommended)${c.reset} — Kanecta appears as tools Claude can call directly.`);
    info(`  This gives the best results: structured data, reliable capture, no guessing.`);
    const doMcp = await askYN(rl, 'Set up Kanecta as an MCP server in Claude?', true);

    info('');
    info(`  ${c.bold}CLAUDE.md instructions${c.reset} — Tells Claude when and what to capture.`);
    info(`  Added to your existing ~/.claude/CLAUDE.md without replacing anything.`);
    const doClaudeMd = await askYN(rl, 'Add Kanecta instructions to ~/.claude/CLAUDE.md?', true);

    info('');
    info(`  ${c.bold}Slash commands${c.reset} — /kanecta-search and /kanecta-capture available in Claude sessions.`);
    const doCommands = await askYN(rl, 'Install Kanecta slash commands?', true);

    // ── Execute setup ────────────────────────────────────────────────────────
    header('Setting up...');

    if (Datastore.isDatastore(datastorePath)) {
      ok(`Datastore already exists at ${datastorePath}`);
    } else {
      fs.mkdirSync(datastorePath, { recursive: true });
      Datastore.init(datastorePath, owner);
      ok(`Datastore created at ${datastorePath}`);
    }

    // Always write ~/.kanecta/location.txt so tools can find the datastore
    const defaultDs = path.join(os.homedir(), '.kanecta');
    if (datastorePath !== defaultDs) {
      fs.mkdirSync(KANECTA_DIR, { recursive: true });
      fs.writeFileSync(LOCATION_FILE, datastorePath + '\n');
      ok(`Location pointer written to ~/.kanecta/location.txt`);
    } else {
      // Ensure ~/.kanecta exists even if it IS the datastore
      fs.mkdirSync(KANECTA_DIR, { recursive: true });
    }

    // Create the captures root item
    const ds = new Datastore(datastorePath);
    let capturesRootId = ds.resolveAlias('kanecta-captures');
    if (!capturesRootId) {
      const root = ds.create({
        value: 'Claude Captures',
        type: 'text',
        owner,
        tags: ['kanecta-internal'],
      });
      ds.setAlias('kanecta-captures', root.id);
      capturesRootId = root.id;
    }
    ok(`Captures root ready`);

    if (doMcp) {
      const mcpResult = setupMcpServer();
      if (mcpResult.ok) ok(`MCP server registered in ${mcpResult.file}`);
      else warn(`Could not set up MCP server: ${mcpResult.error}`);
    }

    if (doClaudeMd) {
      injectClaudeMd(captureMode);
      ok(`Updated ${CLAUDE_MD}`);
    }

    if (doCommands) {
      const n = installSlashCommands();
      ok(`Installed ${n} slash command(s) to ${COMMANDS_DIR}`);
    }

    writeConfig({
      wizardCompleted: true,
      datastorePath,
      owner,
      captureMode,
      capturesRootId,
      lastCaptureDate: null,
      lastCaptureDateId: null,
    });
    ok(`Config saved to ~/.kanecta-config.json`);

    info('');
    info(`${c.bold}${c.green}All done!${c.reset}`);
    info('');
    info(`  ${c.dim}Browse your knowledge base:${c.reset}    kanecta tree`);
    info(`  ${c.dim}Save something now:${c.reset}            kanecta capture "text"`);
    info(`  ${c.dim}Search past context:${c.reset}           kanecta search "query"`);
    info(`  ${c.dim}Show recent captures:${c.reset}          kanecta recent`);
    info('');
    if (doMcp) {
      info(`  ${c.cyan}Restart Claude Code${c.reset} to activate the MCP server.`);
    }
    info(`  Claude will ${captureMode === 'manual' ? 'save context when you ask.' : 'automatically capture important insights.'}`);
    info('');

  } finally {
    rl.close();
  }
}

module.exports = { runWizard };
