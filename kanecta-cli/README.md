# kanecta-cli

Command line tool for the Kanecta filesystem datastore. Implements the full [Kanecta Filesystem Specification](../kanecta-specification/specification.fs.md) (v1.1.0) — create, read, update, and delete items, manage aliases, annotations, and relationships, and traverse the item tree.

## Installation

```sh
cd kanecta-cli
npm install   # no runtime dependencies; installs dev tools only
```

Make the CLI available globally:

```sh
npm link
```

Or run it directly:

```sh
node index.js --datastore <path> <command>
```

## Datastore discovery

The CLI finds the datastore in this order:

1. `--datastore <path>` flag
2. `KANECTA_DATASTORE` environment variable
3. Walk up from the current directory looking for a `.kanecta/` folder

## Quick start

```sh
# Initialise a new datastore
kanecta init ~/my-datastore --owner me@example.com

# Create items
kanecta create --value "Project Alpha" --type text --alias project-alpha
kanecta create --parent project-alpha --value "Design phase" --type string
kanecta create --parent project-alpha --value "Build phase" --type string --tag milestone

# View the tree
kanecta tree
kanecta tree --ids --depth 2

# Get a single item
kanecta get project-alpha
kanecta get project-alpha --json

# Update an item
kanecta update project-alpha --value "Project Alpha (revised)" --confidence decided
kanecta update project-alpha --add-tag reviewed --remove-tag milestone

# Export to a file
kanecta export --output kanecta.txt

# Rebuild index caches after manual edits
kanecta rebuild-indexes
```

## Commands

### `init [path]`

Initialise a new Kanecta datastore.

```
--owner <email>   Datastore owner — used as default owner/createdBy/modifiedBy
```

```sh
kanecta init ~/my-datastore --owner me@example.com
```

---

### `get <id|alias>`

Print details of a single item.

```
--json   Output raw JSON
```

```sh
kanecta get f1a00001-b45e-4c3d-9e7f-000000000001
kanecta get base-work-process --json
```

---

### `create`

Create a new item. A history snapshot is written and all indexes are updated.

```
--type <type>         Item type (default: string)
--value <text>        Item content; use [[uuid]] to inline-link other items
--parent <id|alias>   Parent item (omit for root-level)
--alias <name>        Set an alias immediately after creation
--tag <tag>           Add a tag; repeat for multiple (--tag a --tag b)
--confidence <level>  experimental | exploring | decided | locked
--license <id>        License identifier (MIT, Apache-2.0, CC-BY, …)
--sort-order <n>      Integer position among siblings (default: appended last)
--type-id <uuid>      Type-definition UUID (required when --type is object)
```

```sh
kanecta create --value "Design the API" --type string --parent project-alpha
kanecta create --value "ADR-001" --type decision --alias adr-001
kanecta create --type object --type-id <type-uuid> --tag core
```

**Item types**

| Type | Description |
|---|---|
| `string` | Short text |
| `number` | Numeric value |
| `text` | Long-form text or Markdown |
| `file` | File attachment — value is the filename |
| `symlink` | Pointer to another item — value is the target UUID |
| `object` | Instance of a type definition |
| `decision` | Structured decision record (value is a JSON object) |
| `annotation` | Annotation item type |

---

### `update <id|alias>`

Update fields on an existing item. Only supplied flags are changed. A history snapshot is written before the update and indexes are reconciled.

```
--value <text>        New value
--parent <id|alias>   New parent (use "none" to make the item root-level)
--type <type>         New type
--type-id <uuid>      New type-definition UUID
--add-tag <tag>       Add a tag; repeat for multiple
--remove-tag <tag>    Remove a tag; repeat for multiple
--confidence <level>  New confidence level (use "none" to clear)
--license <id>        New license (use "none" to clear)
--sort-order <n>      New sort position
```

```sh
kanecta update adr-001 --confidence locked
kanecta update adr-001 --add-tag approved --remove-tag draft
kanecta update adr-001 --parent none
```

---

### `delete <id|alias>`

Delete an item. The CLI warns and prompts for confirmation if any other items link to or have relationships with this one. A history snapshot is written before deletion and all index entries are cleaned up.

```
--force   Skip the confirmation prompt
```

