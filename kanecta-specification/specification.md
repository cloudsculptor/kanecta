# Kanecta Datastore Specification

## Overview
Kanecta is an open-source, self-hosted personal and organizational information repository. Data is stored as a hierarchical tree structure with globally unique identifiers, enabling flexible organization, linking, and multi-user collaboration.

## 1. Directory Structure

### Root Level
When a user initializes Kanecta, they designate a **datastore** location on disk. Inside that datastore:

```
datastore/
├── .kanecta/
│ ├── data/
│ ├── aliases/
│ ├── config/
│ ├── search/
│ ├── types/
│ ├── remotes/
│ ├── remotes-index/
│ └── links/
├── specification.md
└── README.md
```

### .kanecta/data/ — Source of Truth
All items in the Kanecta datastore live here in a sharded UUID structure. Every item is a folder named after its UUID, sharded at two-character intervals.

**Structure Example:**
```
.kanecta/data/
├── a1/
│ ├── b2/
│ │ ├── c3d4e5f6abcdef1234567890/
│ │ │ ├── metadata.json
│ │ │ ├── image.png (optional)
│ │ │ └── document.txt (optional)
```

**UUID Sharding:** UUIDs are split into two-character chunks to create directory paths. Example: UUID `a1b2c3d4e5f6...` becomes `a1/b2/c3/d4e5f6.../metadata.json`.

Each item folder contains:
- **metadata.json** — Item metadata (required)
- **Optional files** — Images, code, documents, etc.

### metadata.json Schema

```json
{
"id": "string (UUID)",
"parent_id": "string (UUID) or null",
"value": "string or null",
"type": "string",
"type_id": "string (UUID) or null",
"owner": "string (email or domain)",
"license": "string or null",
"sort_order": "integer",
"cached_at": "string (ISO8601) or null",
"subscribed_at": "string (ISO8601) or null",
"subscription_source": "string or null"
}
```

**Field Definitions:**

- **id** (required): Unique identifier for this item. UUID format.
- **parent_id**: UUID of parent item, or null if root level.
- **value**: Item content. Can be text string, UUID reference (for symlinks), or null.
- **type** (required): Item type. Values: "string", "number", "text", "file", "symlink", "object".
- **type_id**: If type is "object", UUID of the type definition. Otherwise null.
- **owner** (required): Email or domain of item owner.
- **license**: License identifier (MIT, AGPL, CC-BY, etc.) or null.
- **sort_order** (required): Integer for sibling ordering. Higher numbers appear lower in the tree.
- **cached_at**: ISO8601 timestamp when remote item was last cached. Null for local items.
- **subscribed_at**: ISO8601 timestamp when subscription started. Null if not subscribed.
- **subscription_source**: URL or identifier of remote source for updates.

### .kanecta/aliases/ — Human-Readable Shortcuts

Stores user-friendly aliases mapping to item UUIDs. Uses identical sharding structure as data/.

**Structure:**
```
.kanecta/aliases/
├── d/
│ ├── r/
│ │ ├── i/
│ │ │ └── ll-one.txt
```

Each file contains a single line with the target UUID:
```
a1b2c3d4e5f6...
```

**Usage:** Read alias file to get UUID, then look up UUID in data/ folder.

### .kanecta/config/ — Configuration

Stores configuration as JSON files.

**config.json:**
```json
{
"owner": "user@example.com"
}
```

- **owner**: Email or domain identifying the datastore owner. Used as default owner for new items.

### .kanecta/search/ — Search Index Cache

Output folder for search library (MeiliSearch, Lunr, etc.). Automatically managed. Do not edit manually.

### .kanecta/types/ — Type-to-Items Index Cache

Reverse index mapping type UUIDs to all items of that type. Uses sharded structure by type UUID.

**Structure:**
```
.kanecta/types/
├── a1/
│ ├── b2/
│ │ ├── c3d4e5f6.../
│ │ │ └── items.json
```

**items.json:**
```json
{
"items": ["uuid-of-item-1", "uuid-of-item-2", "uuid-of-item-3"]
}
```

### .kanecta/remotes/ — Cached Remote Items

Stores copies of items owned by other users. Uses identical sharding to data/.

Remote items include all standard metadata fields plus:
- **cached_at**: Timestamp of last fetch from remote source (required for remotes)
- **subscribed_at**: Timestamp when subscription started (optional)

### .kanecta/remotes-index/ — Remote Owner Index

Maps owners to their cached items. Uses sharded structure by owner identifier.

**Structure:**
```
.kanecta/remotes-index/
├── u/
│ ├── s/
│ │ ├── e/
│ │ │ ├── r/
│ │ │ │ ├── at/
│ │ │ │ │ ├── e/
│ │ │ │ │ │ ├── x/
│ │ │ │ │ │ │ ├── a/
│ │ │ │ │ │ │ │ ├── m/
│ │ │ │ │ │ │ │ │ ├── p/
│ │ │ │ │ │ │ │ │ │ ├── le.com/
│ │ │ │ │ │ │ │ │ │ │ └── items.json
```

