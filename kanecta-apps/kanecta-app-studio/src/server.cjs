#!/usr/bin/env node
'use strict';

/**
 * @kanecta/studio launcher
 *
 * Invoked by `kanecta studio`. Does the following:
 *   1. Finds two free TCP ports (API + UI).
 *   2. Spawns @kanecta/api on the API port (KANECTA_PORT env).
 *   3. If dist/ exists, serves it with sirv on the UI port (production mode).
 *      Otherwise, spawns `vite --port <uiPort>` from this package (dev mode).
 *   4. Opens the browser once the UI server is ready.
 *   5. Forwards SIGINT/SIGTERM to child processes and exits cleanly.
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

// ── helpers ────────────────────────────────────────────────────────────────

function findFreePort(preferred) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      // Preferred port taken — let OS pick one.
      const s2 = net.createServer();
      s2.unref();
      s2.on('error', reject);
      s2.listen(0, '127.0.0.1', () => {
        const { port } = s2.address();
        s2.close(() => resolve(port));
      });
    });
    server.listen(preferred, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs = 15_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Port ${port} did not open within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    }
    attempt();
  });
}

function openBrowser(url) {
  const { platform } = process;
  const cmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'start'
    : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
}

function resolvePackageEntry(pkgName) {
  try {
    return require.resolve(pkgName);
  } catch {
    return null;
  }
}

function resolveBin(pkgName, binName) {
  try {
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const binField = pkg.bin;
    const rel = typeof binField === 'string' ? binField : (binField && binField[binName]);
    if (rel) return path.resolve(path.dirname(pkgJsonPath), rel);
  } catch {}
  return null;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const [apiPort, uiPort] = await Promise.all([
    findFreePort(3000),
    findFreePort(5173),
  ]);

  const children = [];

  function cleanup() {
    for (const child of children) {
      try { child.kill(); } catch {}
    }
    process.exit(0);
  }
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // ── spawn API ─────────────────────────────────────────────────────────
  const apiEntry = resolvePackageEntry('@kanecta/api');
  if (!apiEntry) {
    process.stderr.write('kanecta studio: @kanecta/api not found.\n');
    process.stderr.write('Install it: npm install -g @kanecta/api\n');
    process.exit(1);
  }

  const apiProc = spawn(process.execPath, [apiEntry], {
    env: { ...process.env, PORT: String(apiPort) },
    stdio: 'inherit',
  });
  children.push(apiProc);
  apiProc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`kanecta studio: API process exited with code ${code}\n`);
      cleanup();
    }
  });

  process.stdout.write(`kanecta studio: API starting on http://localhost:${apiPort}\n`);
  await waitForPort(apiPort);
  process.stdout.write('kanecta studio: API ready\n');

  // ── serve UI ──────────────────────────────────────────────────────────
  const pkgDir = path.resolve(__dirname, '..');
  const distDir = path.join(pkgDir, 'dist');
  const hasDist = fs.existsSync(path.join(distDir, 'index.html'));

  let uiProc;

  if (hasDist) {
    // Production: serve dist/ with sirv-cli
    const bin = resolveBin('sirv-cli', 'sirv');
    if (!bin) {
      process.stderr.write('kanecta studio: sirv-cli not found. Try reinstalling: npm install -g kanecta\n');
      cleanup();
    }

    uiProc = spawn(
      process.execPath,
      [bin, distDir, '--port', String(uiPort), '--single', '--no-brotli'],
      { stdio: 'inherit', env: { ...process.env, KANECTA_API_URL: `http://localhost:${apiPort}` } },
    );
  } else {
    // Dev: spawn vite
    const viteBin = path.join(pkgDir, 'node_modules', '.bin', 'vite');
    if (!fs.existsSync(viteBin)) {
      process.stderr.write('kanecta studio: neither dist/ nor vite found.\nBuild first: cd $(npm root -g)/@kanecta/studio && npm run build\n');
      cleanup();
    }
    process.stdout.write('kanecta studio: no dist/ found, starting dev server\n');
    uiProc = spawn(
      viteBin,
      ['--port', String(uiPort), '--strictPort'],
      {
        cwd: pkgDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          VITE_KANECTA_API_URL: `http://localhost:${apiPort}`,
        },
      },
    );
  }

  children.push(uiProc);
  uiProc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`kanecta studio: UI process exited with code ${code}\n`);
      cleanup();
    }
  });

  process.stdout.write(`kanecta studio: UI starting on http://localhost:${uiPort}\n`);
  await waitForPort(uiPort, 30_000);

  const url = `http://localhost:${uiPort}`;
  process.stdout.write(`kanecta studio: ready at ${url}\n`);
  openBrowser(url);
}

main().catch((err) => {
  process.stderr.write(`kanecta studio: ${err.message}\n`);
  process.exit(1);
});
