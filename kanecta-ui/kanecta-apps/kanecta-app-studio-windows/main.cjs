'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CONFIG_PATH = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'kanecta',
  'config.json',
);

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// Find the configured remote Studio URL: a workspace with mode "REMOTE"
// and a remote.url, preferring the default workspace if it qualifies.
function findRemoteUrl(config) {
  const workspaces = config.workspaces || {};
  const ordered = [config.default, ...Object.keys(workspaces)].filter(Boolean);
  for (const name of ordered) {
    const workspace = workspaces[name];
    if (workspace?.mode === 'REMOTE' && workspace.remote?.url) {
      return workspace.remote.url;
    }
  }
  return null;
}

function showConfigError(message) {
  dialog.showErrorBox('Kanecta Studio', message);
  app.quit();
}

function createWindow(url) {
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
  let config;
  try {
    config = readConfig();
  } catch (err) {
    showConfigError(`Could not read ${CONFIG_PATH}:\n${err.message}`);
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
