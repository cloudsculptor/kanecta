'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

function setupMcpServer() {
  // Try the Claude CLI first — cleanest approach, works for both Claude Code and Claude Desktop
  try {
    execSync('claude mcp add --transport stdio kanecta -- npx -y @kanecta/mcp', { stdio: 'pipe' });
    return { ok: true, method: 'claude-mcp-add' };
  } catch {
    // Fall back to writing settings.json directly if claude CLI isn't available
    return setupMcpServerDirect();
  }
}

function setupMcpServerDirect() {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') return { ok: false, error: e.message };
  }

  if (!settings.mcpServers) settings.mcpServers = {};

  settings.mcpServers.kanecta = {
    command: 'npx',
    args: ['-y', '@kanecta/mcp'],
    type: 'stdio',
  };

  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
    return { ok: true, method: 'settings-json', file: SETTINGS_PATH };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function removeMcpServer() {
  // Try claude CLI first
  try {
    execSync('claude mcp remove kanecta', { stdio: 'pipe' });
    return;
  } catch {}
  // Fall back to editing settings.json
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    if (settings.mcpServers) delete settings.mcpServers.kanecta;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  } catch {}
}

module.exports = { setupMcpServer, removeMcpServer, SETTINGS_PATH };
