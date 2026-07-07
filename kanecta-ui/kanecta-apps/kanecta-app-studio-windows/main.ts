import { app, BrowserWindow, dialog } from 'electron';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

/** Parsed shape of ~/.config/kanecta/config.json (only the fields we read). */
interface RemoteSpec { url?: string }
interface WorkspaceSpec { mode?: string; remote?: RemoteSpec }
interface KanectaConfig {
  default?: string;
  workspaces?: Record<string, WorkspaceSpec>;
}

const CONFIG_PATH = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'kanecta',
  'config.json',
);

function readConfig(): KanectaConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as KanectaConfig;
}

// Find the configured remote Studio URL: a workspace with mode "REMOTE"
// and a remote.url, preferring the default workspace if it qualifies.
function findRemoteUrl(config: KanectaConfig): string | null {
  const workspaces = config.workspaces || {};
  const ordered = [config.default, ...Object.keys(workspaces)].filter(Boolean) as string[];
  for (const name of ordered) {
    const workspace = workspaces[name];
    if (workspace?.mode === 'REMOTE' && workspace.remote?.url) {
      return workspace.remote.url;
    }
  }
  return null;
}

function showConfigError(message: string): void {
  dialog.showErrorBox('Kanecta Studio', message);
  app.quit();
}

function createWindow(url: string): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Kanecta Studio',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadURL(url);
}

app.whenReady().then(() => {
  let config: KanectaConfig;
  try {
    config = readConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showConfigError(`Could not read ${CONFIG_PATH}:\n${message}`);
    return;
  }

  const url = findRemoteUrl(config);
  if (!url) {
    showConfigError(
      `No "REMOTE" workspace found in ${CONFIG_PATH}.\n\n`
      + 'Add an entry like:\n'
      + '"remote": { "mode": "REMOTE", "remote": { "url": "http://localhost:9743" } }',
    );
    return;
  }

  createWindow(url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
