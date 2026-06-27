# Migration to spec v1.4.0

Migrates a Kanecta **filesystem** datastore from spec v1.3.0 to v1.4.0.

## What changes between 1.3.0 and 1.4.0

See `kanecta-specification/1.4.0/` for the full picture. The parts that
matter for this migration:

### File format — single item.json replaces split files

Every item folder previously held multiple files. In 1.4.0 each item folder
holds exactly one `item.json` containing all data:

| Old files | New file | Notes |
|---|---|---|
| `metadata.json` + `object.json` | `item.json` | object payload moves to `payload` key |
| `metadata.json` + `function.json` | `item.json` | function payload moves to `payload` key; body moves to sidecar `body.ts` referenced via `files.body` |
| `metadata.json` (type definitions in `types/`) + `type.json` | `item.json` | type payload moves to `payload` key |
| `meta.json` | deleted | display cache — discarded |
| `items.json` (type-to-items reverse index) | deleted | replaced by SQLite query |

### New top-level fields

All items gain the following fields (defaulting to null/empty):

| Field | Default | Purpose |
|---|---|---|
| `ownerDomain` | `null` | Home Kanecta instance for cache refresh |
| `namespace` | `null` | Org hierarchy path (e.g. `acme.com/engineering`) |
| `copyrightHolder` | `null` | Legal rights holder; null = same as owner |
| `contentHash` | `null` | SHA-256 for integrity and staleness checks |
| `mirrors` | `[]` | Owner-advertised mirror domains |
| `files` | `{}` | Sidecar file map (e.g. `{ body: "body.ts" }`) |

### Relationships become items

`relationships.json` outbound entries are converted to `relationship` items
(type: `relationship`) stored in `.kanecta/data/`. The `relationships/`
directory is removed.

Christiano's custom relationship types (`resolves`, `evidenced-by`,
`concerns`, etc.) migrate unchanged — `relationshipType` is a free-form
string.

### Source-of-truth directories (Task 2 — not yet implemented)

The following directories will also be converted to items in a follow-up
step once the designs are finalised:

- `.kanecta/aliases/` → items of type `alias`
- `.kanecta/annotations/` → items of type `annotation`
- `.kanecta/history/` → items of type `history`
- `.kanecta/config/` → a single item of type `config`
- `.kanecta/fields/` → items of type `field-ref`

## Running it

```sh
node migrate-1.3.0-to-1.4.0.js <datastore-path> [--dry-run]
```

- `<datastore-path>` — path to the datastore root (the directory that
  *contains* `.kanecta/`, not `.kanecta/` itself).
- `--dry-run` — report what would change without writing anything.

Safe to re-run — every step is idempotent (already-migrated item folders
are detected and skipped).

## Output

- Console report — counts and details for every step, plus validation
  failures.
- `reshape-queue.json` — items that need human/AI attention (e.g. function
  bodies that are unusually large or contain non-JS content). Delete once
  resolved.
