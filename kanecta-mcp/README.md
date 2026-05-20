# @kanecta/mcp

MCP (Model Context Protocol) server for [Kanecta](https://github.com/cloudsculptor/kanecta) — gives Claude direct, structured access to your personal knowledge base.

Once installed, Claude can capture insights, search past context, and browse your knowledge base as native tools — no slash commands, no prompting required.

---

## Quick start (published package)

### Install via Claude Code CLI

```bash
claude mcp add --transport stdio kanecta -- npx -y @kanecta/mcp
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

---

## Local development setup

When running from a source checkout (not the published npm package), use the setup script:

```bash
bash scripts/setup.sh
```

This installs dependencies, initialises the datastore, and patches `~/.claude.json` with the correct local paths. Then restart Claude Code.

### Manual Claude Code config for local checkout

Claude Code reads MCP config from **`~/.claude.json`** (not `~/.claude/settings.json`).
You need entries in **both** the global `mcpServers` key and the project-level key — the project-level entry overrides the global one for that directory.

```json
{
  "mcpServers": {
    "kanecta": {
      "type": "stdio",
      "command": "/home/<user>/.nvm/versions/node/<version>/bin/node",
      "args": ["/path/to/kanecta/kanecta-mcp/src/index.js"],
      "env": {
        "KANECTA_DATASTORE": "/home/<user>/.kanecta"
      }
    }
  },
  "projects": {
    "/path/to/kanecta": {
      "mcpServers": {
        "kanecta": {
          "type": "stdio",
          "command": "/home/<user>/.nvm/versions/node/<version>/bin/node",
          "args": ["/path/to/kanecta/kanecta-mcp/src/index.js"],
          "env": {
            "KANECTA_DATASTORE": "/home/<user>/.kanecta"
          }
        }
      }
    }
  }
}
```

**nvm note:** Claude Code launches MCP servers without a login shell, so `node` on PATH won't resolve via nvm. Use the full absolute path (`which node` to find it).

### `@kanecta/lib` must use a `file:` link for local dev

`kanecta-mcp/package.json` references `@kanecta/lib` as `"file:../kanecta-lib"`. Do not change this to a version range — the published npm package may be behind the local source.

---

## Datastore discovery

The server resolves the datastore path in this order:

1. `KANECTA_DATASTORE` environment variable
2. `~/.kanecta-config.json` → `datastorePath`
3. Default: `~/.kanecta/`

Initialise a datastore with:

```bash
node kanecta-cli/index.js init ~/.kanecta --owner you@example.com
```

---

## Tools

### Capture & search
| Tool | Description |
|------|-------------|
| `kanecta_capture` | Save context, decisions, or insights. Never accepts secrets. |
| `kanecta_search` | Full-text search. Pass `rootId` to scope to a subtree. Returns ancestors for each result. |
| `kanecta_recent` | List the most recent captures. |

### Item CRUD
| Tool | Description |
|------|-------------|
| `kanecta_get` | Fetch a specific item by UUID or alias. |
| `kanecta_get_children` | List direct children of an item. |
| `kanecta_get_tree` | Get an item with its subtree expanded to a given depth. |
| `kanecta_get_ancestors` | Get the full path from root down to an item's parent. |
| `kanecta_add_item` | Add an item. Supports `alias`, `sortOrder`, `confidence`. |
| `kanecta_update_item` | Update value, type, tags, `parentId` (move), `sortOrder`, or `confidence`. |
| `kanecta_delete_item` | Delete an item and all its descendants. |
| `kanecta_bulk_create` | Create multiple items in one call — eliminates N sequential round trips for template creation. |
| `kanecta_bulk_update` | Update multiple items in one call. |
| `kanecta_clone` | Deep-copy an item and all descendants under a new parent. |

### Aliases
| Tool | Description |
|------|-------------|
| `kanecta_set_alias` | Map a human-readable alias to an item UUID. |

### Relationships
| Tool | Description |
|------|-------------|
| `kanecta_relate` | Create a typed semantic relationship (`depends-on`, `blocks`, `derived-from`, etc.). |
| `kanecta_get_relationships` | Get all inbound and outbound relationships for an item. |
| `kanecta_get_backlinks` | Get all items that contain `[[uuid]]` inline links pointing to this item. |

### Annotations
| Tool | Description |
|------|-------------|
| `kanecta_annotate` | Add a threaded comment to an item without modifying it. |
| `kanecta_get_annotations` | List all annotations on an item. |

### Tag queries
| Tool | Description |
|------|-------------|
| `kanecta_by_tag` | List all items carrying a given tag. |

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

---

## Secret protection

`kanecta_capture` refuses to store content that matches known secret patterns (API keys, tokens, private keys, passwords). This runs client-side — nothing is sent to any external service.

---

## Requirements

- Node.js ≥ 18
- A Kanecta datastore

---

## Checking server status

Inside a Claude Code session:

```
/mcp
```

---

## License

MIT
