# Kanecta

A personal knowledge base for Claude — context, decisions, and insights that persist across every session, every project, every conversation. Like Obsidian, but native to how Claude works.

## Install

```sh
npm install -g kanecta
kanecta
```

The first run launches a setup wizard. That's it.

## How it works with Claude

Most people lose context between Claude sessions. Every new conversation starts cold. Kanecta fixes this by giving Claude a structured, searchable store that lives on your machine and survives indefinitely.

There are three integration layers, all set up by the wizard:

### 1. MCP server (recommended)

Claude Code connects to Kanecta as an MCP tool server. This gives Claude five native tools it can call directly — no shell commands, no guessing, just structured calls:

| Tool | What it does |
|---|---|
| `kanecta_capture` | Save a decision, insight, or fact |
| `kanecta_search` | Find past context by keyword |
| `kanecta_recent` | Show the latest captures |
| `kanecta_get` | Retrieve a specific item by ID or alias |
| `kanecta_tree` | Browse the knowledge base as a tree |

When Claude notices something worth saving — a decision, a solution to a hard problem, a preference you've stated — it calls `kanecta_capture` directly. When you start a complex task, it can call `kanecta_search` to check if you've done something similar before.

### 2. CLAUDE.md instructions

The wizard adds a short block to your `~/.claude/CLAUDE.md`. This tells Claude:
- that Kanecta exists and how to use it
- when to capture (based on your chosen mode)
- never to capture secrets, API keys, or passwords

This block is added to your existing CLAUDE.md — it never replaces what's already there.

### 3. Slash commands

Two slash commands are installed to `~/.claude/commands/`:

- `/kanecta-search <query>` — search your knowledge base from any Claude session
- `/kanecta-capture <text>` — manually save something

---

## Capture modes

Choose how aggressively Claude captures during setup, or change any time with `kanecta mode <mode>`:

| Mode | Behaviour |
|---|---|
| `always` | Claude saves key decisions, solutions, and insights automatically |
| `extended` | Same as always, plus reasoning chains (uses more tokens) |
| `ask-at-start` | Claude asks which mode to use at the start of each conversation |
| `manual` | Claude only captures when you explicitly ask |

## What gets captured

Claude uses judgment. It captures things worth remembering across sessions:

- **Decisions** — architectural choices, approach decisions, tradeoffs accepted
- **Solutions** — fixes to hard bugs, workarounds for specific issues
- **Preferences** — how you like code structured, your naming conventions, your workflow
- **Project context** — what a system does, key constraints, who the stakeholders are
- **Facts** — things you told Claude that it should know next time

**What never gets captured:** secrets, API keys, passwords, tokens. Kanecta rejects them at the capture layer.

---

## Storage

Everything is stored locally in a Kanecta datastore — a directory of JSON files following the [Kanecta Filesystem Specification](../kanecta-specification/specification.fs.md). No cloud, no sync, no third party.

Default location: `~/.kanecta`

The data is a hierarchical tree. Captures go under a "Claude Captures" root item, organised by date:

```
Claude Captures
  └── 2026-05-14
       ├── decided to use PostgreSQL for the main store [tag: decision]
       ├── the rate limiter uses token bucket not leaky bucket [tag: architecture]
       └── user prefers snake_case for all database columns [tag: preference]
  └── 2026-05-15
       └── ...
```

---

## Commands

### Claude integration

```sh
kanecta                              # first run → wizard; otherwise → help
kanecta wizard                       # re-run setup at any time
kanecta capture "text" [--tag t]     # save something (Claude does this automatically)
kanecta search "query"               # full-text search
kanecta recent [--n 10]              # show latest captures
kanecta mode always|extended|ask-at-start|manual   # change capture mode
kanecta status                       # show configuration
kanecta mcp                          # start as MCP server (used by Claude Code)
```

### Datastore

All standard Kanecta filesystem operations are available:

```sh
kanecta tree [--depth 2] [--ids]     # browse the knowledge base
kanecta get <id|alias>               # get a specific item
kanecta create --value "..." --tag t # create an item
kanecta update <id|alias> --value .. # update an item
kanecta delete <id|alias>            # delete (warns if referenced)
kanecta alias set <name> <id>        # create an alias
kanecta alias list                   # list all aliases
kanecta tag list <tag>               # find items by tag
kanecta history <id|alias>           # show change history
kanecta annotate <id|alias> "note"   # add a comment to an item
kanecta relate <a> depends-on <b>    # create a typed relationship
kanecta export [--output file.txt]   # export as indented text
kanecta rebuild-indexes              # rebuild search indexes
```

See `kanecta --help` for the full reference.

---

## Example session

```
You: I want to build a CLI for managing Kubernetes configs.

Claude: [calls kanecta_search "kubernetes cli"] — finds nothing yet.

Claude: Let's start with... [builds the CLI]

Claude: [calls kanecta_capture "decided to use cobra for the Kubernetes config CLI — 
         better completion support than urfave/cli" --tag decision]

You: always use cobra for CLIs, it's my preference

Claude: [calls kanecta_capture "user preference: always use cobra for Go CLIs" 
         --tag preference]

--- next session, different project ---

You: I need to add a CLI to this Go service.

Claude: [calls kanecta_recent] — sees the cobra preference.

Claude: I'll use cobra for this — I see from a previous session that's your preference.
```

---

## Publishing to npm

When publishing a new version:

```sh
# 1. Publish kanecta-cli first (the datastore library)
cd kanecta-cli && npm publish

# 2. Then publish kanecta (updates the dep version automatically)
cd kanecta && npm publish
# The prepublishOnly script updates the kanecta-cli dep from file: to ^version
```

## Datastore discovery

Kanecta finds the datastore in this order:

1. `--datastore <path>` flag
2. `KANECTA_DATASTORE` environment variable
3. `~/.kanecta-config.json` (set by wizard)
4. Walk up from current directory looking for `.kanecta/`
