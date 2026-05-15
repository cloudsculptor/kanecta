'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_FILE = path.join(os.homedir(), '.kanecta', '.update-check.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Packages to track. Each entry: { name, globalFlag }
// globalFlag is the npm install -g argument to update it.
const TRACKED = [
  { name: 'kanecta',          global: true },
  { name: '@kanecta/studio',  global: true },
  { name: '@kanecta/cli',     global: true },
];

// ── registry lookup ────────────────────────────────────────────────────────

function fetchLatestVersion(pkgName) {
  return new Promise((resolve) => {
    const encoded = pkgName.replace('/', '%2F');
    const url = `https://registry.npmjs.org/${encoded}/latest`;
    const req = https.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body).version ?? null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ── cache helpers ──────────────────────────────────────────────────────────

function readCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
  } catch {}
}

// ── installed version ──────────────────────────────────────────────────────

function installedVersion(pkgName) {
  try {
    const pkgPath = require.resolve(`${pkgName}/package.json`);
    return require(pkgPath).version ?? null;
  } catch {
    return null;
  }
}

// ── semver comparison (no deps) ────────────────────────────────────────────

function isNewer(latest, current) {
  if (!latest || !current) return false;
  const parse = (v) => v.split('.').map(Number);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Starts a background update check. Returns a function that, when called,
 * will await the result and print any available updates.
 *
 * Usage:
 *   const flushUpdates = startUpdateCheck();
 *   // ... run main command ...
 *   await flushUpdates();
 */
function startUpdateCheck() {
  const cache = readCache();
  const now = Date.now();
  const cacheAge = cache ? now - (cache.checkedAt ?? 0) : Infinity;

  let resultPromise;

  if (cacheAge < CACHE_TTL_MS && cache?.results) {
    // Use cached data — no network call
    resultPromise = Promise.resolve(cache.results);
  } else {
    // Fetch all tracked packages concurrently (fire-and-forget in background)
    resultPromise = Promise.all(
      TRACKED.map(async ({ name }) => ({
        name,
        latest: await fetchLatestVersion(name),
        current: installedVersion(name),
      })),
    ).then((results) => {
      writeCache({ checkedAt: now, results });
      return results;
    });
  }

  return async function flushUpdates() {
    let results;
    try {
      results = await resultPromise;
    } catch {
      return;
    }

    const updates = results.filter(({ name, latest, current }) => {
      if (!latest || !current) return false;
      return isNewer(latest, current);
    });

    if (updates.length === 0) return;

    process.stderr.write('\n');
    process.stderr.write('┌─────────────────────────────────────────┐\n');
    process.stderr.write('│  Updates available for kanecta packages  │\n');
    process.stderr.write('├─────────────────────────────────────────┤\n');
    for (const { name, current, latest } of updates) {
      const line = `  ${name}: ${current} → ${latest}`;
      process.stderr.write(`│ ${line.padEnd(41)} │\n`);
    }
    process.stderr.write('│                                         │\n');
    process.stderr.write('│  Run: kanecta update                    │\n');
    process.stderr.write('└─────────────────────────────────────────┘\n');
  };
}

/**
 * Runs the actual update for all installed tracked packages.
 */
async function runUpdate() {
  const { execSync } = require('child_process');

  process.stdout.write('Checking for updates…\n\n');

  const results = await Promise.all(
    TRACKED.map(async ({ name }) => ({
      name,
      latest: await fetchLatestVersion(name),
      current: installedVersion(name),
    })),
  );

  const toUpdate = results.filter(({ latest, current }) => isNewer(latest, current));
  const notInstalled = TRACKED.filter(({ name }) => !installedVersion(name));

  if (toUpdate.length === 0) {
    process.stdout.write('All installed kanecta packages are up to date.\n');
  } else {
    for (const { name, current, latest } of toUpdate) {
      process.stdout.write(`Updating ${name} ${current} → ${latest}…\n`);
      try {
        execSync(`npm install -g ${name}@${latest}`, { stdio: 'inherit' });
        process.stdout.write(`✓ ${name} updated to ${latest}\n\n`);
      } catch {
        process.stderr.write(`✗ Failed to update ${name}. Try manually: npm install -g ${name}@latest\n\n`);
      }
    }
  }

  if (notInstalled.length > 0) {
    process.stdout.write('\nOptional packages not installed:\n');
    for (const { name } of notInstalled) {
      process.stdout.write(`  ${name}  →  npm install -g ${name}\n`);
    }
  }

  // Invalidate cache so next run re-checks
  writeCache(null);
}

module.exports = { startUpdateCheck, runUpdate, isNewer, installedVersion };
