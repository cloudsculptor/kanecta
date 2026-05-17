# @kanecta/mcp

MCP (Model Context Protocol) server for [Kanecta](https://github.com/cloudsculptor/kanecta) — gives Claude direct, structured access to your personal knowledge base.

Once installed, Claude can capture insights, search past context, and browse your knowledge base as native tools — no slash commands, no prompting required.

---

## Quick start

### Install via Claude Code CLI (recommended)

```bash
claude mcp add --transport stdio kanecta -- npx -y @kanecta/mcp
```

### Install via Kanecta wizard

If you have `@kanecta/claude` installed, the setup wizard handles this automatically:

```bash
kanecta claude wizard
```

### Install manually (Claude Desktop)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "kanecta": {
      "command": "npx",
      "args": ["-y", "@kanecta/mcp"],
      "env": {
        "KANECTA_DATASTORE": "/path/to/your/kanecta/datastore"
      }
    }
  }
}
```

### Install manually (Claude Code `settings.json`)

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "kanecta": {
      "command": "npx",
      "args": ["-y", "@kanecta/mcp"],
      "type": "stdio"
    }
  }
}
```

---

## Datastore discovery

The server resolves the datastore path in this order:

1. `KANECTA_DATASTORE` environment variable
2. `~/.kanecta-config.json` → `datastorePath` (set by `kanecta claude wizard`)
3. Default: `~/.kanecta/`

---

## Tools

| Tool | Description |
|------|-------------|
| `kanecta_capture` | Save context, decisions, or insights. Never accepts secrets. |
| `kanecta_search` | Full-text substring search across all items. |
| `kanecta_recent` | List the most recent captures. |
| `kanecta_get` | Fetch a specific item by UUID. |
| `kanecta_get_children` | List children of an item (omit `parentId` for roots). |
| `kanecta_get_tree` | Get an item with its subtree expanded to a given depth. |
| `kanecta_add_item` | Add an item with explicit placement in the hierarchy. |
| `kanecta_update_item` | Update an item's value or type. |
| `kanecta_delete_item` | Delete an item (pass `force: true` to override backlink check). |

---

## How captures are organised

Captures are grouped under date items (`YYYY-MM-DD`) in the hierarchy:

```
Claude Captures
└── 2025-05-16
    ├── "Decided to use PostgreSQL for the sessions table"
    └── "Auth middleware rewrite is driven by compliance, not tech debt"
└── 2025-05-15
    └── "Merge freeze begins 2025-05-22 for mobile release"
```

`kanecta_recent` returns the most recent captures sorted by date then insertion order.

---

## Secret protection

`kanecta_capture` refuses to store content that matches known secret patterns (API keys, tokens, private keys, passwords). This runs client-side — nothing is sent to any external service.

---

## Requirements

- Node.js ≥ 18
- A Kanecta datastore (created by `kanecta claude wizard` or `@kanecta/lib`)

---

## Checking server status

Inside a Claude Code session:

```
/mcp
```

---

## License

AGPL-3.0
