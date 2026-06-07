'use strict';

const vscode = require('vscode');
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

// The Studio frontend's URL is derived from `studioPort` in the pointer file —
// the same port `npm start` (kanecta-dev/scripts/ensure-datastore.js) serves it
// on. The API is the user's responsibility to run; we only need to know where
// the frontend lives.
function studioUrl(config) {
  const port = config.studioPort ?? 9743;
  return `http://localhost:${port}`;
}

function htmlFor(url) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:*; style-src 'unsafe-inline';" />
  <style>
    html, body, iframe { margin: 0; padding: 0; width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  <iframe src="${url}" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`;
}

let panel;

function openStudio() {
  let config;
  try {
    config = readConfig();
  } catch (err) {
    vscode.window.showErrorMessage(
      `Kanecta Studio: could not read ${CONFIG_PATH} (${err.message}). `
      + 'Run "npm start" in the kanecta repo to set up a workspace, then try again.',
    );
    return;
  }

  const url = studioUrl(config);

  if (panel) {
    panel.webview.html = htmlFor(url);
    panel.reveal(vscode.ViewColumn.Active);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'kanectaStudio',
    'Kanecta Studio',
    vscode.ViewColumn.Active,
    { enableScripts: false, retainContextWhenHidden: true },
  );
  panel.iconPath = vscode.Uri.file(path.join(__dirname, 'build', 'icon.png'));
  panel.webview.html = htmlFor(url);
  panel.onDidDispose(() => { panel = undefined; });
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('kanecta-studio.open', openStudio),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
