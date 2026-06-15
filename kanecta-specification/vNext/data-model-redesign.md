# Kanecta Data Model Redesign Notes

## Datomic and bitemporal history

Datomic (Rich Hickey, 2012) builds on the idea that facts are immutable and time is part of the data model. Nothing is ever overwritten — you only ever append new facts. Every fact carries a timestamp so the entire history of every piece of data is always queryable. The present is just the latest facts.

This inspired the **bitemporal / valid-time** pattern for Kanecta history — two timestamp fields on every item row:

```json
{
  "validFrom": "2026-01-01T09:00:00Z",
  "validTo":   "2026-06-10T14:22:00Z"
}
```

- `validFrom` — when this version became current
- `validTo` — when it stopped being current (`null` means it still is)

Current record query:
```sql
SELECT * FROM items WHERE id = $id AND validTo IS NULL
```

Point-in-time query:
```sql
SELECT * FROM items
WHERE id = $id
AND validFrom <= $asOf
AND (validTo > $asOf OR validTo IS NULL)
```

SQLite partial index keeps current-record queries fast — only current records are indexed:
```sql
CREATE INDEX idx_items_current ON items(id) WHERE validTo IS NULL;
```

History records never enter the in-memory cache. They sit in SQLite, queryable on demand, invisible to normal operations.

**item.json on the filesystem always reflects the current version** — overwritten on each update. History lives in SQLite. This means SQLite is not fully rebuildable from files alone for history — accept this, document it, back up SQLite alongside the filesystem.

---

## Tree as a separate concept — nodes referencing items

**The problem with parentId on items:** it conflates what an item is with where it lives. An item can only exist in one place; appearing elsewhere requires a symlink that is a second-class citizen.

**The solution:** the tree is its own structure. Nodes are separate from items. A node references an item by ID.

```json
{
  "id": "node-uuid",
  "type": "node",
  "value": "item-uuid",
  "parentId": "parent-node-uuid",
  "sortOrder": 3,
  "aspect": null
}
```

`parentId` on a node always points to another node — never to an item. Clean separation maintained.

**Items have no tree information at all.** They are pure data. `loadAll()` on items is completely clean — no parentId chains, no tree contamination.

**Unlimited trees:** a tree is just an item with `type: "tree"`. Nodes whose parentId ultimately traces back to that tree item belong to that tree. As many trees as you like, all referencing the same items in different arrangements.

**Same item in multiple trees** — genuinely, via multiple nodes, not symlinks. Moving a node doesn't touch the item at all. Deleting a node doesn't delete the item.

**Nodes are items** — they live in `data/` like everything else. The materialized path for fast tree traversal lives on the node as a SQLite-indexed field, derived from the node structure and rebuildable.

**Nodes are a source of truth** — they cannot be derived from items (items have no tree information). Must be on the filesystem.

---

## meta / payload split

Every item has two top-level sections:

```json
{
  "meta": {
    "id": "uuid",
    "type": "node",
    "value": "calculateTotal",
    "owner": "richard@example.com",
    "createdAt": "2026-06-10T...",
    "modifiedAt": "2026-06-10T...",
    "tags": [],
    "visibility": "private"
  },
  "payload": {
    "target": "item-uuid",
    "path": "tree/node-a/node-uuid",
    "sortOrder": 3
  }
}
```

**meta** — everything the system needs to reason about the item generically. Always the same shape regardless of type. SQLite indexes these fields. The generic layer (history, annotations, search, relationships, UI) only ever touches meta.

**payload** — everything type-specific, opaque to the generic layer. SQLite stores it as a JSON blob column. Type-specific code reads it. Adding a new type means defining a new payload shape — zero changes to the base schema.

**The test for meta vs payload:** does anything outside the type-specific code need to read this field?

**`value` is always meta** — it is the universal human-readable display string for every type. The thing a human reads to identify the item at a glance:

| Type | `value` contains |
|---|---|
| `text` | the text content |
| `heading` | the heading text |
| `url` | the URL string |
| `function` | the function name |
| `type` | the type name e.g. `"Person"` |
| `node` | null — the referenced item's value is displayed |
| `alias` | the alias string e.g. `"drill-one"` |
| `relationship` | the label e.g. `"depends on"` |
| `task` | the task description |

---

## Minimum viable type set

The minimum is ten types across three categories:

**Structural — how things are arranged**
- `text` — a string value, the atom of everything
- `heading` — a text node that signals hierarchy
- `collection` — a container for other items

**Semantic — what things mean**
- `note` — freeform thought
- `task` — something to do, has completion
- `decision` — what was decided and why
- `reference` — points to something else (absorbs symlink, alias, url)

