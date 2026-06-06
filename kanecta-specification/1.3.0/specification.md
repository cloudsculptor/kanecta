# Kanecta Datastore Specification (File system)

**Version:** 1.3.0
**License:** [MIT](LICENSE) — © 2026 Richard Thomas

## Overview
Kanecta is an open-source, self-hosted personal and organizational information repository. Data is stored as a hierarchical tree structure with globally unique identifiers, enabling flexible organization, linking, semantic relationships, and multi-user collaboration. The protocol is designed as a human-AI bridge: structured enough for AI to work with efficiently, transparent enough for humans to audit and understand.

## Official Specification

**This document is the official Kanecta specification.** It defines the filesystem-based datastore format that all compliant implementations must follow.

## Extended Specifications

The [`./extended-specs/`](./extended-specs/) directory contains derived specifications for alternative storage backends:

| File | Description |
|---|---|
| [`./extended-specs/specification.db.md`](./extended-specs/specification.db.md) | Relational database variant (ANSI SQL) |
| [`./extended-specs/specification.db.postgres.md`](./extended-specs/specification.db.postgres.md) | PostgreSQL-specific dialect, extends the database variant |

These are **not required**. Implementations are free to use any storage backend they choose. The extended specs are provided as suggestions to help keep implementations compatible with each other and with the reference implementation. They reflect the same data model and business rules as this document, adapted for a different storage medium.

## 1. Directory Structure

### Root Level
When a user initializes Kanecta, they designate a **datastore** location on disk. Inside that datastore:

```
datastore/
├── .kanecta/
│   ├── data/
│   ├── aliases/
│   ├── annotations/
│   ├── config/
│   ├── fields/
│   ├── history/
│   ├── links/
│   ├── relationships/
│   ├── remotes/
│   ├── remotes-index/
│   ├── search/
│   ├── tags/
│   └── types/
├── specification.md
└── README.md
```

### Well-Known Root Nodes

Every Kanecta datastore contains five reserved items that are auto-created when a datastore is first opened and found to be empty. These items anchor the tree and enable consistent navigation by all implementations.

| Type | ID | `parentId` | `value` |
|---|---|---|---|
| `root` | `00000000-0000-0000-0000-000000000000` | `00000000-0000-0000-0000-000000000000` (self) | `"root"` |
| `system_root` | generated UUID v4 | root ID | `"system_root"` |
| `app_root` | generated UUID v4 | root ID | `"app_root"` |
| `component_root` | generated UUID v4 | root ID | `"component_root"` |
| `data_root` | generated UUID v4 | root ID | `"data_root"` |

**Rules:**
- The `root` ID is fixed and universally known: `00000000-0000-0000-0000-000000000000`. No lookup is required to find it.
- `root` is self-referential: its `parentId` equals its own `id`. This satisfies the non-nullable `parentId` constraint.
- Each of these five types is a **singleton** — a datastore must never contain more than one item of each well-known type. Implementations must reject attempts to create duplicates.
- The `value` of each well-known node equals its type name. The value is cosmetic and carries no semantic weight.
- Well-known nodes are created in order: `root` first, then its four children.

**Tree navigation:** When serving the user's tree, implementations navigate to root (known ID), find the child with type `data_root`, and return that node's subtree. User data lives exclusively under `data_root`.

### .kanecta/data/ — Source of Truth

All items in the Kanecta datastore live here in a sharded UUID structure.

**UUID Standard:** Kanecta uses UUID version 4 (random) for all item identifiers. UUID v4 provides 122 bits of randomness, making collisions effectively impossible across all installations worldwide, with no central authority required for uniqueness.

**Sharding Strategy: 2 + 2 + Full UUID (mandatory)**

The first two pairs of characters from the UUID (after stripping hyphens) form two directory levels. The third level is the **complete UUID** (with hyphens preserved). This sharding strategy is **mandatory** for every keyed folder structure in `.kanecta/` — no alternative layout is permitted. This approach:

- Distributes items across 65,536 possible shard combinations (256 × 256)
- Keeps the full UUID in the path for recovery and debugging
- Avoids filesystem performance issues from too many items in one directory
- Allows the directory name to be self-identifying

**Example:**
UUID: `a1b2c3d4-e5f6-4abc-9def-123456789012`
Stripped first 4 chars: `a1b2`
Path: `.kanecta/data/a1/b2/a1b2c3d4-e5f6-4abc-9def-123456789012/`

**Structure Example:**
```
.kanecta/data/
└── a1/
    └── b2/
        └── a1b2c3d4-e5f6-4abc-9def-123456789012/
            ├── metadata.json
            ├── image.png (optional)
            └── document.txt (optional)
```

Each item folder contains:
- **metadata.json** — Item metadata (required)
- **function.json** — Function signature and implementation (required when `type` is `function`)
- **Optional files** — Images, code, documents, attachments, etc.

### metadata.json Schema

**Source of truth: [`./file-specs/metadata.json`](./file-specs/metadata.json)**

```json
{
  "id": "string (UUID v4)",
  "parentId": "string (UUID v4) or null",
  "value": "string or null",
  "type": "string",
  "typeId": "string (UUID v4) or null",
  "owner": "string (email or domain)",
  "license": "string (UUID v4, references a row in the licences reference set; defaults to 'All Rights Reserved')",
  "sortOrder": "integer",
  "confidence": "string or null",
  "status": "string or null",
  "tags": ["string", "..."],
  "createdAt": "string (ISO8601)",
  "modifiedAt": "string (ISO8601)",
  "createdBy": "string (email or domain)",
  "modifiedBy": "string (email or domain)",
  "cachedAt": "string (ISO8601) or null",
  "subscribedAt": "string (ISO8601) or null",
  "subscriptionSource": "string or null",
  "completedAt": "string (ISO8601) or null",
  "dueAt": "string (ISO8601) or null",
  "aspect": "string or null"
}
```

