#!/usr/bin/env node

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

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as http from 'node:http';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';

// ── helpers ────────────────────────────────────────────────────────────────

function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      const s2 = net.createServer();
      s2.unref();
      s2.on('error', reject);
      s2.listen(0, '127.0.0.1', () => {
        const { port } = s2.address() as net.AddressInfo;
        s2.close(() => resolve(port));
      });
    });
    server.listen(preferred, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
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

function openBrowser(url: string): void {
  const { platform } = process;
  const cmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'start'
    : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
}

function resolvePackageEntry(pkgName: string): string | null {
  try {
    return require.resolve(pkgName);
  } catch {
    return null;
  }
}

// Proxy a request to the API server, stripping the /api prefix.
function proxyToApi(req: http.IncomingMessage, res: http.ServerResponse, targetPort: number): void {
  const targetPath = (req.url ?? '').replace(/^\/api/, '') || '/';
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: targetPort,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${targetPort}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );
  req.pipe(proxyReq, { end: true });
  proxyReq.on('error', () => {
    if (!res.headersSent) { res.writeHead(502); res.end('Bad Gateway'); }
  });
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [apiPort, uiPort] = await Promise.all([
    findFreePort(3000),
    findFreePort(5173),
  ]);

  const childProcs: ChildProcess[] = [];
  let uiServer: http.Server | null = null;

  function cleanup() {
    for (const child of childProcs) {
      try { child.kill(); } catch { /* already exited */ }
    }
    if (uiServer) try { uiServer.close(); } catch { /* not listening */ }
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

  const defaultDatastore = path.join(os.homedir(), '.kanecta');
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
    // Bundled to CJS by esbuild (build:server), so require is intentional here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    await new Promise<void>((resolve) => uiServer!.listen(uiPort, '127.0.0.1', resolve));
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

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`kanecta studio: ${message}\n`);
  process.exit(1);
});
