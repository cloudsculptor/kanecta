---
"@kanecta/lib": minor
"@kanecta/cli": minor
"@kanecta/mcp": minor
"@kanecta/api": minor
---

Unify datastore configuration under `KANECTA_CONFIG` and the config's working sets.

**BREAKING.** `KANECTA_DATASTORE` and `KANECTA_DATASTORES` are removed. Every entry
point (CLI, MCP, API, function-runner) now resolves the active datastore the same
way, via a single shared resolver in `@kanecta/lib`:

- `KANECTA_CONFIG` locates `config.json` (a directory containing it, or a direct
  `.json` path); otherwise the platform default (`~/.config/kanecta/config.json`
  on Linux). Secrets live in a `.env` beside `config.json`; `$VAR` values are
  resolved at read time.
- The active **working set** and **branch** resolve as: explicit argument
  (CLI `--working-set`/`--branch`, MCP `workingSet`/`branch`, API
  `?workingSet=`/`?branch=`) → `KANECTA_WORKING_SET`/`KANECTA_BRANCH` →
  machine-local `state.json` → `config.json` `defaultWorkingSet` / the working
  set's `defaultBranch` → `main`.
- Config keys are renamed: `workspaces`→`workingSets`,
  `defaultWorkspace`→`defaultWorkingSet`, per-working-set `branch`→`defaultBranch`.
  The resolver still reads the legacy keys; run
  `kanecta-migrations/1.4.0/migrate-config-keys.js` to rewrite a `config.json`.
- MCP: the per-call `datastore` tool argument is replaced by `workingSet` (plus a
  new `branch`); the `KANECTA_DATASTORES` registry is gone.

Migration: set `KANECTA_CONFIG` (or use the platform default) with a `config.json`
that defines your working sets; replace any `KANECTA_DATASTORE` usage with the
active working set. See the new spec chapters "Working Sets, Branches & Sync" and
"Write Integrity & Durability".
