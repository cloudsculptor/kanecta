# Kanecta Datastore Specification (File system)

**Version:** 1.2.0
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
  "license": "string or null",
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
  "subscriptionSource": "string or null"
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
| `license` | no | License identifier (MIT, Apache-2.0, CC-BY, etc.) or null |
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

### Item Types

**Source of truth: [`./types/primitive.json`](./types/primitive.json)**

All valid `type` values are defined in `./types/primitive.json`. Implementations must treat that file as authoritative — do not hardcode the type list.

Types are grouped into three categories:

| Category | Description | Types |
|---|---|---|
| **primitive** | Basic value containers with no domain-specific meaning | `string`, `number`, `text`, `heading`, `file`, `symlink`, `url`, `image`, `function` |
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

Multiple aliases may point to the same UUID. Aliases under 4 characters must be padded with underscores on the right to reach 4 characters before computing shard levels.

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

**type.json** — the type definition, containing display metadata under `meta` and a JSON Schema under `jsonSchema`:
```json
{
  "meta": {
    "icon": "Person",
    "description": "A human individual as a biographical fact.",
    "details": "Longer description of this type, when to use it, and how it relates to other types.",
    "ai-instructions": {
      "claude": "Use this type for any individual human being."
    },
    "keywords": "human individual biography name",
    "tags": "people,biography,individual"
  },
  "jsonSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$id": "https://kanecta.org/types/person",
    "title": "Person",
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "Full name" }
    },
    "required": ["name"]
  }
}
```

**meta fields:**

| Field | Description |
|---|---|
| `icon` | MUI icon key (e.g. `"Person"`) for display in the UI |
| `description` | One-sentence summary shown in type lists |
| `details` | Longer description: when to use this type and how it relates to others |
| `primaryField` | Dot-separated path to the field in `jsonSchema.properties` that best represents an item of this type (e.g. `"name"`, `"title"`, `"address.street"`). Used by UIs to surface the most meaningful value. |
| `ai-instructions.claude` | Guidance for Claude on when and how to use this type |
| `keywords` | Space-separated keywords for search and filtering |
| `tags` | Comma-separated tags for grouping |

The `$id` in `jsonSchema` should follow the pattern `https://kanecta.org/types/{slug}`.

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
   - Remove from search index

### Reading Items

1. **UUID lookup:** Compute shard path; read `metadata.json` directly.
2. **Alias lookup:** Read alias file to get UUID, then perform UUID lookup.
3. **Query by type:** Read `.kanecta/types/[type-shard]/items.json`.
4. **Query by tag:** Read `.kanecta/tags/[tag-shard]/items.json`.
5. **Query by owner:** Read `.kanecta/remotes-index/[owner-shard]/items.json`.
6. **Search:** Query search index for text matches.
7. **Backlinks:** Read `.kanecta/links/[item-shard]/backlinks.json`.
8. **Relationships:** Read `.kanecta/relationships/[item-shard]/relationships.json`.
9. **History:** List files in `.kanecta/history/[item-shard]/` for change timeline.
10. **Annotations:** List files in `.kanecta/annotations/[item-shard]/` for comments on an item.

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
3. Starting from `data_root`, find all items with `parentId` matching the current item's `id`.
4. Sort siblings by `sortOrder`.
5. Recursively build the tree.

User data lives exclusively under `data_root`. Items under `system_root`, `app_root`, and `component_root` are reserved for internal use and are not shown in the user-facing tree.

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
- Aliases should be unique within a datastore (not enforced at the filesystem level; applications should validate).
- Circular links via `[[uuid]]` and relationships are allowed but should be detected and handled by UIs.
- Symlinks can point to items owned by other users (via remotes/).
- File system operations are atomic enough for single-user scenarios; multi-user synchronization requires additional logic (changelogs, conflict resolution).
- Parent-child relationships are enforced in metadata, not filesystem structure.
- Index caches (`tags/`, `types/`, `links/`, `relationships/`, `remotes-index/`, `search/`) are derivable from `data/` and can be rebuilt at any time. Only `data/`, `history/`, `annotations/`, `aliases/`, `remotes/`, and `config/` are authoritative.

---

## 5. Future Extensibility

- **Permissions**: Read/write/admin permission lists per item or subtree
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
