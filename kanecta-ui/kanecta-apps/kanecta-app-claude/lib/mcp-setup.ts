import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

export const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

export function setupMcpServer(): { ok: boolean; method?: string; file?: string; error?: string } {
  // Try the Claude CLI first — cleanest approach, works for both Claude Code and Claude Desktop
  try {
    execSync('claude mcp add --transport stdio kanecta -- npx -y @kanecta/mcp', { stdio: 'pipe' });
    return { ok: true, method: 'claude-mcp-add' };
  } catch {
    // Fall back to writing settings.json directly if claude CLI isn't available
    return setupMcpServerDirect();
  }
}

function setupMcpServerDirect(): { ok: boolean; method?: string; file?: string; error?: string } {
  let settings: any = {};
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e: any) {
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
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export function removeMcpServer(): void {
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
