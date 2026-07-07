import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

/** The parsed shape of ~/.config/kanecta/config.json that this extension reads. */
interface KanectaConfig {
  /** Port the Studio frontend is served on (see kanecta-dev ensure-datastore). */
  studioPort?: number;
}

// Mirror @kanecta/lib's config discovery: KANECTA_CONFIG (a directory, or a direct
// .json path) wins, else the platform default. (Inlined — the extension is
// standalone and doesn't bundle @kanecta/lib.)
function getConfigPath(): string {
  const override = process.env.KANECTA_CONFIG;
  if (override) {
    return override.toLowerCase().endsWith('.json') ? override : path.join(override, 'config.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'kanecta', 'config.json');
}
const CONFIG_PATH = getConfigPath();

function readConfig(): KanectaConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as KanectaConfig;
}

// The Studio frontend's URL is derived from `studioPort` in the pointer file —
// the same port `npm start` (kanecta-dev/scripts/ensure-datastore.ts) serves it
// on. The API is the user's responsibility to run; we only need to know where
// the frontend lives.
function studioUrl(config: KanectaConfig): string {
  const port = config.studioPort ?? 9743;
  return `http://localhost:${port}`;
}

function htmlFor(url: string): string {
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

let panel: vscode.WebviewPanel | undefined;

function openStudio(): void {
  let config: KanectaConfig;
  try {
    config = readConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `Kanecta Studio: could not read ${CONFIG_PATH} (${message}). `
      + 'Run "npm start" in the kanecta repo to set up a working set, then try again.',
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

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('kanecta-studio.open', openStudio),
  );
}

export function deactivate(): void {}
