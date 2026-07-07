import { app, BrowserWindow, dialog } from 'electron';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

/** Parsed shape of ~/.config/kanecta/config.json (only the fields we read). */
interface RemoteSpec { url?: string }
interface WorkspaceSpec { mode?: string; remote?: RemoteSpec }
interface KanectaConfig {
  studioUrl?: string;
  default?: string;
  defaultWorkspace?: string;
  workspaces?: Record<string, WorkspaceSpec>;
}

const CONFIG_PATH = path.join(
  process.env.KANECTA_CONFIG
    ? (process.env.KANECTA_CONFIG.endsWith('.json') ? path.dirname(process.env.KANECTA_CONFIG) : process.env.KANECTA_CONFIG)
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'kanecta'),
  'config.json',
);

const DEV_DEFAULT_URL = 'http://localhost:9743';

function readConfigSafe(): KanectaConfig | null {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as KanectaConfig; }
  catch { return null; }
}

// Resolve the Studio web URL to load, in priority order:
//   1. KANECTA_STUDIO_URL env var        — the dev override (points at the local
//      `npm start` dev server, or any deployment).
//   2. config.studioUrl                  — an explicit URL in config.json.
//   3. legacy REMOTE workspace remote.url — back-compat with the old format.
//   4. http://localhost:9743             — zero-config dev default.
function resolveStudioUrl(): string {
  if (process.env.KANECTA_STUDIO_URL) return process.env.KANECTA_STUDIO_URL;

  const config = readConfigSafe();
  if (config) {
    if (typeof config.studioUrl === 'string') return config.studioUrl;

    // Legacy: first workspace with mode REMOTE + remote.url (default first).
    const workspaces = config.workspaces || {};
    const ordered = [config.default, config.defaultWorkspace, ...Object.keys(workspaces)].filter(Boolean) as string[];
    for (const name of ordered) {
      const ws = workspaces[name];
      if (ws?.mode === 'REMOTE' && ws.remote?.url) return ws.remote.url;
    }
  }

  return DEV_DEFAULT_URL;
}

function createWindow(url: string): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Kanecta Studio',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      // Required so Studio views can host <webview> panes (the tiling web view).
      webviewTag: true,
    },
  });

  // Dev shortcuts: reload (Ctrl/Cmd+R) and devtools (F12 / Ctrl+Shift+I).
  win.webContents.on('before-input-event', (event, input) => {
    const mod = input.control || input.meta;
    if (mod && input.key.toLowerCase() === 'r') { win.webContents.reload(); event.preventDefault(); }
    else if (input.key === 'F12' || (mod && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools(); event.preventDefault();
    }
  });

  // Retry the load until the target is reachable — so the app can be launched
  // before (or alongside) the dev server without failing.
  loadWithRetry(win, url, 0);
}

function loadWithRetry(win: BrowserWindow, url: string, attempt: number): void {
  if (win.isDestroyed()) return;
  win.loadURL(url).catch(() => {
    if (attempt < 60) {
      setTimeout(() => loadWithRetry(win, url, attempt + 1), 1000);
    } else {
      dialog.showErrorBox(
        'Kanecta Studio',
        `Couldn't reach ${url} after 60s.\n\n`
        + 'Start the dev server first (from the repo root):\n  npm start\n\n'
        + 'Or set KANECTA_STUDIO_URL / config.json "studioUrl" to a reachable Studio.',
      );
    }
  });
}

app.whenReady().then(() => {
  const url = resolveStudioUrl();
  createWindow(url);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
