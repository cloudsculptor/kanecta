'use strict';

// ─── Bootstrap config resolution ────────────────────────────────────────────
//
// Single source of truth for locating and reading `config.json`, the platform
// bootstrap config (one layer below the datastore). Every entry point — CLI,
// MCP, API, Electron, dev scripts — uses this module so they never disagree
// about which datastore is active.
//
// Discovery order (per the 1.4.0 spec, "Config file discovery"):
//   1. KANECTA_CONFIG env var — a directory (config.json is read inside it) or a
//      direct path to a .json file. If set, it wins.
//   2. Platform default:
//        Linux:   $XDG_CONFIG_HOME/kanecta/config.json  (or ~/.config/...)
//        Mac:     ~/Library/Application Support/kanecta/config.json
//        Windows: %APPDATA%\kanecta\config.json
//
// Secrets live in a `.env` file beside config.json (never in config.json). String
// values beginning with `$` are resolved from the environment at read time.

import fs from 'fs';
import os from 'os';
import path from 'path';

function expandHome(p: any): any {
  if (!p || typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Absolute path to config.json, honoring KANECTA_CONFIG then the platform default.
function getConfigPath() {
  const override = process.env.KANECTA_CONFIG;
  if (override) {
    const resolved = expandHome(override);
    // A .json path is used directly; anything else is treated as a directory.
    if (resolved.toLowerCase().endsWith('.json')) return resolved;
    return path.join(resolved, 'config.json');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'kanecta', 'config.json');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'kanecta', 'config.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'kanecta', 'config.json');
}

// Minimal `.env` parser — KEY=VALUE per line, `#` comments, optional quotes.
// Loaded into process.env without overwriting values already set there.
function loadDotEnv(dir: string): void {
  const envPath = path.join(dir, '.env');
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Resolve a single `$VAR` reference from the environment. Non-`$` strings and
// non-strings pass through unchanged. An unset `$VAR` resolves to '' (with a
// warning) so connection attempts fail loudly rather than using a literal.
function resolveEnvRef(value: any): any {
  if (typeof value !== 'string' || !value.startsWith('$')) return value;
  const name = value.slice(1);
  if (!(name in process.env)) {
    console.warn(`kanecta: config references ${value} but it is not set (check the .env beside config.json)`);
    return '';
  }
  return process.env[name];
}

// Walk an object/array tree resolving every `$VAR` string leaf.
function deepResolveEnv(node: any): any {
  if (Array.isArray(node)) return node.map(deepResolveEnv);
  if (node && typeof node === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) out[k] = deepResolveEnv(v);
    return out;
  }
  return resolveEnvRef(node);
}

let warnedLegacyKeys = false;

// Map legacy 1.3.x/early-1.4.0 keys onto the current working-set vocabulary so
// configs written before the rename keep working. Emits a one-time deprecation.
function normalizeLegacyKeys(config: any): any {
  if (!config || typeof config !== 'object') return config;
  let usedLegacy = false;
  if (!config.workingSets && config.workspaces) {
    config.workingSets = config.workspaces;
    usedLegacy = true;
  }
  if (!config.defaultWorkingSet && (config.defaultWorkspace || config.default)) {
    config.defaultWorkingSet = config.defaultWorkspace || config.default;
    usedLegacy = true;
  }
  if (usedLegacy && !warnedLegacyKeys) {
    warnedLegacyKeys = true;
    console.warn(
      'kanecta: config uses legacy "workspaces"/"defaultWorkspace" keys — rename to ' +
      '"workingSets"/"defaultWorkingSet" (run the config migration).',
    );
  }
  return config;
}

// Read, normalize, and env-resolve config.json. Returns null if absent/unreadable.
function readAppConfig() {
  const configPath = getConfigPath();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
  loadDotEnv(path.dirname(configPath));
  return deepResolveEnv(normalizeLegacyKeys(parsed));
}

// ─── Active state (HEAD) — machine-local, beside config.json ──────────────────
//
// state.json holds the active working set and per-working-set active branch for
// the *interactive/default* context (Studio, bare CLI). It is mutable,
// machine-local, and gitignored — never config. Per-consumer overrides (env vars,
// MCP/API/CLI args) sit above it so concurrent consumers (e.g. MCP and API) stay
// independent without clobbering each other.

function getStatePath(): string {
  return path.join(path.dirname(getConfigPath()), 'state.json');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state: any): void {
  const statePath = getStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

// Persist the active working set (the HEAD). Used by Studio/CLI "switch".
function setActiveWorkingSet(name: string): void {
  const state = readState();
  state.activeWorkingSet = name;
  writeState(state);
}

// Persist the active branch for a working set.
function setActiveBranch(workingSetName: string, branch: string): void {
  const state = readState();
  state.activeBranch = state.activeBranch || {};
  state.activeBranch[workingSetName] = branch;
  writeState(state);
}

// Resolve the active branch for a working set. Precedence: explicit override →
// KANECTA_BRANCH → state.activeBranch[ws] → config defaultBranch → 'main'.
function resolveBranch(workingSetName: string, override?: any): any {
  if (override) return override;
  if (process.env.KANECTA_BRANCH) return process.env.KANECTA_BRANCH;
  const state = readState();
  const fromState = state.activeBranch?.[workingSetName];
  if (fromState) return fromState;
  const config = readAppConfig();
  const ws = config?.workingSets?.[workingSetName];
  if (ws?.defaultBranch) return ws.defaultBranch;
  if (typeof ws?.branch === 'string') return ws.branch; // legacy field
  return 'main';
}

// Resolve the active working set. Precedence: explicit name → KANECTA_WORKING_SET
// → state.activeWorkingSet → config.defaultWorkingSet → the sole working set if
// there is exactly one. Throws a clear, actionable error otherwise.
// Returns { name, workingSet }.
function resolveWorkingSet(name?: any): any {
  const config = readAppConfig();
  const sets = config?.workingSets ?? {};
  const names = Object.keys(sets);
  const configPath = getConfigPath();
  const state = readState();
  const requested =
    name ||
    process.env.KANECTA_WORKING_SET ||
    state.activeWorkingSet ||
    config?.defaultWorkingSet;
  if (requested) {
    if (!sets[requested]) {
      throw new Error(
        `Working set '${requested}' not found in ${configPath} — known working sets: ${names.join(', ') || '(none)'}`,
      );
    }
    return { name: requested, workingSet: sets[requested] };
  }
  if (names.length === 1) return { name: names[0], workingSet: sets[names[0]] };
  if (names.length > 1) {
    throw new Error(
      `Multiple working sets configured in ${configPath} — set KANECTA_WORKING_SET to one of: ${names.join(', ')}`,
    );
  }
  throw new Error(`No working sets configured in ${configPath}`);
}

// Local filesystem datastore path for a working set, supporting the 1.4.0 shapes
// (`local` as a string, or `{ type: 'filesystem', path }`) and the legacy
// `datastore` field. Returns null when there is no local filesystem datastore.
function workingSetLocalPath(workingSet: any): any {
  if (!workingSet) return null;
  const { local } = workingSet;
  if (typeof local === 'string') return expandHome(local);
  if (local && typeof local === 'object' && local.type === 'filesystem' && local.path) {
    return expandHome(local.path);
  }
  if (workingSet.datastore) return expandHome(workingSet.datastore);
  return null;
}

// Migrate a parsed config object from the legacy shape to the current one:
//   workspaces            -> workingSets
//   defaultWorkspace/default -> defaultWorkingSet
//   workingSets[*].branch -> workingSets[*].defaultBranch
// Idempotent. Unlike normalizeLegacyKeys (read-time, in-memory), this produces the
// canonical on-disk shape for writing back via a migration. Leaves any 1.3.x
// mode/datastore/cloud fields untouched (openWorkingSet still understands them).
function migrateConfigShape(config: any): any {
  if (!config || typeof config !== 'object') return config;
  const out: any = { ...config };
  if (!out.workingSets && out.workspaces) out.workingSets = out.workspaces;
  delete out.workspaces;
  if (!out.defaultWorkingSet && (out.defaultWorkspace || out.default)) {
    out.defaultWorkingSet = out.defaultWorkspace || out.default;
  }
  delete out.defaultWorkspace;
  delete out.default;
  if (out.workingSets && typeof out.workingSets === 'object') {
    const migrated: any = {};
    for (const [name, ws] of Object.entries<any>(out.workingSets)) {
      const nw: any = ws && typeof ws === 'object' ? { ...ws } : ws;
      if (nw && typeof nw === 'object' && nw.branch && !nw.defaultBranch) {
        nw.defaultBranch = nw.branch;
        delete nw.branch;
      }
      migrated[name] = nw;
    }
    out.workingSets = migrated;
  }
  if (!out.specVersion) out.specVersion = '1.4.0';
  return out;
}

// Resolve the per-device component store — the npm/Gradle-style cache of
// soft-coded component packages (keyed package@version), shared across every
// Connector app on this device. Resolution order (mirrors config discovery, but
// under the OS *cache* location rather than *config*):
//   1. KANECTA_COMPONENT_STORE env var, else
//   2. config.json `componentStore`, else
//   3. platform default.
function resolveComponentStore(config?: any): any {
  const env = process.env.KANECTA_COMPONENT_STORE;
  if (env) return expandHome(env);

  const cfg = config ?? readAppConfig();
  if (cfg && cfg.componentStore) return expandHome(cfg.componentStore);

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'kanecta', 'components');
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'kanecta', 'components');
  }
  const xdgCache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(xdgCache, 'kanecta', 'components');
}

export {
  expandHome,
  getConfigPath,
  readAppConfig,
  migrateConfigShape,
  getStatePath,
  readState,
  writeState,
  setActiveWorkingSet,
  setActiveBranch,
  resolveWorkingSet,
  resolveBranch,
  workingSetLocalPath,
  resolveComponentStore,
};
