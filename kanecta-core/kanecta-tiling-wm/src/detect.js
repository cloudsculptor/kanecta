'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

// Discover a running i3 or Sway instance and its IPC socket path.
//
// Priority:
//   1. $SWAYSOCK — set inside a Sway session.
//   2. $I3SOCK   — set inside an i3 session.
//   3. `i3 --get-socketpath` — i3's documented way to find the socket.
//   4. `swaymsg --get-socketpath` — Sway equivalent (older Sway may not have it).
//
// Returns { variant: 'sway' | 'i3', socketPath } or null if none is found.
// Never throws — this is an optional capability probe.
function detectTiling(env = process.env) {
  const socketExists = (p) => {
    try { return !!p && fs.existsSync(p); } catch { return false; }
  };

  if (socketExists(env.SWAYSOCK)) return { variant: 'sway', socketPath: env.SWAYSOCK };
  if (socketExists(env.I3SOCK)) return { variant: 'i3', socketPath: env.I3SOCK };

  const tryCmd = (cmd, args, variant) => {
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

module.exports = { detectTiling };