**Meta — the system describes itself**
- `type` — a type definition
- `function` — executable behaviour
- `relationship` — typed edge between items

Everything else is either:
- A user-defined typed object (`type: "object"`, `typeId` set)
- An aspect (settings, history, annotations — dimensions of existing items)
- A field on an item (status, confidence, dueAt)
- A collection with a label (project, area, inbox)

The question to ask for each candidate type: *"is this genuinely a different shape, or is it a collection with a different label?"*

---

## Postgres / SQLite schema

**One base table:**
```sql
CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  value       TEXT,
  owner       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  valid_from  TEXT NOT NULL,
  valid_to    TEXT,              -- NULL = current record
  visibility  TEXT,
  tags        TEXT,              -- JSON array
  payload     JSON               -- type-specific blob
);

CREATE INDEX idx_items_current  ON items(id) WHERE valid_to IS NULL;
CREATE INDEX idx_items_type     ON items(type) WHERE valid_to IS NULL;
```

**Payload tables for system types with queryable fields:**
```sql
-- nodes need path and target queried
CREATE TABLE payload_node (
  id        TEXT PRIMARY KEY REFERENCES items(id),
  target    TEXT REFERENCES items(id),
  path      TEXT NOT NULL,
  sort_order INTEGER
);
CREATE INDEX idx_node_path   ON payload_node(path);
CREATE INDEX idx_node_target ON payload_node(target);

-- aliases need target queried for resolution
CREATE TABLE payload_alias (
  id     TEXT PRIMARY KEY REFERENCES items(id),
  target TEXT NOT NULL REFERENCES items(id)
);

-- relationships need source and target queried
CREATE TABLE payload_relationship (
  id     TEXT PRIMARY KEY REFERENCES items(id),
  source TEXT NOT NULL REFERENCES items(id),
  target TEXT NOT NULL REFERENCES items(id)
);
CREATE INDEX idx_rel_source ON payload_relationship(source);
CREATE INDEX idx_rel_target ON payload_relationship(target);
```

**Functions, types, history, annotations** — payload is a JSON blob on `items.payload`. Never queried by field content, only retrieved by ID. No separate payload table needed.

**User-defined types:**
```sql
CREATE TABLE obj_<type-uuid> (
  id    TEXT PRIMARY KEY REFERENCES items(id),
  name  TEXT,
  -- one column per field in jsonSchema
);
```

**Search:**
```sql
-- SQLite FTS5
CREATE VIRTUAL TABLE search USING fts5(id, value, tags);
-- Postgres
ALTER TABLE items ADD COLUMN search_vector tsvector;
```

---

## Function file structure

```
data/ab/cd/<uuid>/
  item.json     ← meta + signature (name, parameters, returnType, async, ai)
  index.ts      ← the actual editable function, fully formed TypeScript
```

`index.ts` is generated once as a scaffold when the function is created:

```typescript
import { CartItem } from '../../types/cart-item-uuid/index.ts';

export function calculateTotal(items: CartItem[]): number {

}
```

After generation it is hand-edited freely in the IDE — full intellisense, proper types, real TypeScript.

`item.json` is the source of truth for metadata. `index.ts` is the source of truth for the implementation. A sync tool can parse `index.ts` using TypeScript's compiler API to extract the signature back into `item.json` when needed.

Git diffs are clean — signature changes and body changes are in the same file but clearly separated. The IDE has full context — no fragment, no wrapper, no file watcher needed.

**The one tradeoff:** `item.json` and `index.ts` can drift if the signature is edited directly in the file. Treat this as acceptable — the TypeScript AST is parseable and sync is a tooling problem, not a data model problem.

---

## The bootstrapper pattern

Previous versions of Kanecta moved toward an architecture where:
- Functions, components, types, settings all shipped as items in the datastore
- The app shrunk to a minimal kernel — a bootstrapper that loads and executes items
- The app's only job: open the datastore, find the root UI component item, execute it

It approached but never quite reached this because:
- **The bootstrap problem** — the kernel tends to grow; each hardcoded shortcut accumulates
- **Performance pressure** — loading from the datastore at runtime is slower than bundling; optimisations hardcode things
- **Tooling fights you** — React, Vite, TypeScript all assume a static app known at build time
- **Safe execution of stored code** is genuinely hard (sandboxing, versioning, dependencies)

**What's different now:** AI changes the calculus. A stored function doesn't have to be executable code — it can be a description that Claude executes at runtime. That sidesteps the sandboxing problem entirely and makes functions-as-items much more achievable.

The architecture described in these notes — everything an item, SQLite index, filesystem source of truth, first-class relationships, nodes as a separate tree concept — is a cleaner foundation than what existed before. It might get there this time.
