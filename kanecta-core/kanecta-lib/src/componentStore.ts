'use strict';

// The device component store — an npm/Gradle-style local cache of soft-coded
// component packages, keyed by `package@version`, shared across every Connector
// app on the device (see the core spec's "The device component store").
//
// This module manages the store on the Node side: resolving its path, syncing
// packages into it from source (today) or a registry (future), and listing /
// reading what is installed. Consuming apps read the store to include components
// at runtime; they never read the component source directory directly.

import fs from 'fs';
import path from 'path';
import { resolveComponentStore } from './appConfig.ts';

/** Absolute path of the store (config/env/platform-default via appConfig). */
function storePath(config?: any): any {
  return resolveComponentStore(config);
}

/** Directory for one package@version inside the store. Scoped names nest naturally. */
function packageDir(store: string, name: string, version: string): string {
  return path.join(store, `${name}@${version}`);
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Is this package@version already materialised in the store? */
function isInstalled(name: string, version: string, { store = storePath() }: any = {}): boolean {
  return fs.existsSync(path.join(packageDir(store, name, version), 'package.json'));
}

/**
 * Copy one component package (a directory containing package.json +
 * kanecta.item.json) into the store at `<store>/<name>@<version>/`. Idempotent:
 * skips an already-installed package unless `force`. Returns
 * { name, version, dir, installed }.
 */
function installFromDir(srcDir: string, { store = storePath(), force = false }: any = {}): any {
  const pkg = readJson(path.join(srcDir, 'package.json'));
  const { name, version } = pkg;
  if (!name || !version) throw new Error(`package.json missing name/version in ${srcDir}`);

  const dir = packageDir(store, name, version);
  if (!force && isInstalled(name, version, { store })) {
    return { name, version, dir, installed: false };
  }

  fs.mkdirSync(path.dirname(dir), { recursive: true });
  // Copy the package, excluding build/dependency noise. node:fs cpSync filter.
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(srcDir, dir, {
    recursive: true,
    filter: (src: string) => {
      const base = path.basename(src);
      return base !== 'node_modules' && base !== '.git' && base !== 'dist' && base !== 'storybook-static';
    },
  });
  return { name, version, dir, installed: true };
}

/**
 * Sync every component package found under `sourceRoot` into the store. A
 * component package is any immediate subdirectory containing BOTH a package.json
 * and a kanecta.item.json. Returns an array of installFromDir results.
 */
function syncFromSource(sourceRoot: string, { store = storePath(), force = false }: any = {}): any[] {
  const results: any[] = [];
  let entries;
  try { entries = fs.readdirSync(sourceRoot, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(sourceRoot, e.name);
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    if (!fs.existsSync(path.join(dir, 'kanecta.item.json'))) continue;
    results.push(installFromDir(dir, { store, force }));
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/** List installed packages: [{ name, version, dir }]. */
function listInstalled({ store = storePath() }: any = {}): any[] {
  const out: any[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      // A package dir has a package.json; a scope dir (@kanecta) recurses.
      if (fs.existsSync(path.join(full, 'package.json'))) {
        const m = e.name.match(/^(.*)@([^@]+)$/);
        if (m) out.push({ name: prefix + m[1], version: m[2], dir: full });
      } else if (e.name.startsWith('@')) {
        walk(full, `${e.name}/`);
      }
    }
  };
  walk(store, '');
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read a package's kanecta.item.json from the store (or null). */
function readComponentItem(name: string, version: string, { store = storePath() }: any = {}): any {
  const file = path.join(packageDir(store, name, version), 'kanecta.item.json');
  try { return readJson(file); } catch { return null; }
}

export {
  storePath,
  packageDir,
  isInstalled,
  installFromDir,
  syncFromSource,
  listInstalled,
  readComponentItem,
};