```sh
kanecta delete adr-001
kanecta delete adr-001 --force
```

---

### `tree [id|alias]`

Display the item tree rooted at `id` (or all root items if omitted), sorted by `sortOrder`.

```
--depth <n>   Maximum depth to traverse (default: unlimited)
--ids         Prefix each line with the item's UUID
```

```sh
kanecta tree
kanecta tree project-alpha --depth 2
kanecta tree --ids
```

---

### `alias set <alias> <id|alias>`

Create or overwrite an alias pointing to an item.

```sh
kanecta alias set root f1a00001-b45e-4c3d-9e7f-000000000001
kanecta alias set short-name long-alias
```

### `alias get <alias>`

Resolve an alias to its target UUID.

```sh
kanecta alias get root
```

### `alias list`

List all aliases in the datastore.

```sh
kanecta alias list
```

### `alias remove <alias>`

Remove an alias. The target item is not affected.

```sh
kanecta alias remove root
```

---

### `annotate <id|alias> <content>`

Add an annotation (comment) to an item without modifying it. A UUID is generated for each annotation.

```
--reply-to <annotation-id>   Thread a reply under an existing annotation
```

```sh
kanecta annotate project-alpha "This is on track for Q3"
kanecta annotate project-alpha "Agreed" --reply-to <annotation-id>
```

### `annotations <id|alias>`

List all annotations on an item in chronological order.

```sh
kanecta annotations project-alpha
```

---

### `relate <source> <type> <target>`

Create a typed semantic relationship between two items. Both a source→target (outbound) and target→source (inbound) entry are written.

```
--note <text>   Optional note explaining the relationship
```

Valid relationship types:

| Type | Meaning |
|---|---|
| `relates-to` | General association |
| `depends-on` | Source requires target |
| `enables` | Source makes target possible |
| `contradicts` | Source and target are in conflict |
| `blocks` | Source prevents target from progressing |
| `blocked-by` | Source is blocked by target |
| `prerequisite-for` | Source must be completed before target |
| `derived-from` | Source originated from target |
| `supersedes` | Source replaces target |

```sh
kanecta relate build-phase depends-on design-phase --note "need spec first"
kanecta relate adr-001 supersedes adr-000
```

### `relationships <id|alias>`

List all outbound and inbound relationships for an item.

```sh
kanecta relationships build-phase
```

---

### `backlinks <id|alias>`

List all items that reference this one via `[[uuid]]` inline-link syntax.

```sh
kanecta backlinks adr-001
```

---

### `history <id|alias>`

Show the full change history (create / update / delete snapshots) for an item, in chronological order.

```sh
kanecta history adr-001
```

---

### `tag list <tag>`

List the UUIDs of all items carrying a given tag.

```sh
kanecta tag list milestone
kanecta tag list security-related
```

---

### `export [id|alias]`

Export the item tree as indented plain text. Defaults to stdout; use `--output` to write to a file.

```
--depth <n>      Maximum depth (default: unlimited)
--ids            Prefix each line with the item's UUID
--output <file>  Write to a file instead of stdout
```

```sh
kanecta export
kanecta export project-alpha --depth 3
kanecta export --ids --output kanecta.txt
```

---

### `rebuild-indexes`

Rebuild all index caches (`links/`, `tags/`, `types/`) by scanning `data/`. Run after manual edits or a partial import. The `history/`, `annotations/`, `aliases/`, `remotes/`, and `config/` directories are authoritative and are not modified.

```sh
kanecta rebuild-indexes
```

---

## Confidence levels

The `confidence` field captures how settled an item is:

| Level | Meaning |
|---|---|
| `experimental` | Speculative; may change significantly |
| `exploring` | Actively investigating; alternatives still open |
| `decided` | Decision made; could be revisited |
| `locked` | Settled; not expected to change |

## Link syntax

Within any item's `value`, use `[[uuid]]` to inline-link another item:

```
This decision supersedes [[f1a00001-b45e-4c3d-9e7f-000000000001]].
```

The link is recorded in the `links/` backlinks index automatically on create and update. Use `kanecta backlinks <id>` to find all items that link to a given item.

## Tests

```sh
npm test
```

91 tests covering the datastore library (unit) and all CLI commands (integration).
