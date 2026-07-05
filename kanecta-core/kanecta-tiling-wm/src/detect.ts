import fs from 'fs';
import { execFileSync } from 'child_process';

export type TilingVariant = 'sway' | 'i3';

export interface TilingSocket {
  variant: TilingVariant;
  socketPath: string;
}

// Discover a running i3 or Sway instance and its IPC socket path.
//
// Priority:
//   1. $SWAYSOCK — set inside a Sway session.
//   2. $I3SOCK   — set inside an i3 session.
//   3. `i3 --get-socketpath` — i3's documented way to find the socket.
//   4. `swaymsg --get-socketpath` — Sway equivalent (older Sway may not have it).
//
// Returns { variant, socketPath } or null if none is found. Never throws — this
// is an optional capability probe.
export function detectTiling(env: NodeJS.ProcessEnv = process.env): TilingSocket | null {
  const socketExists = (p: string | undefined): boolean => {
    try { return !!p && fs.existsSync(p); } catch { return false; }
  };

  if (socketExists(env.SWAYSOCK)) return { variant: 'sway', socketPath: env.SWAYSOCK as string };
  if (socketExists(env.I3SOCK)) return { variant: 'i3', socketPath: env.I3SOCK as string };

  const tryCmd = (cmd: string, args: string[], variant: TilingVariant): TilingSocket | null => {
    try {
      const out = execFileSync(cmd, args, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (socketExists(out)) return { variant, socketPath: out };
    } catch { /* not installed / not running */ }
    return null;
  };

  return (
    tryCmd('i3', ['--get-socketpath'], 'i3')
    || tryCmd('swaymsg', ['--get-socketpath'], 'sway')
    || null
  );
}
