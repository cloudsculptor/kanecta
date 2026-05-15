'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

function setupMcpServer() {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') return { ok: false, error: e.message };
  }

  if (!settings.mcpServers) settings.mcpServers = {};

  settings.mcpServers.kanecta = {
    command: 'kanecta',
    args: ['claude', 'mcp'],
    type: 'stdio',
  };

  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
    return { ok: true, file: SETTINGS_PATH };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function removeMcpServer() {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    if (settings.mcpServers) delete settings.mcpServers.kanecta;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  } catch {}
}

module.exports = { setupMcpServer, removeMcpServer, SETTINGS_PATH };
