#!/usr/bin/env bash
# Sets up Kanecta for local development from a source checkout.
# Run once after cloning, or again after pulling dependency changes.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATASTORE_PATH="${KANECTA_DATASTORE:-$HOME/.kanecta}"
CLAUDE_JSON="$HOME/.claude.json"
NODE="$(which node 2>/dev/null || true)"

# ─── Helpers ──────────────────────────────────────────────────────────────────

info()  { echo "[kanecta] $*"; }
ok()    { echo "[kanecta] ✓ $*"; }
warn()  { echo "[kanecta] ! $*"; }
die()   { echo "[kanecta] ✗ $*" >&2; exit 1; }

require_node() {
  [[ -z "$NODE" ]] && die "node not found on PATH. Install Node.js >= 18 or ensure nvm is active."
  local version
  version=$("$NODE" -e "process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)" 2>/dev/null) || \
    die "Node.js >= 18 is required. Found: $("$NODE" --version)"
  ok "Node: $("$NODE" --version) at $NODE"
}

npm_install() {
  local dir="$1"
  info "npm install in $dir"
  (cd "$dir" && npm install --silent)
  ok "Installed $dir"
}

# ─── Node check ───────────────────────────────────────────────────────────────

require_node

# ─── Install packages in dependency order ─────────────────────────────────────

npm_install "$REPO_ROOT/kanecta-filesystem"
npm_install "$REPO_ROOT/kanecta-lib"
npm_install "$REPO_ROOT/kanecta-api"
npm_install "$REPO_ROOT/kanecta-mcp"

# ─── Initialise datastore ─────────────────────────────────────────────────────

if [[ -d "$DATASTORE_PATH/.kanecta" ]]; then
  ok "Datastore already exists at $DATASTORE_PATH"
else
  info "Initialising datastore at $DATASTORE_PATH"
  read -rp "[kanecta] Enter your owner email (e.g. you@example.com): " OWNER
  [[ -z "$OWNER" ]] && die "Owner email is required."
  "$NODE" "$REPO_ROOT/kanecta-cli/index.js" init "$DATASTORE_PATH" --owner "$OWNER"
  ok "Datastore initialised at $DATASTORE_PATH"
fi

# ─── Patch ~/.claude.json ─────────────────────────────────────────────────────

MCP_ENTRY=$(cat <<ENTRY
{
  "type": "stdio",
  "command": "$NODE",
  "args": ["$REPO_ROOT/kanecta-mcp/src/index.js"],
  "env": { "KANECTA_DATASTORE": "$DATASTORE_PATH" }
}
ENTRY
)

info "Patching $CLAUDE_JSON with kanecta MCP server config"

"$NODE" - "$CLAUDE_JSON" "$REPO_ROOT" "$MCP_ENTRY" <<'PATCH'
const fs   = require('fs');
const path = require('path');

const [,, claudeJsonPath, repoRoot, entryJson] = process.argv;
const entry = JSON.parse(entryJson);

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8')); } catch {}

// Global mcpServers
cfg.mcpServers            = cfg.mcpServers || {};
cfg.mcpServers.kanecta    = entry;

// Project-level override (overrides global for this directory)
cfg.projects              = cfg.projects || {};
cfg.projects[repoRoot]    = cfg.projects[repoRoot] || {};
cfg.projects[repoRoot].mcpServers          = cfg.projects[repoRoot].mcpServers || {};
cfg.projects[repoRoot].mcpServers.kanecta  = entry;

fs.writeFileSync(claudeJsonPath, JSON.stringify(cfg, null, 2) + '\n');
console.log('Patched.');
PATCH

ok "Patched $CLAUDE_JSON (global + project-level)"

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Kanecta setup complete."
echo ""
echo "  API server:  cd kanecta-api && npm start"
echo "               (listens on http://localhost:3001)"
echo ""
echo "  Studio:      cd kanecta-apps/kanecta-app-studio && npm run dev"
echo "               (proxies /api → http://localhost:3001)"
echo ""
echo "  MCP server:  configured in $CLAUDE_JSON"
echo "               Restart Claude Code to pick up the change."
echo "══════════════════════════════════════════════════════"
