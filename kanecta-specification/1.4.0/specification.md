# Kanecta Specification v1.4.0

**Version:** 1.4.0  
**License:** MIT — © 2026 Richard Thomas  
**Status:** Active

---

## Overview

Kanecta is an open-source, local-first personal and organisational knowledge graph. Data is stored as a tree of items with globally unique identifiers, enabling flexible organisation, semantic linking, typed structured data, access control, full-text search, and semantic (vector) search. The protocol is designed as a human-AI bridge: structured enough for AI to reason about efficiently, transparent enough for humans to read and audit.

**Design philosophy:**
- Local-first — data lives on your device, sync is optional
- Human-readable — every item is a JSON file a human can open and understand
- Adapter-agnostic — the same data model maps to filesystem, SQLite, and Postgres without loss
- Open-ended — type systems, external vocabularies, and storage backends are all extensible

---

## What Changed in 1.4.0

v1.4.0 is a breaking change from v1.3.0. A migration script is provided in `kanecta-migrations/1.4.0/`.

| Change | Detail |
|---|---|
| **Single item.json** | Replaces `metadata.json` + `function.json` + `type.json` + `object.json`. Every item is one file. |
| **Four-section structure** | `item` / `meta` / `search` / `payload` — maps directly to four database tables. |
| **`parentId` always required** | No item is parentless. Root is self-referencing with all-zeros UUID. |
| **Typed objects: parentId → type UUID** | Typed objects live under their type item, not scattered in the tree. |
| **`file` replaces `image` and `markdown`** | `type: "file"` + `payload.mimeType` covers all file-backed content. |
| **`relationship` items** | Typed, first-class relationships alongside the existing inline `[[uuid]]` link syntax. |
| **`grant` items** | Per-item access control with ReBAC support. |
| **`component` type** | React component definitions with typed props. |
| **`tree` and `node` types** | Support for multiple named trees beyond the built-in one. |
| **`embedding` in `search`** | Semantic search metadata; float vector lives in `embedding.bin` sidecar. |
| **`sameAs`** | Map items and types to external type systems (schema.org, Wikidata, etc.). |
| **`searchFields`** | Type-level control over what goes into the full-text search corpus. |
| **`files` map** | Explicit sidecar file map replacing implicit file conventions. |
| **Provenance fields** | `ownerDomain`, `namespace`, `copyrightHolder`, `contentHash`, `mirrors`. |

---

## 1. Directory Structure

```
datastore/
└── .kanecta/
    ├── data/           ← all items (source of truth)
    ├── config/         ← datastore configuration
    ├── history/        ← point-in-time item snapshots
    ├── aliases/        ← human-readable shortcuts → UUIDs
    ├── annotations/    ← comments and reactions on items
    ├── links/          ← backlinks index cache
    ├── remotes/        ← cached copies of remote items
    ├── remotes-index/  ← owner → remote items index
    └── search/         ← search index cache (managed by adapter)
```

All keyed folders use **mandatory 2+2+full UUID sharding**: first 2 chars / next 2 chars / full UUID with hyphens.

Example for UUID `a1b2c3d4-e5f6-4abc-9def-123456789012`:
```
.kanecta/data/a1/b2/a1b2c3d4-e5f6-4abc-9def-123456789012/
```

---

## 2. The item.json Format

