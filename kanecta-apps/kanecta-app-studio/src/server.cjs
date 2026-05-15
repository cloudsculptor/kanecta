#!/usr/bin/env node
'use strict';

/**
 * @kanecta/studio launcher
 *
 * Invoked by `kanecta studio`. Does the following:
 *   1. Finds two free TCP ports (API + UI).
 *   2. Spawns @kanecta/api on the API port.
 *   3. If dist/ exists, starts an inline HTTP server that:
 *        - Proxies /api/* requests to the API (strips the /api prefix)
 *        - Serves dist/ as a single-page app for everything else
 *      Otherwise, spawns `vite` in dev mode.
 *   4. Opens the browser once the UI server is ready.
 *   5. Forwards SIGINT/SIGTERM to child processes and exits cleanly.
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

// ── helpers ────────────────────────────────────────────────────────────────

function findFreePort(preferred) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
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

// Proxy a request to the API server, stripping the /api prefix.
function proxyToApi(req, res, targetPort) {
  const targetPath = req.url.replace(/^\/api/, '') || '/';
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: targetPort,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${targetPort}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );
  req.pipe(proxyReq, { end: true });
  proxyReq.on('error', () => {
    if (!res.headersSent) { res.writeHead(502); res.end('Bad Gateway'); }
  });
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const [apiPort, uiPort] = await Promise.all([
    findFreePort(3000),
    findFreePort(5173),
  ]);

  const childProcs = [];
  let uiServer = null;

  function cleanup() {
    for (const child of childProcs) {
      try { child.kill(); } catch {}
    }
    if (uiServer) try { uiServer.close(); } catch {}
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

  const defaultDatastore = path.join(os.homedir(), '.kanecta', 'datastore');
  const datastorePath = process.env.KANECTA_DATASTORE ?? defaultDatastore;

  const apiProc = spawn(process.execPath, [apiEntry], {
    env: { ...process.env, PORT: String(apiPort), KANECTA_DATASTORE: datastorePath },
    stdio: 'inherit',
  });
  childProcs.push(apiProc);
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

  if (hasDist) {
    // Production: inline server — /api/* proxied to API, static files for everything else.
    const sirvEntry = resolvePackageEntry('sirv');
    if (!sirvEntry) {
      process.stderr.write('kanecta studio: sirv not found. Try reinstalling: npm install -g kanecta\n');
      cleanup(); return;
    }
    const sirvHandler = require('sirv')(distDir, { single: true, brotli: false });

    uiServer = http.createServer((req, res) => {
      if (req.url?.startsWith('/api')) {
        proxyToApi(req, res, apiPort);
      } else {
        sirvHandler(req, res, () => { res.statusCode = 404; res.end('Not found'); });
      }
    });
    uiServer.on('error', (err) => {
      process.stderr.write(`kanecta studio: UI server error: ${err.message}\n`);
      cleanup();
    });
    await new Promise((resolve) => uiServer.listen(uiPort, '127.0.0.1', resolve));
  } else {
    // Dev: spawn vite. KANECTA_API_URL (no VITE_ prefix) sets the vite proxy target
    // without baking the URL into the client bundle.
    const viteBin = path.join(pkgDir, 'node_modules', '.bin', 'vite');
    if (!fs.existsSync(viteBin)) {
      process.stderr.write('kanecta studio: neither dist/ nor vite found.\nBuild first: cd $(npm root -g)/@kanecta/studio && npm run build\n');
      cleanup(); return;
    }
    process.stdout.write('kanecta studio: no dist/ found, starting dev server\n');
    const uiProc = spawn(
      viteBin,
      ['--port', String(uiPort), '--strictPort'],
      {
        cwd: pkgDir,
        stdio: 'inherit',
        env: { ...process.env, KANECTA_API_URL: `http://localhost:${apiPort}` },
      },
    );
    childProcs.push(uiProc);
    uiProc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        process.stderr.write(`kanecta studio: UI process exited with code ${code}\n`);
        cleanup();
      }
    });
    await waitForPort(uiPort, 30_000);
  }

  const url = `http://localhost:${uiPort}`;
  process.stdout.write(`kanecta studio: ready at ${url}\n`);
  openBrowser(url);
}

main().catch((err) => {
  process.stderr.write(`kanecta studio: ${err.message}\n`);
  process.exit(1);
});
