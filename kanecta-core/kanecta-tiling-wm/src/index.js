'use strict';

const { detectTiling } = require('./detect');
const { TilingClient } = require('./client');

// Thrown by openTiling() when no supported WM is available. Callers that treat
// tiling as optional should catch this (or use createTilingService()).
class TilingUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'TilingUnavailableError'; this.code = 'TILING_UNAVAILABLE'; }
}

const UNAVAILABLE_MESSAGE =
  'No i3 or Sway tiling window manager detected. '
  + 'Window tiling is only supported on Linux under a running i3/Sway session '
  + '($SWAYSOCK / $I3SOCK or `i3 --get-socketpath`).';

// Detect + connect. Resolves to a connected TilingClient, or throws
// TilingUnavailableError if no WM is running / not on Linux.
async function openTiling(env = process.env) {
  if (process.platform !== 'linux') {
    throw new TilingUnavailableError(`Window tiling is Linux-only (platform: ${process.platform}).`);
  }
  const found = detectTiling(env);
  if (!found) throw new TilingUnavailableError(UNAVAILABLE_MESSAGE);
  const client = new TilingClient(found.socketPath, found.variant);
  await client.connect();
  return client;
}

// Non-throwing variant for a backend that wants to expose tiling as an optional
// capability. Returns { available, client, variant, reason }. `client` is null
// when unavailable; `reason` explains why.
async function createTilingService(env = process.env) {
  try {
    const client = await openTiling(env);
    return { available: true, client, variant: client.variant, reason: null };
  } catch (err) {
    return { available: false, client: null, variant: null, reason: err.message };
  }
}

// The operations a backend can safely expose to a renderer over its existing
// IPC/HTTP channel. Keyed by name so a backend can do generic RPC dispatch.
const OPERATIONS = Object.freeze({
  listWindows: (c) => c.listWindows(),
  listWorkspaces: (c) => c.listWorkspaces(),
  listOutputs: (c) => c.listOutputs(),
  moveWindowToWorkspace: (c, a) => c.moveWindowToWorkspace(a.conId, a.workspace),
  moveWindowToOutput: (c, a) => c.moveWindowToOutput(a.conId, a.output),
  split: (c, a) => c.split(a.conId, a.direction),
  resize: (c, a) => c.resize(a.conId, { width: a.width, height: a.height }),
  focusWindow: (c, a) => c.focusWindow(a.conId),
  runCommand: (c, a) => c.runCommand(a.command),
  getVersion: (c) => c.getVersion(),
});

// Generic dispatcher: dispatch(client, 'moveWindowToWorkspace', { conId, workspace }).
// Handy for wiring a single backend endpoint that proxies renderer requests.
async function dispatch(client, op, args = {}) {
  const fn = OPERATIONS[op];
  if (!fn) throw new Error(`Unknown tiling operation: ${op}`);
  return fn(client, args);
}

module.exports = {
  openTiling,
  createTilingService,
  detectTiling,
  dispatch,
  OPERATIONS,
  TilingClient,
  TilingUnavailableError,
};
