# Migration to spec v1.4.0

Migrates a Kanecta **filesystem** datastore from spec v1.3.0 to v1.4.0.

> This is the runbook an AI agent (e.g. Claude Code) follows, **together with
> the datastore owner**, to take a 1.3.0 datastore to 1.4.0. Work top to
> bottom. Do not run it unattended — several steps need the owner's sign-off,
> and one (config) edits a file outside the datastore.

## Prerequisites

The migration scripts live inside the monorepo and one of them
(`migrate-config-keys.js`) imports `@kanecta/lib`, so the repo must be
installed, not just this folder copied:

```sh
cd <repo-root>        # the directory containing kanecta-core/
npm install           # builds @kanecta/lib and the native better-sqlite3 bindings
```

Requires Node (same version the repo targets). `better-sqlite3` is optional for
the datastore scripts — they degrade gracefully if it fails to build — but
install it so the verify step can open the migrated datastore.

## What changes between 1.3.0 and 1.4.0

See `kanecta-specification/1.4.0/` for the full picture. The parts that matter
for this migration:

### File format — single item.json replaces split files

Every item folder previously held multiple files. In 1.4.0 each item folder
holds exactly one `item.json` containing all data:

| Old files | New file | Notes |
|---|---|---|
| `metadata.json` + `object.json` | `item.json` | object payload moves to `payload` key |
| `metadata.json` + `function.json` | `item.json` | function payload moves to `payload` key |
| `metadata.json` (type defs in `types/`) + `type.json` | `item.json` | type schema moves to `payload` key; imported as an `object` item |
| `meta.json` | deleted | display cache — discarded |
| `items.json` (type-to-items reverse index) | deleted | replaced by a derived SQLite index |

### New top-level fields

All items gain provenance/integrity fields, defaulting to null/empty:
`ownerDomain`, `namespace`, `copyrightHolder`, `contentHash`, `mirrors`,
`files`.

### Relationships become items

`relationships.json` outbound entries are converted to `relationship` items
(type `relationship`) stored under their source item. `relationshipType` is a
free-form string, so custom relationship types migrate unchanged — but every
non-built-in type is logged to `reshape-queue.json` for the owner to confirm
(see the reshape runbook below).

### Storage layout — per-branch full folders

**Important:** 1.4.0's on-disk model is *per-branch full folders*, not the flat
`.kanecta/items/` layout. Producing it takes **two** scripts, in order:

1. `migrate-1.3.0-to-1.4.0.js` merges the split files into
   `.kanecta/items/<s1>/<s2>/<uuid>/item.json`.
2. `migrate-datastore-to-per-branch.js` restructures that into
   `.kanecta/branches/main/items/...` (+ `branch.json` per branch). `main`
   stops being special; every branch becomes a self-contained folder.

Running only step 1 leaves the datastore on an **obsolete intermediate layout**
the 1.4.0 adapter no longer reads. Both scripts are required.

`index.db` is 100% derived — neither script builds or copies it. The adapter
rebuilds it from `item.json` files on first open.

## Running it

### Step 0 — pre-flight inventory (do not skip)

List `<datastore>/.kanecta/` and confirm:

- `config/config.json` has `specVersion: "1.3.0"` (or unset). If it's already
  `1.4.0`, stop — it may be partly migrated.
- The only source directories present are `data/`, `types/`, `relationships/`,
  and `config/`. **If any of `aliases/`, `annotations/`, `history/`, or
  `fields/` exist and contain data, STOP and pull in the owner** — these
  scripts do not migrate those directories, and running blindly would leave
  that data behind. Decide with the owner how to handle them before continuing.

### Step 1 — back up

The scripts leave the original files in place, but take a full copy of the
datastore folder anyway before writing anything.

### Step 2 — merge split files → item.json

```sh
node migrate-1.3.0-to-1.4.0.js <datastore-path> --dry-run   # review first
node migrate-1.3.0-to-1.4.0.js <datastore-path>
```

- `<datastore-path>` — the directory that *contains* `.kanecta/`, not
  `.kanecta/` itself.
- `--dry-run` reports what would change without writing.
- `--force` re-runs even if `items/` already exists (overwrites). Safe to
  re-run; writes are atomic and the original JSON is untouched.

Read the console report. If it writes `reshape-queue.json`, work through
[`reshape-data-with-ai.md`](reshape-data-with-ai.md) **with the owner** before
continuing.

### Step 3 — restructure into per-branch folders

```sh
node migrate-datastore-to-per-branch.js <datastore-path> --dry-run
node migrate-datastore-to-per-branch.js <datastore-path>
```

Idempotent; no-op if `branches/main/items` already exists (unless `--force`).
Leaves the old `.kanecta/items` and `.kanecta/index.db` in place as backup.

### Step 4 — migrate the app config (owner-assisted)

The device config file is versioned alongside the datastore and its format
changed in 1.4.0 (`workspaces → workingSets`, `defaultWorkspace/default →
defaultWorkingSet`, per-set `branch → defaultBranch`). Migrate it:

```sh
node migrate-config-keys.js <path/to/config.json>
```

With no argument it resolves the platform-default config path via `@kanecta/lib`
(Linux: `~/.config/kanecta/config.json`). **Confirm the target path with the
owner before running** — it edits a file outside the datastore — and let them
review the `.bak` diff it writes. Idempotent.

### Step 5 — verify

Open the migrated datastore with the 1.4.0 adapter — it rebuilds each branch's
`index.db` from `items/` automatically on first open. Sanity-check the item /
type / relationship counts against the migration report. Once satisfied, delete
the backups the scripts left behind: the original `.kanecta/data`, `types`,
`relationships`, `config`, and the pre-per-branch `.kanecta/items` +
`.kanecta/index.db`. Delete `reshape-queue.json` once every entry is actioned
or deferred with the owner's sign-off.

## Output

- Console report — counts and details for each step, plus validation failures.
- `reshape-queue.json` — items needing owner review (currently: relationship
  entries whose type isn't a built-in). A working artefact; delete when
  resolved.
