import { detectTiling } from './detect.js';
import { TilingClient } from './client.js';

// Thrown by openTiling() when no supported WM is available. Callers that treat
// tiling as optional should catch this (or use createTilingService()).
export class TilingUnavailableError extends Error {
  code = 'TILING_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'TilingUnavailableError';
  }
}

const UNAVAILABLE_MESSAGE =
  'No i3 or Sway tiling window manager detected. '
  + 'Window tiling is only supported on Linux under a running i3/Sway session '
  + '($SWAYSOCK / $I3SOCK or `i3 --get-socketpath`).';

// Detect + connect. Resolves to a connected TilingClient, or throws
// TilingUnavailableError if no WM is running / not on Linux.
export async function openTiling(env: NodeJS.ProcessEnv = process.env): Promise<TilingClient> {
  if (process.platform !== 'linux') {
    throw new TilingUnavailableError(`Window tiling is Linux-only (platform: ${process.platform}).`);
  }
  const found = detectTiling(env);
  if (!found) throw new TilingUnavailableError(UNAVAILABLE_MESSAGE);
  const client = new TilingClient(found.socketPath, found.variant);
  await client.connect();
  return client;
}

export interface TilingService {
  available: boolean;
  client: TilingClient | null;
  variant: string | null;
  reason: string | null;
}

// Non-throwing variant for a backend that wants to expose tiling as an optional
// capability. Returns { available, client, variant, reason }. `client` is null
// when unavailable; `reason` explains why.
export async function createTilingService(env: NodeJS.ProcessEnv = process.env): Promise<TilingService> {
  try {
    const client = await openTiling(env);
    return { available: true, client, variant: client.variant, reason: null };
  } catch (err) {
    return { available: false, client: null, variant: null, reason: (err as Error).message };
  }
}

// The operations a backend can safely expose to a renderer over its existing
// IPC/HTTP channel. Keyed by name so a backend can do generic RPC dispatch.
export const OPERATIONS: Record<string, (c: TilingClient, a?: any) => unknown> = Object.freeze({
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
export async function dispatch(client: TilingClient, op: string, args: any = {}): Promise<unknown> {
  const fn = OPERATIONS[op];
  if (!fn) throw new Error(`Unknown tiling operation: ${op}`);
  return fn(client, args);
}

export { detectTiling, TilingClient };