Every item is a single `item.json` file. No other JSON files exist in an item folder (sidecars are allowed — see [Files and Sidecars](#files-and-sidecars)).

### Four Sections

```json
{
  "item":    { ... },
  "meta":    { ... },
  "search":  { ... },
  "payload": { ... }
}
```

These map directly to four database tables in SQLite and Postgres adapters:

| Section | DB table | Purpose |
|---|---|---|
| `item` | `items` | Identity and tree position. All you need to render a tree or list. |
| `meta` | `items_meta` | Provenance, ownership, bookkeeping. Loaded on demand. |
| `search` | `items_search` | FTS and semantic search metadata. Managed by adapter. |
| `payload` | `items_payload` | Type-specific content. Loaded when item is opened. |

### 2.1 The `item` Section

Six fields. Always a short string for `value` (≤255 chars, stored `VARCHAR(255)` in databases).

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | UUID | yes | UUID v4 of this item. |
| `parentId` | UUID | yes | UUID of the parent item. Never null — see [parentId Rules](#parentid-rules). |
| `type` | string | yes | Item type. See [Item Types](#3-item-types). |
| `typeId` | UUID \| null | yes | UUID of the custom type definition. Set when `type` is `"object"`. Null otherwise. |
| `value` | string \| null | yes | Display label. Always a short string (≤255 chars). For typed objects this is the `primaryField` value, computed and cached at write time. |
| `sortOrder` | number \| null | no | Numeric sort position among siblings, scoped per aspect. |

### parentId Rules

- `parentId` is always required. No item is parentless.
- The **root** item is self-referencing: `id = parentId = "00000000-0000-0000-0000-000000000000"` (the well-known all-zeros UUID).
- **Typed objects** (`type: "object"`) use their type item's UUID as `parentId` — they live in the type's collection, not scattered through the tree. Symlinks place them contextually in the tree wherever they are needed.
- **Free-form items** use their tree parent's UUID.
- Circular `parentId` chains (other than the root self-reference) are not permitted.

### 2.2 The `meta` Section

All provenance, ownership, operational, and bookkeeping fields.

| Field | Type | Required | Description |
|---|---|---|---|
| `specVersion` | string | yes | e.g. `"1.4.0"`. Used by tooling for schema/migration selection. |
| `owner` | string | yes | Email or team alias of the item owner. Not necessarily the legal rights holder — see `copyrightHolder`. |
| `ownerDomain` | string \| null | no | Home Kanecta instance domain (e.g. `"kanecta.acme.com"`). Used to refresh cached copies. |
| `namespace` | string \| null | no | Slash-separated org hierarchy path (e.g. `"acme.com/engineering"`). Used for access control scoping and display grouping. |
| `copyrightHolder` | string \| null | no | Legal copyright holder. Null = same as owner. |
| `license` | UUID | yes | UUID reference to the item's licence. Defaults to All Rights Reserved. |
| `contentHash` | string \| null | no | SHA-256 of canonical content (all fields except contentHash, keys sorted). Used to verify integrity and detect staleness. |
| `mirrors` | string[] | no | Mirror domains advertised by the owner. Consumers verify against `contentHash`; `ownerDomain` remains canonical. |
| `sameAs` | URI[] | no | URIs mapping this item or type to concepts in external type systems. See [External Type Systems](#external-type-systems). |
| `visibility` | `"private"` \| `"organisation"` \| `"public"` | yes | Coarse access level. Fine-grained grants layer on top via grant items. |
| `aspect` | string \| null | no | Dimension this item occupies under its parent. `null` = main tree. Any string names an alternative dimension (`"grants"`, `"settings"`, `"archive"`). |
| `confidence` | string \| null | no | One of: `experimental`, `exploring`, `decided`, `locked`, `low`, `medium`, `high`, `verified`. |
| `status` | string \| null | no | Free-form status string (e.g. `"active"`, `"archived"`, `"draft"`). |
| `tags` | string[] | no | Tags. Always included in the FTS corpus alongside `item.value`. |
| `template` | UUID \| null | no | UUID of the type or item this item's tree was copied from via templating. |
| `createdAt` | ISO 8601 | yes | Creation timestamp. |
| `modifiedAt` | ISO 8601 | yes | Last modification timestamp. |
| `createdBy` | string \| null | no | Actor who created this item. |
| `modifiedBy` | string \| null | no | Actor who last modified this item. |
| `completedAt` | ISO 8601 \| null | no | When this item was marked completed. |
| `dueAt` | ISO 8601 \| null | no | Due date. |
| `cachedAt` | ISO 8601 \| null | no | When remote content was last cached locally. |
| `subscribedAt` | ISO 8601 \| null | no | When this item subscribed to a remote source. |
| `subscriptionSource` | string \| null | no | URI of the remote source. |
| `files` | object | no | Sidecar file map. See [Files and Sidecars](#files-and-sidecars). |

### 2.3 The `search` Section

Full-text and semantic search metadata. Null if not yet computed. Managed by the adapter — never edited manually.

```json
"search": {
  "corpusHash": "sha256-...",
  "embedding": {
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "generatedAt": "2026-06-25T10:05:00Z"
  }
}
```

| Field | Description |
|---|---|
| `corpusHash` | SHA-256 of the text corpus. Adapters skip re-indexing and re-embedding when this is unchanged at write time. |
| `embedding.model` | Embedding model identifier. Must match what the adapter uses for query — mixing models produces meaningless scores. |
| `embedding.dimensions` | Float vector length (e.g. 1536, 3072). Used by adapters to validate or recreate vector columns. |
| `embedding.generatedAt` | When this embedding was generated. |

**The float vector** lives in `meta.files.embedding = "embedding.bin"` — a raw float32 binary sidecar. Adapters load it into their native vector store (pgvector for Postgres, sqlite-vec for SQLite) at item load time. Sync transfers `embedding.bin` alongside `item.json` so receiving nodes never need to call an embedding API.

**The FTS corpus** for any item is always: `item.value` + `meta.tags` + included payload fields (per type's `searchFields` setting, default all) + text content of text-based sidecars (`body.md`, `body.ts`, `body.tsx`). File sidecars are always indexed for `text/*` MIME types.

**Adapter FTS implementations:**
- SQLite: FTS5 virtual table (`items_fts`)
- Postgres: `tsvector` column with GIN index
- Filesystem: sidecar `search.db` SQLite file

### 2.4 The `payload` Section

Type-specific content. Null for primitive items that carry no structured data. Required for `function`, `type`, `grant`, `relationship`, `component`, and `file` items. Present for `object` items as a free-form key-value object validated at runtime against the type's `jsonSchema`.

Payload shapes are defined per type — see [Item Types](#3-item-types).

---

## 3. Item Types

**Source of truth: [`./types/primitive.json`](./types/primitive.json)**

Types are grouped into three categories:

### Primitive Types

Basic value containers. `payload` is null unless noted.

| Type | Description | Payload |
|---|---|---|
| `string` | A short string value. | null |
| `number` | A numeric value. | null |
| `text` | A plain text block. | null |
| `heading` | A heading or title. | null |
| `file` | Any file-backed content — images, markdown, PDFs, audio, video, code. Replaces the former `image` and `markdown` primitives. | `filePayload` (required) |
| `symlink` | A reference to another item. `item.value` contains the target UUID. | null |
| `url` | A URL. `item.value` contains the URL string. | null |
| `function` | A typed function definition with optional implementation. | `functionPayload` (required) |
| `component` | A React component definition. | `componentPayload` (required) |
| `runner` | An execution environment or script runner. | null |
| `node` | A generic node in a user-defined tree. Children of `tree` items. | null |
| `tree` | A named additional tree root. Kanecta has one built-in tree (all-zeros root). Additional trees are `tree` items. | null |

### Structured Types

Types with defined semantic intent. `payload` is null unless noted.

| Type | Description | Payload |
|---|---|---|
| `object` | An instance of a custom type definition. `item.typeId` identifies the type. | Free-form object validated against the type's `jsonSchema`. |
| `decision` | A recorded decision with context, alternatives, and reasoning. | null (content in `item.value` as a structured string) |
| `annotation` | A comment or note on another item, without modifying it. | null |
| `claim` | A factual assertion that may have a confidence level. | null |
| `question` | An open question awaiting resolution. | null |
| `task` | An actionable item with optional due date and completion tracking. | null |
| `note` | A freeform note. | null |
| `concept` | An abstract concept or idea. | null |
| `entity` | A real-world entity (organisation, product, place). | null |
| `event` | A point in time or period of activity. | null |
| `grant` | An access control grant on the parent item. Lives in the `"grants"` aspect. | `grantPayload` (required) |
| `relationship` | A typed, first-class relationship between two items. | `relationshipPayload` (required) |

### Well-Known Types

Reserved system root nodes. Created once during datastore initialisation. Never used for user data.

| Type | ID | Description |
|---|---|---|
| `root` | `00000000-0000-0000-0000-000000000000` | The universal root. Self-referencing `parentId`. |
| `system_root` | Generated UUID | System and infrastructure items. |
| `app_root` | Generated UUID | Application-layer configuration items. |
| `component_root` | Generated UUID | Kanecta component items. |
| `data_root` | Generated UUID | All user data lives here. |

---

## 4. Payload Definitions

### 4.1 filePayload

For `type: "file"`. Replaces the former `image` and `markdown` primitives — use `mimeType` to distinguish.

```json
{
  "mimeType": "image/jpeg",
  "size": 2048000,
  "width": 3840,
  "height": 2160,
  "duration": null,
  "altText": "A sunset over the harbour"
}
```

| Field | Required | Description |
|---|---|---|
| `mimeType` | yes | IANA media type (e.g. `"image/jpeg"`, `"text/markdown"`, `"application/pdf"`). See https://www.iana.org/assignments/media-types/ |
| `size` | no | File size in bytes. |
| `width` | no | Width in pixels. For `image/*` and `video/*`. |
| `height` | no | Height in pixels. For `image/*` and `video/*`. |
| `duration` | no | Duration in seconds. For `audio/*` and `video/*`. |
| `altText` | no | Accessible description. Primarily for images. |

The file content lives in a sidecar referenced via `meta.files` (e.g. `{ "body": "photo.jpg" }` or `{ "body": "body.md" }`).

### 4.2 functionPayload

For `type: "function"`. The function name lives in `item.value`.

On **filesystem and SQLite adapters**, the function body lives in a sidecar: `meta.files.body = "body.ts"`.  
On the **Postgres adapter**, `payload.body` stores it inline.

```json
{
  "description": "Fetch a user by ID.",
  "async": true,
  "ai": false,
  "parameters": [
    { "name": "id", "type": "string", "description": "User UUID." }
  ],
  "returnTypeId": "f1e2d3c4-...",
  "throws": [{ "type": "Error", "description": "If the user is not found." }],
  "dependencies": ["axios@^1.0.0"]
}
```

**Parameters** use the shared `parameterOrProp` definition — exactly one of:
- `type` — TypeScript primitive string (`string`, `number`, `boolean`, `Promise<string>`, etc.). No inline object types.
- `typeId` — UUID of a Kanecta type definition (for object-typed parameters).
- `functionId` — UUID of a Kanecta function item (for callback/higher-order function parameters).

**Return type** uses the same split: `returnType` (primitive) or `returnTypeId` (object type). One must be present.

### 4.3 componentPayload

For `type: "component"`. Describes a React component. Return type is always `ReactNode` — implicit, no field. The component body (JSX/TSX) lives in `meta.files.body = "body.tsx"`.

```json
{
  "description": "Renders a Person card.",
  "props": [
    { "name": "name", "type": "string" },
    { "name": "onEdit", "functionId": "abc123-..." }
  ],
  "dependencies": ["date-fns"]
}
```

Props use the same `parameterOrProp` definition as function parameters — including `functionId` for callback props. A type item links to its component via `payload.meta.componentId`.

### 4.4 typePayload

For `type: "type"`. Defines a custom Kanecta type. Three required keys:

```json
{
  "meta": {
    "icon": "Person",
    "description": "A human individual.",
    "primaryField": "name",
    "searchFields": ["name", "bio", "email"],
    "componentId": null,
    "functions": [],
    "sync": [],
    "supersededBy": [],
    "implements": [],
    "extends": [],
    "immutable": false
  },
  "jsonSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Person",
    "type": "object",
    "properties": {
      "name": { "x-id": "550e8400-...", "type": "string" },
      "born": { "x-id": "550e8401-...", "type": "string", "format": "date" }
    },
    "required": ["name"]
  },
  "sqlSchema": [
    "CREATE TABLE \"obj_f1e2d3c4_...\" ( item_id UUID NOT NULL, ... )"
  ]
}
```

**`meta` fields:**

| Field | Description |
|---|---|
| `icon` | MUI icon component name (e.g. `"Person"`). |
| `description` | One-sentence summary (required). |
| `details` | Longer description. |
| `keywords` | Space-separated search keywords. |
| `tags` | Comma-separated grouping tags. |
| `primaryField` | The field (or expression) that computes `item.value` for instances. Three forms: plain string path (`"name"`), object with `fields` array + optional `expression`, or object with `fields` + `functionId` (UUID of a Kanecta function item). |
| `searchFields` | Payload field names to include in the FTS corpus. Null/absent = all fields. Set to narrow (e.g. `["name", "bio"]`). |
| `componentId` | UUID of a Kanecta component item that renders instances of this type. |
| `skills.claude` | Guidance for Claude on when and how to use this type. |
| `functions` | UUIDs of associated function items. |
| `sync` | UUIDs of function items that sync instances from an external source. |
| `supersededBy` | UUIDs of type definitions that replace this one. |
| `implements` | UUIDs of types whose contract this type fulfils (interface-style). |
| `extends` | UUIDs of types this type extends or specialises (declared, not storage inheritance). |
| `immutable` | When true, the type's contract is sealed. See [Type Lifecycle](#type-lifecycle). |
| `hash` | SHA-256 over `jsonSchema` + `sqlSchema` + `primaryField`. Set when `immutable` is true. |

**`jsonSchema`:** JSON Schema Draft-07 for instances. Types are **flat — exactly one level deep**. Each property must carry a stable `"x-id"` UUID. Property types must be:
- Primitives: `string`, `number`, `integer`, `boolean` (optionally with `format`)
- Arrays of primitives
- UUID references to other Kanecta types: `{ "type": "string", "format": "uuid", "typeId": "<type-uuid>" }`

No inline nested objects. A reusable nested concept must be its own type, referenced via `typeId`.

**`sqlSchema`:** Ordered SQL DDL statements (PostgreSQL dialect) that create all storage for instances. Defined once at type creation. A changed shape is a new type.

### 4.5 relationshipPayload

For `type: "relationship"`. A typed, first-class relationship between two items.

```json
{
  "relationshipType": "evidenced-by",
  "sourceId": "abc123-...",
  "targetId": "def456-...",
  "direction": "directed"
}
```

| Field | Required | Description |
|---|---|---|
| `relationshipType` | yes | Free-form string. Standard types: `relates-to`, `depends-on`, `enables`, `contradicts`, `blocks`, `blocked-by`, `prerequisite-for`, `derived-from`, `supersedes`. Any custom type is valid. |
| `sourceId` | yes | UUID of the source item. |
| `targetId` | yes | UUID of the target item. |
| `direction` | no | `"directed"` (default) or `"bidirectional"`. |

The optional label lives in `item.value`. Relationship items coexist with the lighter-weight inline `[[uuid]]` link syntax — use relationship items when you need a typed, annotatable, or metadata-carrying link.

**Cardinality** emerges naturally from the number of relationship items — create multiple relationship items for one-to-many or many-to-many.

### 4.6 grantPayload

For `type: "grant"`. Access control grants live as children of the item they control, in the `"grants"` aspect.

Three principal forms:

```json
{ "principal": "bob@acme.com", "permissions": ["read"] }
```
```json
{ "principal": "acme.com/engineering", "permissions": ["read", "write"] }
```
```json
{ "principal": { "itemId": "group-uuid", "relation": "member" }, "permissions": ["read"], "cascade": true }
```

| Field | Required | Description |
|---|---|---|
| `principal` | yes | Identity string, namespace path, or `{itemId, relation}` object (ReBAC). |
| `permissions` | yes | Array of `"read"`, `"write"`, `"subscribe"`, `"admin"`. |
| `cascade` | no | When true, grant applies to all descendants. |

**ReBAC (relationship-based access control):** The `{itemId, relation}` principal form enables group-based access control. Groups are ordinary Kanecta items. Membership is a Kanecta relationship. Grant resolution is a graph traversal — any principal that holds the named `relation` to the named `itemId` receives the grant. No special group type is needed.

---

## 5. Files and Sidecars

Items can reference external files via the `meta.files` map — a plain object mapping semantic role names to filenames stored alongside `item.json` in the same item folder.

```json
"files": {
  "body": "body.ts",
  "embedding": "embedding.bin"
}
```

**Well-known roles:**

| Role | Used by | Description |
|---|---|---|
| `body` | `function`, `component`, `file` (markdown, text) | Source code or document body. Extension determines the language (`.ts`, `.tsx`, `.md`). |
| `image` | `file` (image) | Primary image file. |
| `file` | `file` (binary) | Attached binary file. |
| `thumbnail` | any | Preview image. |
| `embedding` | any | Float32 vector binary. Always named `embedding.bin`. |

**Multiple files:** A single item can have multiple entries in `files`. A complex component with multiple source files uses additional roles (e.g. `"styles"`, `"utils"`). Function items with multiple modules do the same.

**Adapter behaviour:**
- **Filesystem and SQLite adapters:** `files` contains sidecar filenames. Files live alongside `item.json`.
- **Postgres adapter:** Equivalent content is stored inline (body in a column, image in object storage). `files` is omitted.

**S3 and object storage:** When a Postgres adapter is paired with S3, sidecar content is stored in S3 under a key derived from the item UUID and role name. The `files` map is omitted from the DB row; the adapter constructs S3 keys deterministically.

---

## 6. Search

Kanecta supports two complementary search modes:

### 6.1 Full-Text Search (FTS)

The **search corpus** for any item is:

1. `item.value` — always included
2. `meta.tags` — always included
3. Payload fields — all by default; narrowed by the type's `searchFields` setting
4. Text-based sidecar content — `body.md`, `body.ts`, `body.tsx` always indexed for `text/*` MIME types

UUIDs, numbers, booleans, and dates are never indexed.

**Adapters:**
- SQLite: FTS5 virtual table
- Postgres: `tsvector` column + GIN index
- Filesystem: sidecar `search.db` SQLite file per datastore

### 6.2 Semantic Search (Vector)

Each item can have a semantic embedding stored in `item.search.embedding`. The float vector lives in `meta.files.embedding = "embedding.bin"` — a raw float32 binary sidecar.

**Key design decisions:**
- Metadata in `item.json` (model, dimensions, generatedAt) — portable, lightweight
- Vector in `embedding.bin` sidecar — keeps `item.json` lean, works across adapters
- Adapters load the vector into their native store at item load time
- Sync transfers `embedding.bin` alongside `item.json` — receiving nodes never need to call an embedding API
- `search.corpusHash` allows adapters to skip re-embedding when content is unchanged

**Adapters:**
- SQLite: `sqlite-vec` extension (npm: `sqlite-vec`, no system install required)
- Postgres: `pgvector` extension
- Filesystem: `sqlite-vec` sidecar database

**Hybrid search:** FTS and semantic search complement each other. FTS for precision (keyword matching), semantic for recall (meaning-based similarity). Both can be run and results merged with rank fusion.

---

## 7. Inline Links

Within `item.value` or any text field, items can reference other items using double square bracket syntax:

```
My note about [[a1b2c3d4-e5f6-4abc-9def-123456789012]].
```

The UI renders this as a clickable link resolving to the target item.

**Smart link resolution:**
- If the UUID resolves to a `relationship` item → renders as a typed link (showing the `relationshipType`)
- Otherwise → renders as a simple link

**Inline symlink** (triple brackets):
```
[[[a1b2c3d4-e5f6-4abc-9def-123456789012]]]
```
Renders the target item's content inline at that position.

**Symlink items:** For tree-position symlinks, create an item with `type: "symlink"` and `item.value` containing the target UUID. The symlink resolves to show the target's content while maintaining its own position in the tree. This is how typed objects (which `parentId` to their type) appear in the user-facing tree — a symlink sits in the tree, the actual item lives under the type.

---

## 8. External Type Systems

The `meta.sameAs` field maps a Kanecta item or type to equivalent concepts in any external type system. This makes Kanecta data interoperable with the broader semantic web without being enslaved to any one system.

```json
"sameAs": [
  "https://schema.org/Person",
  "https://www.wikidata.org/wiki/Q5",
  "urn:itis:180092"
]
```

Any type system with URIs works automatically. Systems without URIs use URN format by convention:
- `urn:itis:<id>` — ITIS taxonomic species
- `urn:icd10:<code>` — ICD-10 medical diagnosis
- `urn:cas:<number>` — CAS chemical compound registry
- `urn:naics:<code>` — North American Industry Classification

`sameAs` applies at two levels:
- **Type definition** — `"my Person type is equivalent to schema:Person"`
- **Item instance** — `"this item is Albert Einstein (wikidata:Q937)"`

The list of external type systems is open-ended and non-exhaustive. Any classification system — biological taxonomy, astronomical catalogs, legal codes — can be mapped.

---

## 9. Multiple Trees

Kanecta has one built-in tree rooted at the all-zeros UUID. Additional named trees are supported via the `tree` and `node` primitive types.

- **`tree`** — A named tree root item. Acts as the root of a separate navigation structure.
- **`node`** — A generic node in a user-defined tree.

Use cases:
- Tag hierarchies (an alternative taxonomy alongside the main tree)
- Org charts
- Topic maps
- Dependency graphs presented as trees

Items can appear in multiple trees simultaneously via symlinks. The main tree (`parentId` chain to all-zeros root) is always the canonical location.

---

## 10. Provenance and Sharing

Kanecta items are designed to be shareable as standalone portable units. The provenance fields in `meta` support this:

| Field | Purpose |
|---|---|
| `ownerDomain` | Where to query for the canonical/updated version of this item. |
| `namespace` | Org hierarchy for scoping and routing. |
| `copyrightHolder` | Legal rights holder (often the company, not the individual `owner`). |
| `contentHash` | SHA-256 for integrity verification. A recipient can detect tampering or staleness by recomputing and comparing. |
| `mirrors` | Owner-advertised alternative fetch locations. Consumers may use any mirror but verify against `contentHash`. `ownerDomain` is always canonical. |
| `sameAs` | External type system mappings, enabling interoperability. |

**Sharing flow:**
1. Owner sets `ownerDomain` and computes `contentHash`.
2. Recipient receives `item.json`. Recomputes hash; verifies against `contentHash`.
3. If stale: queries `ownerDomain` for the latest version.
4. If mirrors are listed: can fetch from any mirror; verify hash before using.

---

## 11. Type Lifecycle

### Open (mutable draft)
When first created, `meta.immutable` is absent or false. The type author can freely modify `jsonSchema`, `sqlSchema`, and `meta`.

### Immutable (published contract)
Setting `meta.immutable: true` seals the type's contract. The tooling computes `meta.hash` — SHA-256 over `jsonSchema` + `sqlSchema` + `meta.primaryField` (keys sorted). Any subsequent write that would change these fields is rejected if the hash no longer matches. Cosmetic `meta` fields may still be updated.

### Superseded
When a sealed type needs a shape change:
1. Create a new type (same name, new UUID).
2. Set `meta.supersededBy` on the old type to point to the new one.
3. Register a converter function in `meta.functions`.

Old types remain readable indefinitely. `supersededBy` is a suggestion, not a forced migration.

### Types are Items
Types are first-class Kanecta items (`type: "type"`). They can be linked, tagged, annotated, subscribed to, and related just like any other item. Their `parentId` is the `data_root` (or a user-created type-collection item).

---

## 12. Confidence and Status

**Confidence** indicates how settled content is:

| Value | Meaning |
|---|---|
| `experimental` | Speculative, may change significantly |
| `exploring` | Actively investigating, alternatives on the table |
| `decided` | Decision made, could still be revisited |
| `locked` | Settled, not expected to change |
| `low` | Low confidence in accuracy |
| `medium` | Moderate confidence |
| `high` | High confidence |
| `verified` | Externally verified or confirmed |

**Status** is a free-form string. Common values: `active`, `archived`, `draft`, `in-progress`, `blocked`.

---

## 13. Aspects

An aspect is a named dimension of an item's children. Every item has a main aspect (`aspect: null`) which is the default tree. Additional aspects are named strings.

Well-known aspect names (by convention):
- `null` — main tree (user-visible by default)
- `"grants"` — access control grant items
- `"settings"` — configuration items
- `"archive"` — archived children
- `"relationships"` — relationship items (alternative to tree-position)

An item belongs to exactly one aspect. `sortOrder` is scoped per aspect. Traversal always targets exactly one aspect.

---

## 14. Templates

A template action copies an item's subtree to a new location as plain unstructured nodes, stripping type information. The copy's `meta.template` field records the source:
- Source item UUID when templating an unstructured tree
- Source type UUID when templating a typed object

The copy is a fresh, fillable tree shaped like the original. No separate template storage is needed — templating is a subtree copy plus one metadata field.

---

## 15. Well-Known Root Nodes

Every datastore contains five reserved items created during initialisation:

| Type | UUID | parentId | value |
|---|---|---|---|
| `root` | `00000000-0000-0000-0000-000000000000` | self | `"root"` |
| `system_root` | generated | root | `"system_root"` |
| `app_root` | generated | root | `"app_root"` |
| `component_root` | generated | root | `"component_root"` |
| `data_root` | generated | root | `"data_root"` |

**Rules:**
- The all-zeros UUID is permanently reserved for root. No user item may use it.
- Each well-known type is a singleton — at most one instance per datastore.
- User data lives exclusively under `data_root`.
- Well-known nodes are created in the order listed above.

---

## 16. Database Table Mapping

The four `item.json` sections map directly to database tables, enabling efficient queries without loading unnecessary data.

| Section | Table | Primary key | Key columns |
|---|---|---|---|
| `item` | `items` | `id` | `parent_id`, `type`, `type_id`, `value` VARCHAR(255), `sort_order` |
| `meta` | `items_meta` | `id` (FK → items) | All provenance and bookkeeping fields |
| `search` | `items_search` | `id` (FK → items) | `corpus_hash`, FTS index, vector column |
| `payload` | `items_payload` | `id` (FK → items) | `data` JSONB (or type-specific columns) |

Tree traversal (`WITH RECURSIVE`) hits only the `items` table. List rendering hits only `items`. Item open hits `items` + `items_meta` + `items_payload`. Search hits `items_search` + FTS/vector indexes.

See [`./extended-specs/specification.db.sqlite.md`](./extended-specs/specification.db.sqlite.md) and [`./extended-specs/specification.db.postgres.md`](./extended-specs/specification.db.postgres.md) for full SQL DDL.

---

## 17. Business Rules

### Creating Items
1. Generate UUID v4. Compute shard path (2+2+full UUID).
2. Create item folder: `.kanecta/data/[s1]/[s2]/[uuid]/`.
3. Write `item.json` with all required fields.
4. Write any sidecar files (body, image, etc.).
5. Update indexes: type-to-items, tag indexes, backlinks.
6. Write history entry (`changeType: create`).
7. Update search index (FTS + embedding if configured).

### Updating Items
1. Write history snapshot **before** modifying (`changeType: update`).
2. Update `meta.modifiedAt` and `meta.modifiedBy`.
3. Write updated `item.json`.
4. Update indexes for any changed fields (tags, links, type).
5. Recompute `meta.contentHash`.
6. Update search index if corpus changed (check `search.corpusHash`).

### Deleting Items
1. Check backlinks and inbound relationships. Warn if any exist; require explicit confirmation.
2. Write history snapshot (`changeType: delete`).
3. Remove item folder from `.kanecta/data/`.
4. Cascade-delete all index entries (type, tag, backlinks, relationships, annotations, field-refs).
5. Remove from search index and vector store.

### Reading Items
1. **UUID lookup:** compute shard path, read `item.json`.
2. **Alias lookup:** read alias file → get UUID → step 1.
3. **Tree traversal:** query children by `parent_id` and `aspect`, order by `sort_order`.
4. **Type query:** read type-to-items index (`.kanecta/types/[type-shard]/items.json` or DB).
5. **Tag query:** read tag index.
6. **FTS search:** query FTS index; get UUIDs; fetch items.
7. **Semantic search:** query vector index with embedding; get UUIDs; fetch items.

### Datastore Initialisation
Create well-known root nodes in order: `root` (self-referencing, all-zeros UUID), then `system_root`, `app_root`, `component_root`, `data_root` as children of root.

---

## 18. Constraints

- UUIDs are UUID v4, globally unique across all installations.
- `parentId` is non-nullable for every item without exception.
- The all-zeros UUID (`00000000-0000-0000-0000-000000000000`) is reserved for root. No user item may use it.
- Circular `parentId` chains (other than root self-reference) are not permitted.
- Well-known types are singletons. Each appears at most once per datastore.
- `item.value` is always ≤255 characters. Full content lives in `payload`.
- All keyed folder structures use mandatory 2+2+full UUID sharding.
- Index caches (`tags/`, `links/`, `search/`) are derivable from `data/` and can be rebuilt at any time.
- Aliases are always lowercase. Applications must normalise before writing or resolving.
- Field-ref entries are permanent for the lifetime of their parent item (cascade delete on item delete).
- The `(itemId, fieldXId)` pair in `fields/` is unique — upsert semantics.

---

## 19. File Specifications

| File | Location | Description |
|---|---|---|
| Item schema | [`./file-specs/item.json`](./file-specs/item.json) | JSON Schema for `item.json`. Source of truth for all item fields and payload shapes. |
| Primitive types | [`./types/primitive.json`](./types/primitive.json) | Canonical list of all valid `item.type` values. |
| SQLite spec | [`./extended-specs/specification.db.sqlite.md`](./extended-specs/specification.db.sqlite.md) | SQLite adapter table definitions and query patterns. |
| Postgres spec | [`./extended-specs/specification.db.postgres.md`](./extended-specs/specification.db.postgres.md) | Postgres adapter table definitions, indexes, and FTS/vector setup. |