### Field Definitions

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique identifier for this item (UUID v4) |
| `parentId` | yes | UUID of parent item. Never null — the `root` node is self-referential (`parentId` equals its own `id`) |
| `value` | no | Item content. Text string, UUID reference (for symlinks), or null |
| `type` | yes | Item type. See [Item Types](#item-types) below for the canonical list. |
| `typeId` | conditional | If type is `object`, UUID of the type definition. Otherwise null |
| `owner` | yes | Email or domain of item owner |
| `license` | yes | UUID reference to this item's licence. Always set, defaulting to 'All Rights Reserved (Copyright)' — references a row in a fixed, shipped reference set of common licences (public domain, Creative Commons, common software licences) |
| `sortOrder` | yes | Integer for sibling ordering. Higher numbers appear lower in the tree |
| `confidence` | no | Confidence/certainty level: `experimental`, `exploring`, `decided`, `locked`, or null |
| `status` | no | Arbitrary status string (e.g. `"active"`, `"archived"`, `"draft"`) or null |
| `tags` | no | Array of cross-cutting tags (e.g., `performance-critical`, `security-related`, `technical-debt`) |
| `createdAt` | yes | ISO8601 timestamp of item creation |
| `modifiedAt` | yes | ISO8601 timestamp of most recent modification |
| `createdBy` | yes | Email or domain of creator |
| `modifiedBy` | yes | Email or domain of most recent modifier |
| `cachedAt` | conditional | ISO8601 timestamp when remote item was last cached. Required for remotes, null for local items |
| `subscribedAt` | no | ISO8601 timestamp when subscription started. Null if not subscribed |
| `subscriptionSource` | no | URL or identifier of remote source for updates |
| `dueAt` | no | ISO8601 timestamp when this item is due. Null if no due date is set |
| `completedAt` | no | ISO8601 timestamp when this item was marked as completed. Null if not completed |
| `visibility` | no | Coarse default access level: `private`, `organisation`, or `public`. Fast-path check, layered under by fine-grained per-principal grants — see [Future Extensibility](#5-future-extensibility) |
| `aspect` | no | Dimension this item occupies under its parent. `null` = main tree (default). Any other string names an alternative dimension (e.g. `"settings"`, `"hidden"`, `"archive"`). An item belongs to exactly one aspect. `sortOrder` is scoped per-aspect. Aspect names are free-form; none are reserved |

**Understanding aspects**

Think of aspects as named drawers built into every item. The main drawer (`null`) is what the user always sees when browsing the tree. Other drawers — `"settings"`, `"hidden"`, `"context"` — sit alongside it, invisible until explicitly opened. A settings panel for a project lives in that project's `"settings"` aspect; archived children live in `"archive"`; a scratchpad lives in `"draft"`. The parent item doesn't need to know what aspects its children use — aspects are declared by the children, not the parent. This means any item can sprout new dimensions without the parent being modified.

### function.json Schema

**Source of truth: [`./file-specs/function.json`](./file-specs/function.json)**

When an item's `type` is `function`, a `function.json` file must be stored alongside `metadata.json` in the item's data folder. It captures the full TypeScript-compatible function signature and optional implementation. The function name is stored in the item's `metadata.json` `value` field.

Key fields:

| Field | Required | Description |
|---|---|---|
| `parameters` | yes | Ordered array of parameter objects. Each must have `name` and exactly one of `type` or `typeId` (see below). |
| `returnType` | conditional | TypeScript **primitive** return type only. Same rules as parameter `type`: primitives and their compositions. Object types must use `returnTypeId`. Required if `returnTypeId` is absent. |
| `returnTypeId` | conditional | UUID of a Kanecta type definition for the return value. Required for object return types. Required if `returnType` is absent. |
| `description` | no | JSDoc-style summary |
| `async` | no | Whether the function is async (default `false`) |
| `ai` | no | Whether the function invokes AI during its internal operations (default `false`) |
| `skill` | no | UUID of a Kanecta skill item. When present, the function delegates to that skill instead of (or in addition to) `body` |
| `typeParameters` | no | Generic type parameters (`name`, `constraint`, `default`) |
| `throws` | no | Error types the function may throw |
| `deprecated` | no | Deprecation notice string |
| `body` | no | Function body as source code. Omit when describing a signature only |

**Parameter fields:**

| Field | Required | Description |
|---|---|---|
| `name` | yes | Parameter name |
| `type` | conditional | TypeScript **primitive** type only: `string`, `number`, `boolean`, `null`, `undefined`, `void`, `never`, `unknown`, `any`, `symbol`, `bigint`, and compositions of these (arrays, unions, `Promise<T>`, generic params from `typeParameters`). Object types — named or inline — are not permitted; use `typeId` instead. Required if `typeId` is absent. |
| `typeId` | conditional | UUID of a Kanecta type definition. Resolves to that type's JSON schema at runtime. Required for all object types. Required if `type` is absent. |
| `optional` | no | Whether the parameter is optional — `?` suffix in TypeScript (default `false`) |
| `rest` | no | Whether this is a rest parameter — `...args` (default `false`) |
| `defaultValue` | no | Default value as a source string (e.g. `'0'`, `'[]'`) |
| `description` | no | JSDoc `@param` description |

### Item Types

**Source of truth: [`./types/primitive.json`](./types/primitive.json)**

All valid `type` values are defined in `./types/primitive.json`. Implementations must treat that file as authoritative — do not hardcode the type list.

Types are grouped into three categories:

| Category | Description | Types |
|---|---|---|
| **primitive** | Basic value containers with no domain-specific meaning | `string`, `number`, `text`, `heading`, `file`, `symlink`, `url`, `image`, `function`, `markdown`, `runner` |
| **structured** | Types with defined semantic intent | `object`, `decision`, `annotation`, `claim`, `question`, `task`, `note`, `concept`, `entity`, `event` |
| **wellKnown** | Reserved system root nodes — not for user data | `root`, `system_root`, `app_root`, `component_root`, `data_root` |

User-created items use `primitive` and `structured` types. `wellKnown` types are created only during datastore initialisation.

---

### Confidence Levels

The `confidence` field indicates how settled an item is:

- **experimental** — Speculative, being tried out, may change significantly
- **exploring** — Actively investigating, alternatives still on the table
- **decided** — A decision has been made, but could be revisited
- **locked** — Settled, not expected to change

### Decision Item Type

When `type` is `decision`, the `value` field contains a JSON object capturing the reasoning behind the decision:

```json
{
  "decision": "What was decided",
  "problem": "The problem this decision solves",
  "alternatives": [
    {
      "option": "Alternative considered",
      "reasoning": "Why it was considered",
      "rejectedBecause": "Why it was not chosen"
    }
  ],
  "tradeoffs": "Trade-offs accepted with this decision",
  "reasoning": "Full reasoning narrative",
  "decidedBy": "email or domain",
  "decidedAt": "ISO8601 timestamp"
}
```

Decision items capture not just *what* was decided, but *why*. They form an institutional memory of reasoning that compounds in value over time.

### .kanecta/fields/ — Field UUID Mappings

Maps stable UUIDs to `(item, field)` pairs. Created on demand only — never proactively generated. Uses the mandatory 2 + 2 + full UUID sharding, keyed by the field-ref UUID.

**Structure:**
```
.kanecta/fields/
└── a1/
    └── b2/
        └── a1b2c3d4-e5f6-4abc-9def-123456789012/
            └── ref.json
```

**ref.json:**
```json
{
  "id": "a1b2c3d4-e5f6-4abc-9def-123456789012",
  "itemId": "item-uuid",
  "fieldXId": "x-id-uuid-of-the-property"
}
```

A reverse index lives alongside each item's data, listing all field-ref UUIDs that point into it:

```
.kanecta/data/[shard]/[item-uuid]/fields.json
```

```json
{ "fieldRefs": ["field-ref-uuid-1", "field-ref-uuid-2"] }
```

This reverse index enables cleanup: when an item is deleted, all its field-ref entries can be found and removed without scanning the full `fields/` tree.

**Rules:**
- A field-ref UUID is permanent as long as its parent item exists. Implementations must never delete a field-ref entry while the item is alive.
- When an item is deleted, all its fields are deleted with it (cascade).
- The `(itemId, fieldXId)` pair is unique — requesting a field-ref UUID for the same pair always returns the same UUID (upsert semantics).
- `fieldXId` is the `x-id` UUID of a property in the item's type's `jsonSchema.properties`. It is not validated against the live type schema at write time, but resolvers should handle gracefully the case where the field no longer exists in the type.

### .kanecta/aliases/ — Human-Readable Shortcuts

Stores user-friendly aliases mapping to item UUIDs. Uses the mandatory 2 + 2 + full sharding pattern, keyed by the alias string itself rather than a UUID. The first two characters form the first level, the next two form the second, and the full alias string forms the third level.

**Structure:**
```
.kanecta/aliases/
└── dr/
    └── il/
        └── drill-one/
            └── target.txt
```

Each `target.txt` contains a single line with the target UUID:
```
a1b2c3d4-e5f6-4abc-9def-123456789012
```

Multiple aliases may point to the same UUID. Aliases under 4 characters must be padded with underscores on the right to reach 4 characters before computing shard levels. **Aliases are always stored and resolved in lowercase.** Applications must normalise alias input to lowercase before writing or querying, providing a case-insensitive experience to the user.

**Usage:** Read the alias file to get the UUID, then look up that UUID in the data/ folder.

### .kanecta/annotations/ — Annotations and Comments

Stores annotations (comments, thoughts, reactions) on items without modifying the items themselves. Uses the mandatory 2 + 2 + full UUID sharding, keyed by the **target item's UUID**.

**Structure:**
```
.kanecta/annotations/
└── a1/
    └── b2/
        └── a1b2c3d4-e5f6-4abc-9def-123456789012/
            ├── annotation-<uuid>.json
            └── annotation-<uuid>.json
```

Each annotation file contains:
```json
{
  "id": "annotation UUID v4",
  "targetId": "UUID of the item being annotated",
  "author": "email or domain",
  "content": "the annotation text",
  "createdAt": "ISO8601 timestamp",
  "parentAnnotationId": "UUID of parent annotation, or null for top-level"
}
```

Annotations are themselves items and can be queried, linked, and tagged. The `parentAnnotationId` field enables threaded discussions on items.

### .kanecta/config/ — Configuration

Stores configuration as JSON files.

**config.json:**
```json
{
  "owner": "user@example.com",
  "specVersion": "1.1"
}
```

- **owner**: Email or domain identifying the datastore owner. Used as the default `owner`, `createdBy`, and `modifiedBy` for new items.
- **specVersion**: Version of the Kanecta specification this datastore conforms to.

### .kanecta/history/ — Change History

Stores point-in-time snapshots of items when they are modified or deleted. Uses the mandatory 2 + 2 + full UUID sharding, keyed by item UUID.

**Structure:**
```
.kanecta/history/
└── a1/
    └── b2/
        └── a1b2c3d4-e5f6-4abc-9def-123456789012/
            ├── 2026-05-14T10-30-00.json
            ├── 2026-05-14T14-22-15.json
            └── 2026-05-15T09-10-42.json
```

Each history file contains the complete metadata.json snapshot as it existed before the change, plus:
```json
{
  "snapshotAt": "ISO8601 timestamp",
  "changedBy": "email or domain",
  "changeType": "create | update | delete"
}
```

History enables audit trails, undo operations, and understanding how decisions evolved over time.

### .kanecta/links/ — Backlinks Index Cache

Reverse index mapping items to all items that link to them. Uses the mandatory 2 + 2 + full UUID sharding, keyed by the linked item's UUID.

**Structure:**
```
.kanecta/links/
└── a1/
    └── b2/
        └── a1b2c3d4-e5f6-4abc-9def-123456789012/
            └── backlinks.json
```

**backlinks.json:**
```json
{
  "backlinks": [
    "uuid-of-item-linking-to-this",
    "uuid-of-another-item"
  ]
}
```

Used to find all references to an item before deletion and to surface "what links here" in user interfaces.

### .kanecta/relationships/ — Semantic Relationships

Stores typed relationships between items. A relationship is more than a link — it carries semantic meaning about *how* items relate. Uses the mandatory 2 + 2 + full UUID sharding, keyed by the **source item's UUID**.

**Standard Relationship Types:**

| Relationship | Meaning |
|---|---|
| `relates-to` | General association, no stronger claim |
| `depends-on` | Source requires target to exist or be true |
| `enables` | Source makes target possible |
| `contradicts` | Source and target are in conflict |
| `blocks` | Source prevents target from progressing |
| `blocked-by` | Source is prevented by target |
| `prerequisite-for` | Source must be completed before target |
| `derived-from` | Source originated from or was derived from target |
| `supersedes` | Source replaces or makes target obsolete |

Implementations may define additional relationship types as needed.

**Structure:**
```
.kanecta/relationships/
└── a1/
    └── b2/
        └── a1b2c3d4-e5f6-4abc-9def-123456789012/
            └── relationships.json
```

**relationships.json:**
```json
{
  "outbound": [
    {
      "targetId": "UUID of target item",
      "type": "depends-on",
      "createdAt": "ISO8601 timestamp",
      "createdBy": "email or domain",
      "note": "Optional context for this relationship"
    }
  ]
}
```

A parallel inbound index is maintained in `.kanecta/relationships/` under the **target's** UUID path, listing items that have relationships pointing to it.

### .kanecta/remotes/ — Cached Remote Items

Stores copies of items owned by other users. Uses identical 2 + 2 + full UUID sharding to data/.

Remote items use the same metadata schema as local items. The `cachedAt` field is required for items stored in remotes/.

### .kanecta/remotes-index/ — Remote Owner Index

**Source of truth: [`./file-specs/items.json`](./file-specs/items.json)** (shared schema with the type-to-items and tag indexes)

Maps owners to their cached items. Uses the mandatory 2 + 2 + full sharding pattern, keyed by the owner identifier string.

**Structure:**
```
.kanecta/remotes-index/
└── us/
    └── er/
        └── user@example.com/
            └── items.json
```

**items.json:**
```json
{
  "items": [
    "uuid-of-item-1",
    "uuid-of-item-2"
  ]
}
```

This allows fast lookup of "give me everything cached from this owner" without scanning the full remotes/ tree.

### .kanecta/search/ — Search Index Cache

Output folder for the search library (MeiliSearch, Lunr, custom implementation, etc.). Automatically managed by the indexing tool. Should not be edited manually.

### .kanecta/tags/ — Tag Index Cache

**Source of truth: [`./file-specs/items.json`](./file-specs/items.json)** (shared schema with the type-to-items index)

Reverse index mapping tag names to all items carrying that tag. Uses the mandatory 2 + 2 + full sharding pattern, keyed by tag name.

**Structure:**
```
.kanecta/tags/
└── se/
    └── cu/
        └── security-related/
            └── items.json
```

**items.json:**
```json
{
  "items": [
    "uuid-of-item-1",
    "uuid-of-item-2"
  ]
}
```

This enables fast queries like "show me all items tagged `performance-critical`" without scanning the data/ tree.

### .kanecta/app/ — Application UI Storage

The `app/` directory is reserved for application-layer UI storage. It is **not** part of the core data specification and does not follow the UUID sharding convention. Each application stores its state under a namespaced subdirectory: `app/<app-name>/`.

This separation keeps UI concerns isolated from datastore data, ensuring the core data directories remain clean and application-agnostic.

#### app/studio/ — kanecta-app-studio

`app/studio/` is the namespace for [kanecta-app-studio](https://github.com/kanecta/kanecta-app-studio). Applications should create their directory and any required files on startup if they do not already exist.

##### app/studio/history/

Stores per-session navigation and clipboard history as CSV files.

```
.kanecta/app/studio/history/
├── clipboard.csv
└── viewed.csv
```

**clipboard.csv** — items whose UUID the user explicitly copied to the clipboard.  
**viewed.csv** — items the user navigated into (zoomed).

Both files use the same CSV format with no header row:

```
id,name,type,typeId,timestamp
```

| Column | Description |
|---|---|
| `id` | UUID v4 of the item |
| `name` | Display value of the item at time of recording (commas replaced with spaces) |
| `type` | Primitive type string (e.g. `text`, `note`, `task`) or `object` for custom-typed items |
| `typeId` | UUID of the type definition if `type` is `object`; empty string otherwise |
| `timestamp` | ISO8601 timestamp of the event |

Each file is capped at 100 entries. When the cap is exceeded, the oldest entries are removed. Rows are stored oldest-first; UIs should reverse the list for most-recent-first display.

### .kanecta/types/ — Type Definitions and Index Cache

The `types/` folder serves two purposes:

1. **Type definitions** — each custom type has a `metadata.json` and a `type.json` describing its schema
2. **Type-to-items index cache** — reverse index mapping type UUIDs to all items of that type

Both use the mandatory 2 + 2 + full UUID sharding, keyed by type UUID.

#### Type Definitions

**Sources of truth: [`./file-specs/metadata.json`](./file-specs/metadata.json) (metadata.json), [`./file-specs/type.json`](./file-specs/type.json) (type.json), [`./file-specs/object.json.md`](./file-specs/object.json.md) (object.json), [`./file-specs/meta.json.md`](./file-specs/meta.json.md) (meta.json)**

Each custom type is stored as a pair of files under its UUID shard path.

**Structure:**
```
.kanecta/types/
└── a1/
    └── b2/
        └── a1b2c3d4-e5f6-4abc-9def-123456789012/
            ├── metadata.json
            ├── type.json
            └── items.json      ← index cache (see below)
```

**metadata.json** — same schema as a data item `metadata.json`, but with `type` set to `"type"` and `value` set to the capitalised type name (e.g. `"Person"`):
```json
{
  "id": "a1b2c3d4-e5f6-4abc-9def-123456789012",
  "parentId": "...",
  "value": "Person",
  "type": "type",
  "owner": "user@example.com",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "modifiedAt": "2026-01-01T00:00:00.000Z"
}
```

**type.json** — the type definition. Exactly three top-level keys: `meta` (all type metadata and cross-references), `jsonSchema` (the JSON Schema Draft-07 field definitions), and `sqlSchema` (the SQL DDL):
```json
{
  "meta": {
    "icon": "Person",
    "description": "A human individual as a biographical fact.",
    "details": "Longer description of this type, when to use it, and how it relates to other types.",
    "keywords": "human individual biography name",
    "tags": "people,biography,individual",
    "skills": {
      "claude": "Use this type for any individual human being."
    },
    "functions": [],
    "sync": ["a9d78f4f-a7b3-477a-a1d6-f5fb99de1067"],
    "supersededBy": [],
    "implements": [],
    "extends": [],
    "immutable": false
  },
  "jsonSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$id": "https://kanecta.org/types/person",
    "title": "Person",
    "type": "object",
    "properties": {
      "name": { "x-id": "550e8400-e29b-41d4-a716-446655440000", "type": "string", "description": "Full name" }
    },
    "required": ["name"]
  },
  "sqlSchema": [
    "CREATE TABLE \"obj_<type-uuid-with-underscores>\" (\n    item_id UUID NOT NULL,\n    \"name\" TEXT,\n    CONSTRAINT \"pk_obj_...\" PRIMARY KEY (item_id),\n    CONSTRAINT \"fk_obj_..._item\" FOREIGN KEY (item_id) REFERENCES items(id)\n)"
  ]
}
```

**meta fields:**

| Field | Description |
|---|---|
| `icon` | MUI icon key (e.g. `"Person"`) for display in the UI |
| `description` | One-sentence summary shown in type lists (required) |
| `details` | Longer description: when to use this type and how it relates to others |
| `primaryField` | Dot-separated path to the field in `jsonSchema.properties` that best represents an item of this type (e.g. `"name"`, `"title"`). Used by UIs to surface the most meaningful value |
| `keywords` | Space-separated keywords for search and filtering |
| `tags` | Comma-separated tags for grouping |
| `skills.claude` | Guidance for Claude on when and how to use this type |
| `functions` | Array of UUIDs of `function`-primitive items associated with this type |
| `sync` | Array of UUIDs of `function`-primitive items that can sync instances of this type from their original/external source (e.g. re-fetch a `Repository` from GitHub) |
| `supersededBy` | Array of UUIDs of type definitions that replace this one — Kanecta types are immutable, so a changed shape always means a new type |
| `implements` | Array of UUIDs of types whose shape/contract this type fulfils (interface-style compatibility claim, not storage inheritance) |
| `extends` | Array of UUIDs of types this type extends/specialises (declared relationship, not storage inheritance) |
| `immutable` | When `true`, the type's contract (`jsonSchema`, `sqlSchema`, `meta.primaryField`) is sealed and enforced by `hash`. Cosmetic meta fields may still be updated. A sealed type needing a contract change must be replaced with a new type UUID and `supersededBy` set |
| `hash` | Hex-encoded SHA-256 computed over the contract fields: `jsonSchema` + `sqlSchema` + `meta.primaryField` (keys sorted). Covers exactly what consumers depend on — cosmetic meta fields are excluded |

#### Type Lifecycle

Kanecta types are designed to start permissive and graduate to a published contract, without ever forcing in-place mutation.

**1. Open (mutable draft)**
When a type is first created, `meta.immutable` is absent or `false`. The author can freely edit the type's shape — add, remove, or rename fields in `jsonSchema`, update `sqlSchema`, change any `meta` field. Other users who depend on an open type are implicitly warned that the shape may still change.

**2. Immutable (published contract)**
Setting `meta.immutable: true` is a promise: *this type's contract will not change*. The tooling enforces this by computing `meta.hash` — a SHA-256 over the three contract fields: `jsonSchema`, `sqlSchema`, and `meta.primaryField` (keys sorted, no trailing whitespace) — at the time `immutable` is set. Any subsequent write that would alter those fields is rejected if the hash no longer matches. Cosmetic `meta` fields (`description`, `icon`, `skills`, `keywords`, etc.) may still be updated after sealing — they do not affect consumers. Consumers who see `immutable: true` can safely depend on the type's field definitions and SQL layout.

Because types are immutable once sealed, Kanecta metadata files have **no `version` field** — there is nothing to version. A type that changes shape is simply a new type with a new UUID.

**3. Superseded**
If the author later decides the sealed type needs a shape change, they:
1. Create a new type (same name is fine; it will have a different UUID).
2. Set `meta.supersededBy: ["<new-type-uuid>"]` on the old type.
3. Register a converter function in `meta.functions` — a function that accepts the old type and produces the new one (or vice versa). A converter can be a deterministic function, a TypeScript function wrapping an AI call, or a pure AI skill — Kanecta makes no distinction.

Subscribers to the old type (items or type consumers) receive a notification and can decide whether and when to upgrade. The old type remains readable and usable indefinitely; `supersededBy` is a suggestion, not a forced migration.

**Types as items**
Types are first-class Kanecta items — they have a `metadata.json` just like any other item, with `type: "type"`. This means types can themselves be subscribed to, linked, tagged, annotated, and related just like any other item.

**Freeform extension via tree children**
Every item of a custom type can have freeform tree children (primitive items: `text`, `heading`, `markdown`, etc.) as a third dimension alongside the type's defined fields. This lets users attach notes, context, or unstructured content to any typed item without widening the type's contract. These children are "off-API" — not part of the type's schema promise, not covered by converters or visual components, and not guaranteed to survive a type migration.

The `$id` in `jsonSchema` should follow the pattern `https://kanecta.org/types/{slug}`.

**Kanecta types are flat — exactly one level deep.** Each property in `jsonSchema.properties` must carry a stable `"x-id"` UUID (e.g. `"x-id": "550e8400-..."`) alongside its type definition. This UUID is the field's permanent identity — it survives renames and is the canonical reference used by migrations, sync adapters, and converters. Each property must also be one of:
- a **primitive** (`string`/`number`/`integer`/`boolean`, optionally with `format` such as `date`, `date-time`, `uuid`)
- an **array of primitives** (`{ "type": "array", "items": { "type": "<primitive>" } }`)
- a **reference to another standalone type**, written as `{ "type": "string", "format": "uuid", "typeId": "<type-uuid>" }` — reusing the same `typeId` convention as `metadata.json` and `function.json.parameters[]` (deliberately *not* JSON Schema's `$ref`, which would incorrectly imply the value is validated against the referenced type's full shape, when the value is actually just a UUID pointer to it)

Inline nested objects and arrays of objects are **not permitted**. A reusable nested concept (e.g. a `Person` having a favourite `Pet`) must be modelled as its own standalone type and referenced via `typeId`, never inlined. This guarantees every type maps to exactly one SQL table — see `sqlSchema` below.

**sqlSchema** is an ordered array of complete SQL DDL statements (PostgreSQL dialect) that, run in order against a database that already contains the `items` table, create *everything* needed to store instances of this type — the table, its FK relationships/constraints, and indexes. It is required for every type, even one that currently only lives in a filesystem-mode datastore, so that migrating to a SQL backend later never requires retrofitting schemas onto existing types. Kanecta types are immutable — a changed shape means a new type, never an edited `sqlSchema` — so it is defined once, at type-creation time, and never altered.

`sqlSchema` is author-defined (typically by a UI flow or Claude, generating `jsonSchema` and `sqlSchema` together), not inferred from `jsonSchema` at runtime. Because types are flat, the mapping is now mechanical and near 1:1: each primitive property → a native column, each array-of-primitives property → a native array column, each `typeId` reference property → a `UUID` column with an FK to `items(id)`. The convention is to name the table `obj_<type-uuid-with-hyphens-replaced-by-underscores>` and name columns to match `jsonSchema` property names, so the correspondence between a JSON instance and its SQL row is unambiguous from naming alone. See [`specification.db.postgres.md`](./extended-specs/specification.db.postgres.md) for the full design rationale and worked examples.

When a data item uses a custom type, its `metadata.json` sets `type: "object"` and `typeId` to the type definition UUID.

#### Type-to-Items Index Cache

**Source of truth: [`./file-specs/items.json`](./file-specs/items.json)**

Reverse index mapping type UUIDs to all items of that type. Lives alongside `metadata.json` and `type.json` in the same shard folder.

**items.json:**
```json
{
  "items": [
    "uuid-of-item-1",
    "uuid-of-item-2"
  ]
}
```

---

## 2. Link Syntax

Items can reference other items in two ways:

### Field-Level Addressing

A specific field on a specific item can be addressed using dot notation:

```
[item-uuid].[field-x-id]
```

where `field-x-id` is the `x-id` UUID of a property in the item's type's `jsonSchema.properties`. This allows a UI to jump directly to a field, highlight a cell in a table, or use a field value as the target of a formula — without needing any additional lookup table.

A field reference can also be assigned its own stable UUID on demand (see [`.kanecta/fields/`](#kanectafields--field-uuid-mappings)). Once created, this UUID is permanent for the lifetime of the item and can itself be aliased.

**Resolution order** for any identifier passed to the datastore:

| Input form | Resolution |
|---|---|
| `[uuid].[uuid]` (dot notation) | Parse directly: look up item by first UUID, resolve field by `x-id` (second UUID) from the item's type — no index needed |
| bare UUID | Try `data/` (item) first; fall through to `fields/` if not found |
| non-UUID string | Try `aliases/` first |

This ordering means common paths (direct item UUID, human-readable alias) pay no extra cost, and field-ref UUIDs are only checked when nothing else matches.

### Inline Links

Within the `value` field, use double square brackets to create links:

```
This is my note about [[a1b2c3d4-e5f6-4abc-9def-123456789012]].
```

The UI renders this as a clickable link. The UUID can be resolved to its actual content.

### Symlinks

Create an item with `type` set to `symlink` and `value` containing the target UUID:

```json
{
  "id": "symlink-uuid",
  "type": "symlink",
  "value": "target-uuid",
  "parentId": "parent-uuid"
}
```

When displayed, the symlink resolves to show the target item's content while preserving its own position in the tree.

---

## 3. Business Rules for Operations

### Creating Items

1. Generate a new UUID v4 for the item.
2. Compute the shard path: first 2 chars / next 2 chars / full UUID.
3. Create folder at `.kanecta/data/[shard1]/[shard2]/[full-uuid]/`.
4. Create `metadata.json` with required fields populated:
   - `id`: The generated UUID
   - `type`: The item's type
   - `owner`, `createdBy`, `modifiedBy`: Datastore owner from config (unless overridden)
   - `sortOrder`: Default to 0 or next available among siblings
   - `createdAt`, `modifiedAt`: Current ISO8601 timestamp
5. **Index updates:**
   - If type is `object`, add UUID to `.kanecta/types/[type-uuid]/items.json`
   - If owner differs from datastore owner, add to `.kanecta/remotes-index/[owner-shard]/items.json`
   - For each `[[uuid]]` in `value`, add entry to `.kanecta/links/[target-uuid]/backlinks.json`
   - For each tag, add UUID to `.kanecta/tags/[tag-shard]/items.json`
6. Update search index via search library.
7. Snapshot the new metadata to `.kanecta/history/[item-shard]/<timestamp>.json` with `changeType: create`.

### Updating Items

1. Snapshot current metadata to `.kanecta/history/[item-shard]/<timestamp>.json` with `changeType: update` **before** modifying.
2. Update `modifiedAt` to current timestamp and `modifiedBy` to current actor.
3. Modify `metadata.json` in place.
4. **If `value` changes:**
   - Parse for new `[[uuid]]` links; add to corresponding `backlinks.json`
   - Remove old backlinks no longer referenced
5. **If `type` changes:**
   - Remove UUID from old type's `items.json`
   - Add to new type's `items.json`
6. **If `parentId` changes:**
   - Update parent reference
   - Recompute `sortOrder` among new siblings if needed
7. **If `tags` change:**
   - Remove UUID from removed tags' `items.json`
   - Add UUID to new tags' `items.json`
8. Update search index.

### Deleting Items

1. Check `.kanecta/links/[item-shard]/backlinks.json` for inbound references.
2. Check `.kanecta/relationships/[item-shard]/relationships.json` for inbound relationships.
3. Warn user if any references exist; require explicit confirmation.
4. Snapshot current metadata to `.kanecta/history/[item-shard]/<timestamp>.json` with `changeType: delete`.
5. Remove the item's folder from `.kanecta/data/`.
6. **Index cleanup:**
   - Remove from type index
   - Remove from remotes-index if remote
   - Remove from all tag indexes the item appeared in
   - Remove all backlinks entries pointing **to** this item
   - Remove all relationship entries pointing **to** this item
   - Remove all annotations targeting this item (or orphan them, per implementation)
   - Read `data/[item-shard]/fields.json`; delete every listed entry from `fields/`; delete `fields.json`
   - Remove from search index

### Reading Items

**Resolving an identifier:**

1. **Dot notation** (`[uuid].[uuid]`): parse the two UUIDs; look up item by the first; resolve field by `x-id` (second UUID) from the item's type. No index is consulted.
2. **Bare UUID:** compute shard path and read `metadata.json` from `data/`. If not found, check `fields/` for a field-level UUID.
3. **Non-UUID string:** read the alias file from `aliases/` to get a UUID, then apply rule 2.

**Other read operations:**

4. **Query by type:** Read `.kanecta/types/[type-shard]/items.json`.
5. **Query by tag:** Read `.kanecta/tags/[tag-shard]/items.json`.
6. **Query by owner:** Read `.kanecta/remotes-index/[owner-shard]/items.json`.
7. **Search:** Query search index for text matches.
8. **Backlinks:** Read `.kanecta/links/[item-shard]/backlinks.json`.
9. **Relationships:** Read `.kanecta/relationships/[item-shard]/relationships.json`.
10. **History:** List files in `.kanecta/history/[item-shard]/` for change timeline.
11. **Annotations:** List files in `.kanecta/annotations/[item-shard]/` for comments on an item.

### Datastore Initialisation

When a lib or CLI opens a datastore for the first time and finds it empty, it must create the well-known root nodes before any user interaction:

1. Create the `root` item:
   - `id`: `00000000-0000-0000-0000-000000000000`
   - `parentId`: `00000000-0000-0000-0000-000000000000` (self)
   - `type`: `root`
   - `value`: `"root"`
   - `sortOrder`: 0
2. Create `system_root`, `app_root`, `component_root`, `data_root` as children of root, in that order:
   - `parentId`: `00000000-0000-0000-0000-000000000000`
   - `type`: the respective type name
   - `value`: the respective type name
   - `sortOrder`: 0, 1, 2, 3 respectively
3. Record history entries (`changeType: create`) for each.

### Tree Traversal

1. Navigate directly to root using its known ID: `00000000-0000-0000-0000-000000000000`.
2. Find the child of root with `type: data_root`.
3. Starting from `data_root`, find all items with `parentId` matching the current item's `id` **and `aspect` matching the active aspect** (default: `null`).
4. Sort siblings by `sortOrder` (scoped to the active aspect).
5. Recursively build the tree.

User data lives exclusively under `data_root`. Items under `system_root`, `app_root`, and `component_root` are reserved for internal use and are not shown in the user-facing tree.

**Aspects:** A traversal always targets exactly one aspect. The default aspect is `null` (the main tree). To view a different dimension, the caller specifies an aspect string and only children with that `aspect` value are returned. Children in other aspects are invisible to that traversal — they are not hidden, just not in scope.

### Creating Relationships

1. Append to `.kanecta/relationships/[source-shard]/relationships.json` under `outbound`.
2. Append the inverse entry to `.kanecta/relationships/[target-shard]/relationships.json` under `inbound`.
3. Both entries include `createdAt`, `createdBy`, and optional `note`.

### Adding Annotations

1. Generate a new UUID v4 for the annotation.
2. Create the annotation file at `.kanecta/annotations/[target-shard]/annotation-<uuid>.json`.
3. Annotations do not modify the target item's `metadata.json`.
4. Annotations may themselves have annotations (threaded discussion).

### Caching Remote Items

1. Fetch the item from the remote owner.
2. Store at `.kanecta/remotes/[shard]/[full-uuid]/metadata.json`.
3. Set `cachedAt` to current timestamp.
4. If subscribing, set `subscribedAt` and `subscriptionSource`.
5. Add UUID to `.kanecta/remotes-index/[owner-shard]/items.json`.

### Updating Search Index

On every create, update, or delete:
1. Call the search library's update function.
2. Index the item's `value`, `tags`, and queryable metadata fields.
3. The search library manages the `.kanecta/search/` folder.

---

## 4. Constraints and Assumptions

- UUIDs are UUID v4 and globally unique across all installations.
- `parentId` is non-nullable for every item. The only self-referential item is `root` (`parentId` equals its own `id`). All other items must have a `parentId` that resolves to an existing item.
- Circular `parentId` chains (other than the root self-reference) are not permitted. Applications must validate before inserting.
- The five well-known root types (`root`, `system_root`, `app_root`, `component_root`, `data_root`) are singletons. Each may appear exactly once in a datastore. Implementations must reject creation of a second instance of any well-known type.
- The `root` ID (`00000000-0000-0000-0000-000000000000`) is reserved. No user-created item may use this ID.
- All keyed folder structures in `.kanecta/` use the mandatory 2 + 2 + full sharding pattern. No alternative layout is permitted.
- Aliases should be unique within a datastore (not enforced at the filesystem level; applications should validate). Aliases are always lowercase; applications must normalise to lowercase before writing or resolving.
- Circular links via `[[uuid]]` and relationships are allowed but should be detected and handled by UIs.
- Symlinks can point to items owned by other users (via remotes/).
- File system operations are atomic enough for single-user scenarios; multi-user synchronization requires additional logic (changelogs, conflict resolution).
- Parent-child relationships are enforced in metadata, not filesystem structure.
- Index caches (`tags/`, `types/`, `links/`, `relationships/`, `remotes-index/`, `search/`) are derivable from `data/` and can be rebuilt at any time. Only `data/`, `history/`, `annotations/`, `aliases/`, `remotes/`, `fields/`, and `config/` are authoritative.
- Field-ref entries (`fields/`) are permanent for the lifetime of their parent item. Implementations must cascade-delete all fields for an item when that item is deleted, and must never delete a field-ref while the item exists. The `(itemId, fieldXId)` pair is unique — creating a field-ref for the same pair twice returns the existing UUID.

---

## 5. Future Extensibility

- **Access control**: `visibility` (`private`/`organisation`/`public`, see [Field Definitions](#field-definitions)) is the coarse, no-lookup fast path; fine-grained per-principal `read`/`write`/`subscribe` grants layer on top (modelled in postgres as `item_grants` — see `specification.db.postgres.md`). Grants are stored as plain `(item, permission, principal)` tuples with opaque principal UUIDs — deliberately the same shape a relationship-based access control (ReBAC / Zanzibar-style) system uses, so that group membership, cascading grants down a subtree, and permission-hierarchy resolution can all be layered on as graph traversals over the existing data later, without reshaping what's already stored. Principals are not assumed to be Kanecta items or tied to any specific identity provider (e.g. Keycloak) — identity sources can change without rewriting grants.
- **Sync**: `.kanecta/sync/` for tracking remote changes and changelogs
- **Templates**: `.kanecta/templates/` for reusable item templates
- **Changelog**: Append-only operation log for efficient multi-user sync
- **Reactions**: Lightweight emoji-style reactions distinct from annotations
- **Encrypted items**: Per-item encryption for sensitive data within shared datastores

---

## Notes

- This specification describes the format at rest and the operations that maintain consistency.
- Any application reading or writing Kanecta datastores must follow these business rules.
- The specification is versioned; datastores declare their conformance version in `config.json`.
- The protocol is intentionally designed to serve as a human-AI bridge: structured enough for machines to reason about, transparent enough for humans to audit.