Owner identifier is sharded character by character (one char per level) for consistency.

**items.json:**
```json
{
"items": ["uuid-of-item-1", "uuid-of-item-2"]
}
```

### .kanecta/links/ — Backlinks Index Cache

Reverse index mapping items to all items that link to them.

**Structure:**
```
.kanecta/links/
├── a1/
│ ├── b2/
│ │ ├── c3d4e5f6.../
│ │ │ └── backlinks.json
```

**backlinks.json:**
```json
{
"backlinks": ["uuid-of-item-linking-to-this", "uuid-of-another-item"]
}
```

Used to find all references to an item before deletion.

---

## 2. Link Syntax

Items can reference other items in two ways:

### Inline Links
Within the `value` field, use double square brackets to create links:

```
This is my note about [[uuid-of-another-item]].
```

The UI renders this as a clickable link. The UUID can be resolved to its actual content.

### Symlinks
Create a "symlink" type item. Set type to "symlink" and value to the target UUID:

```json
{
"id": "symlink-uuid",
"type": "symlink",
"value": "target-uuid",
"parent_id": "parent-uuid"
}
```

When displayed, the symlink resolves to show the target item's content.

---

## 3. Business Rules for Operations

### Creating Items

1. Generate a new UUID for the item.
2. Create folder at `.kanecta/data/[shard]/[shard]/[rest-of-uuid]/`.
3. Create metadata.json with required fields:
- **id**: The generated UUID
- **type**: Specify the type (string, object, etc.)
- **owner**: Use datastore owner from config unless overridden
- **sort_order**: Default to 0 or next available order among siblings
4. Update parent item if parent_id is set.
5. **Index updates**:
- If type is "object", add item UUID to `.kanecta/types/[type-uuid]/items.json`
- If owner is different from datastore owner, add to `.kanecta/remotes-index/[owner-shard]/items.json`
- If item contains `[[uuid]]` in value, add entries to `.kanecta/links/[target-uuid]/backlinks.json`

### Updating Items

1. Modify metadata.json in place.
2. If value field changes:
- Parse for new `[[uuid]]` links and add backlinks
- Remove old backlinks for links that no longer exist
3. If type changes:
- Remove from old type index in `.kanecta/types/`
- Add to new type index
4. If parent_id changes:
- Update parent_id in metadata
- Reorder sort_order if needed among new siblings
5. Update search index via search library

### Deleting Items

1. Check `.kanecta/links/[item-uuid]/backlinks.json` for references.
2. Warn user if backlinks exist.
3. Remove folder from `.kanecta/data/`.
4. **Index cleanup**:
- Remove from type index (`.kanecta/types/`)
- Remove from remotes index if remote (`.kanecta/remotes-index/`)
- Remove all entries in `.kanecta/links/[other-uuid]/backlinks.json` that reference this item
- Remove entry from search index

### Reading Items

1. UUID lookup: Compute shard path and read metadata.json directly.
2. Alias lookup: Read alias file to get UUID, then proceed with UUID lookup.
3. Query by type: Read `.kanecta/types/[type-uuid]/items.json` for all items of that type.
4. Query by owner: Read `.kanecta/remotes-index/[owner-shard]/items.json`.
5. Search: Query search index for text matches.
6. Backlinks: Read `.kanecta/links/[item-uuid]/backlinks.json` to find items linking to this one.

### Tree Traversal

1. Start at root (parent_id = null).
2. Find all items with parent_id matching current item's id.
3. Sort by sort_order.
4. Recursively build tree structure.

### Caching Remote Items

1. When fetching item from remote owner, store in `.kanecta/remotes/[shard]/[metadata].json`.
2. Set **cached_at** to current timestamp.
3. If subscribing, set **subscribed_at** to current timestamp and **subscription_source** to remote URL.
4. Add item UUID to `.kanecta/remotes-index/[owner-shard]/items.json`.

### Updating Search Index

Whenever an item is created, updated, or deleted:
1. Call search library update function.
2. Index the item's value and all metadata fields.
3. Search library manages `.kanecta/search/` folder output.

---

## 4. Constraints and Assumptions

- UUIDs are globally unique across all installations.
- Aliases should be unique within a datastore (not enforced at filesystem level; application should validate).
- Circular references are allowed but may cause issues in some views.
- Symlinks can point to items owned by other users (via remotes/).
- File system operations are atomic enough for single-user scenarios; multi-user sync requires additional logic.
- Parent-child relationships are enforced in metadata, not filesystem structure.

---

## 5. Future Extensibility

- **Permissions**: Add read/write/admin permission lists to metadata.
- **Versioning**: Store item history in `.kanecta/history/`.
- **Sync**: Add `.kanecta/sync/` for tracking remote changes.
- **Templates**: Store reusable templates in `.kanecta/templates/`.
- **Comments**: Add `.kanecta/comments/` for item-level discussions.

---

## Notes

- This specification describes the format at rest and the operations that maintain consistency.
- Any application reading or writing Kanecta datastores must follow these business rules.
- The specification is version 1.0 and subject to iteration as the project evolves.