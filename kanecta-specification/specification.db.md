# Kanecta Datastore Specification (Database)

**Version:** 1.2.0
**License:** [MIT](LICENSE) — © 2026 Richard Thomas

## Overview
Kanecta is an open-source, self-hosted personal and organizational information repository. Data is stored as a hierarchical tree structure with globally unique identifiers, enabling flexible organization, linking, semantic relationships, and multi-user collaboration. The protocol is designed as a human-AI bridge: structured enough for AI to work with efficiently, transparent enough for humans to audit and understand.

This variant describes the Kanecta datastore as a relational database using ANSI SQL. It is functionally equivalent to the [filesystem variant](specification.fs.md); choose whichever matches your implementation target.

## 1. Schema

### Database Layout

All Kanecta data lives in a single database (or named schema). The tables below are the canonical store.

```
database
├── items              — primary item store (source of truth)
├── item_tags          — tag memberships per item
├── aliases            — human-readable name shortcuts
├── annotations        — comments and reactions on items
├── links              — backlinks index (inline [[uuid]] references)
├── relationships      — semantic relationships between items
├── history            — point-in-time change snapshots
├── config             — datastore configuration key/value pairs
└── files              — binary file attachments (optional; may be stored externally)
```

### Well-Known Root Nodes

Every Kanecta datastore contains five reserved items that are auto-created when a datastore is first opened and found to be empty.

| Type | ID | `parent_id` | `value` |
|---|---|---|---|
| `root` | `00000000-0000-0000-0000-000000000000` | `00000000-0000-0000-0000-000000000000` (self) | `'root'` |
| `system_root` | generated UUID v4 | root ID | `'system_root'` |
| `app_root` | generated UUID v4 | root ID | `'app_root'` |
| `component_root` | generated UUID v4 | root ID | `'component_root'` |
| `data_root` | generated UUID v4 | root ID | `'data_root'` |

**Rules:**
- The `root` ID is fixed and universally known: `00000000-0000-0000-0000-000000000000`.
- `root` is self-referential: `parent_id = id`. This satisfies the `NOT NULL` constraint.
- Each well-known type is a **singleton** — enforced at the application layer (no second instance may be created).
- Well-known nodes are created in order: `root` first, then its four children.
- User data lives exclusively under `data_root`. Items under `system_root`, `app_root`, and `component_root` are reserved for internal use.

**Singleton enforcement:**
```sql
-- Reject duplicate well-known types at the application layer before inserting:
SELECT COUNT(*) FROM items WHERE type = :well_known_type;
-- If count > 0, raise an error; do not insert.
```

### UUID Convention

Kanecta uses UUID version 4 (random) for all item identifiers. UUID v4 provides 122 bits of randomness, making collisions effectively impossible across all installations worldwide, with no central authority required for uniqueness. UUIDs are stored as `CHAR(36)` with hyphens preserved. Database engines that provide a native `UUID` type may use it instead.

### items — Source of Truth

```sql
CREATE TABLE items (
    id                  CHAR(36)     NOT NULL,
    parent_id           CHAR(36)     NOT NULL,
    value               TEXT,
    type                VARCHAR(50)  NOT NULL,
    type_id             CHAR(36),
    owner               VARCHAR(255) NOT NULL,
    license             VARCHAR(100),
    sort_order          INTEGER      NOT NULL DEFAULT 0,
    confidence          VARCHAR(20),
    created_at          TIMESTAMP    NOT NULL,
    modified_at         TIMESTAMP    NOT NULL,
    created_by          VARCHAR(255) NOT NULL,
    modified_by         VARCHAR(255) NOT NULL,
    cached_at           TIMESTAMP,
    subscribed_at       TIMESTAMP,
    subscription_source TEXT,
    is_remote           BOOLEAN      NOT NULL DEFAULT FALSE,

    CONSTRAINT pk_items
        PRIMARY KEY (id),
    CONSTRAINT fk_items_parent
        FOREIGN KEY (parent_id) REFERENCES items(id),
    CONSTRAINT chk_items_type CHECK (type IN (
        'string', 'number', 'text', 'file', 'symlink',
        'object', 'decision', 'annotation',
        'root', 'system_root', 'app_root', 'component_root', 'data_root'
    )),
    CONSTRAINT chk_items_confidence CHECK (
        confidence IS NULL OR confidence IN (
            'experimental', 'exploring', 'decided', 'locked'
        )
    ),
    CONSTRAINT chk_items_type_id CHECK (
        (type = 'object' AND type_id IS NOT NULL) OR
        (type <> 'object' AND type_id IS NULL)
    ),
    CONSTRAINT chk_items_cached_at CHECK (
        (is_remote = TRUE AND cached_at IS NOT NULL) OR
        (is_remote = FALSE)
    )
);

CREATE INDEX idx_items_parent   ON items(parent_id);
CREATE INDEX idx_items_type     ON items(type);
CREATE INDEX idx_items_type_id  ON items(type_id);
CREATE INDEX idx_items_owner    ON items(owner);
CREATE INDEX idx_items_siblings ON items(parent_id, sort_order);
```

### Column Definitions

| Column | Required | Description |
|---|---|---|
| `id` | yes | Unique identifier for this item (UUID v4) |
| `parent_id` | yes | UUID of parent item. Never NULL — the `root` node is self-referential (`parent_id` equals its own `id`) |
| `value` | no | Item content. Text string, UUID reference (for symlinks), or NULL |
| `type` | yes | Item type. Primitive: `string`, `number`, `text`, `file`, `symlink`. Structured: `object`, `decision`, `annotation`. Well-known roots: `root`, `system_root`, `app_root`, `component_root`, `data_root` |
| `type_id` | conditional | If type is `object`, UUID of the type definition. Otherwise NULL |
| `owner` | yes | Email or domain of item owner |
| `license` | no | License identifier (MIT, Apache-2.0, CC-BY, etc.) or NULL |
| `sort_order` | yes | Integer for sibling ordering. Higher numbers appear lower in the tree |
| `confidence` | no | Confidence/certainty level: `experimental`, `exploring`, `decided`, `locked`, or NULL |
| `created_at` | yes | Timestamp of item creation |
| `modified_at` | yes | Timestamp of most recent modification |
| `created_by` | yes | Email or domain of creator |
| `modified_by` | yes | Email or domain of most recent modifier |
| `cached_at` | conditional | Timestamp when remote item was last cached. Required when `is_remote = TRUE`, NULL for local items |
| `subscribed_at` | no | Timestamp when subscription started. NULL if not subscribed |
| `subscription_source` | no | URL or identifier of remote source for updates |
| `is_remote` | yes | TRUE if this item was fetched from another owner's datastore |

### Confidence Levels

The `confidence` column indicates how settled an item is:

- **experimental** — Speculative, being tried out, may change significantly
- **exploring** — Actively investigating, alternatives still on the table
- **decided** — A decision has been made, but could be revisited
- **locked** — Settled, not expected to change

### Decision Item Type

When `type` is `decision`, the `value` column contains a JSON object capturing the reasoning behind the decision:

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

### item_tags

Tag memberships are stored as a junction table rather than in-column arrays, enabling efficient reverse lookups.

```sql
CREATE TABLE item_tags (
    item_id CHAR(36)     NOT NULL,
    tag     VARCHAR(255) NOT NULL,

    CONSTRAINT pk_item_tags
        PRIMARY KEY (item_id, tag),
    CONSTRAINT fk_item_tags_item
        FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE INDEX idx_item_tags_tag ON item_tags(tag);
```

### aliases

```sql
CREATE TABLE aliases (
    alias     VARCHAR(255) NOT NULL,
    target_id CHAR(36)     NOT NULL,

    CONSTRAINT pk_aliases
        PRIMARY KEY (alias),
    CONSTRAINT fk_aliases_target
        FOREIGN KEY (target_id) REFERENCES items(id)
);
```

Multiple aliases may point to the same UUID. Alias uniqueness within a datastore is enforced by the primary key.

### annotations

```sql
CREATE TABLE annotations (
    id                   CHAR(36)     NOT NULL,
    target_id            CHAR(36)     NOT NULL,
    author               VARCHAR(255) NOT NULL,
    content              TEXT         NOT NULL,
    created_at           TIMESTAMP    NOT NULL,
    parent_annotation_id CHAR(36),

    CONSTRAINT pk_annotations
        PRIMARY KEY (id),
    CONSTRAINT fk_annotations_target
        FOREIGN KEY (target_id) REFERENCES items(id),
    CONSTRAINT fk_annotations_parent
        FOREIGN KEY (parent_annotation_id) REFERENCES annotations(id)
);

CREATE INDEX idx_annotations_target ON annotations(target_id);
```

### links (backlinks index)

Stores the reverse index of inline `[[uuid]]` references found in `items.value`.

```sql
CREATE TABLE links (
    source_id CHAR(36) NOT NULL,
    target_id CHAR(36) NOT NULL,

    CONSTRAINT pk_links
        PRIMARY KEY (source_id, target_id),
    CONSTRAINT fk_links_source
        FOREIGN KEY (source_id) REFERENCES items(id),
    CONSTRAINT fk_links_target
        FOREIGN KEY (target_id) REFERENCES items(id)
);

CREATE INDEX idx_links_target ON links(target_id);
```

### relationships

```sql
CREATE TABLE relationships (
    id         CHAR(36)     NOT NULL,
    source_id  CHAR(36)     NOT NULL,
    target_id  CHAR(36)     NOT NULL,
    type       VARCHAR(50)  NOT NULL,
    created_at TIMESTAMP    NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    note       TEXT,

    CONSTRAINT pk_relationships
        PRIMARY KEY (id),
    CONSTRAINT fk_relationships_source
        FOREIGN KEY (source_id) REFERENCES items(id),
    CONSTRAINT fk_relationships_target
        FOREIGN KEY (target_id) REFERENCES items(id),
    CONSTRAINT chk_relationships_type CHECK (type IN (
        'relates-to', 'depends-on', 'enables', 'contradicts',
        'blocks', 'blocked-by', 'prerequisite-for', 'derived-from', 'supersedes'
    ))
);

CREATE INDEX idx_relationships_source ON relationships(source_id);
CREATE INDEX idx_relationships_target ON relationships(target_id);
```

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

### history

```sql
CREATE TABLE history (
    id          CHAR(36)     NOT NULL,
    item_id     CHAR(36)     NOT NULL,
    snapshot    TEXT         NOT NULL,
    snapshot_at TIMESTAMP    NOT NULL,
    changed_by  VARCHAR(255) NOT NULL,
    change_type VARCHAR(10)  NOT NULL,

    CONSTRAINT pk_history
        PRIMARY KEY (id),
    CONSTRAINT chk_history_change_type CHECK (
        change_type IN ('create', 'update', 'delete')
    )
);

CREATE INDEX idx_history_item ON history(item_id, snapshot_at);
```

`snapshot` stores the complete JSON representation of the item row as it existed before the change. The `history` table intentionally carries no foreign key to `items(id)` — history records must survive item deletion.

### config

```sql
CREATE TABLE config (
    key   VARCHAR(255) NOT NULL,
    value TEXT         NOT NULL,

    CONSTRAINT pk_config PRIMARY KEY (key)
);

INSERT INTO config (key, value) VALUES ('owner', 'user@example.com');
INSERT INTO config (key, value) VALUES ('spec_version', '1.1.0');
```

- **owner**: Email or domain identifying the datastore owner. Used as the default `owner`, `created_by`, and `modified_by` for new items.
- **spec_version**: Version of the Kanecta specification this datastore conforms to.

### files (optional)

Binary file attachments associated with `file`-type items may be stored inline as BLOBs or by reference to an external path. Implementations must document which strategy they use.

```sql
CREATE TABLE files (
    id            CHAR(36)     NOT NULL,
    item_id       CHAR(36)     NOT NULL,
    filename      VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(100),
    content       BLOB,
    external_path TEXT,

    CONSTRAINT pk_files
        PRIMARY KEY (id),
    CONSTRAINT fk_files_item
        FOREIGN KEY (item_id) REFERENCES items(id),
    CONSTRAINT chk_files_storage CHECK (
        (content IS NOT NULL AND external_path IS NULL) OR
        (content IS NULL AND external_path IS NOT NULL)
    )
);
```

---

## 2. Link Syntax

Items can reference other items in two ways:

### Inline Links

Within the `value` column, use double square brackets to create links:

```
This is my note about [[a1b2c3d4-e5f6-4abc-9def-123456789012]].
```

The UI renders this as a clickable link. The UUID can be resolved to its actual content. Each `[[uuid]]` reference must be reflected in the `links` table.

### Symlinks

Create an item with `type` set to `symlink` and `value` containing the target UUID:

```sql
INSERT INTO items (id, type, value, parent_id, ...)
VALUES ('symlink-uuid', 'symlink', 'target-uuid', 'parent-uuid', ...);
```

When displayed, the symlink resolves to show the target item's content while preserving its own position in the tree.

---

## 3. Business Rules for Operations

### Creating Items

```sql
BEGIN TRANSACTION;

-- Insert the item
INSERT INTO items (
    id, parent_id, value, type, type_id,
    owner, license, sort_order, confidence,
    created_at, modified_at, created_by, modified_by,
    cached_at, subscribed_at, subscription_source, is_remote
) VALUES (
    :id, :parent_id, :value, :type, :type_id,
    :owner, :license, :sort_order, :confidence,
    :now, :now, :actor, :actor,
    NULL, NULL, NULL, FALSE
);

-- Record creation in history
INSERT INTO history (id, item_id, snapshot, snapshot_at, changed_by, change_type)
VALUES (:history_id, :id, :snapshot_json, :now, :actor, 'create');

-- Insert tag memberships
INSERT INTO item_tags (item_id, tag) VALUES (:id, :tag), ...;

-- Insert backlinks for each [[uuid]] found in value
INSERT INTO links (source_id, target_id) VALUES (:id, :referenced_uuid), ...;

COMMIT;
```

After the transaction, update the full-text search index.

`sort_order` defaults to 0 or may be set to `MAX(sort_order) + 1` among existing siblings for append behaviour.

### Updating Items

```sql
BEGIN TRANSACTION;

-- Snapshot current state before modifying
INSERT INTO history (id, item_id, snapshot, snapshot_at, changed_by, change_type)
VALUES (:history_id, :id, :current_snapshot_json, :now, :actor, 'update');

-- Update the item
UPDATE items SET
    value        = :new_value,
    modified_at  = :now,
    modified_by  = :actor
    -- ... other changed columns
WHERE id = :id;

-- Reconcile backlinks: remove stale, add new
DELETE FROM links
WHERE source_id = :id
  AND target_id NOT IN (:new_referenced_uuids);

INSERT INTO links (source_id, target_id)
SELECT :id, t.uuid
FROM (VALUES (:new_referenced_uuids)) AS t(uuid)
WHERE NOT EXISTS (
    SELECT 1 FROM links WHERE source_id = :id AND target_id = t.uuid
);

-- Reconcile tags: remove stale, add new
DELETE FROM item_tags
WHERE item_id = :id
  AND tag NOT IN (:new_tags);

INSERT INTO item_tags (item_id, tag)
SELECT :id, t.tag
FROM (VALUES (:new_tags)) AS t(tag)
WHERE NOT EXISTS (
    SELECT 1 FROM item_tags WHERE item_id = :id AND tag = t.tag
);

COMMIT;
```

After the transaction, update the full-text search index.

### Deleting Items

```sql
BEGIN TRANSACTION;

-- Check for inbound references; application should warn and require confirmation
SELECT source_id FROM links WHERE target_id = :id;
SELECT source_id FROM relationships WHERE target_id = :id;

-- Snapshot before deletion
INSERT INTO history (id, item_id, snapshot, snapshot_at, changed_by, change_type)
VALUES (:history_id, :id, :current_snapshot_json, :now, :actor, 'delete');

-- Clean up index tables
DELETE FROM links        WHERE source_id = :id OR target_id = :id;
DELETE FROM relationships WHERE source_id = :id OR target_id = :id;
DELETE FROM item_tags    WHERE item_id = :id;
DELETE FROM aliases      WHERE target_id = :id;
-- Annotations may be deleted or orphaned per implementation policy

-- Delete the item
DELETE FROM items WHERE id = :id;

COMMIT;
```

After the transaction, remove the item from the full-text search index.

### Reading Items

```sql
-- UUID lookup
SELECT * FROM items WHERE id = :id;

-- Alias lookup
SELECT i.* FROM items i
JOIN aliases a ON a.target_id = i.id
WHERE a.alias = :alias;

-- Query by type
SELECT * FROM items WHERE type_id = :type_id;

-- Query by tag
SELECT i.* FROM items i
JOIN item_tags t ON t.item_id = i.id
WHERE t.tag = :tag;

-- Query by owner
SELECT * FROM items WHERE owner = :owner;

-- Backlinks (what links here)
SELECT source_id FROM links WHERE target_id = :id;

-- Relationships (outbound and inbound)
SELECT * FROM relationships WHERE source_id = :id OR target_id = :id;

-- History timeline
SELECT * FROM history WHERE item_id = :id ORDER BY snapshot_at;

-- Annotations
SELECT * FROM annotations WHERE target_id = :id;
```

Full-text search is delegated to the database's native FTS engine or an external search service. Index the `value` column, associated tags, and queryable metadata columns.

### Datastore Initialisation

When a lib or CLI opens a datastore for the first time and finds it empty, it must create the well-known root nodes:

```sql
BEGIN TRANSACTION;

-- 1. root (self-referential)
INSERT INTO items (id, parent_id, value, type, sort_order, owner, created_at, modified_at, created_by, modified_by, is_remote)
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000',
        'root', 'root', 0, :owner, :now, :now, :owner, :owner, FALSE);

-- 2. Four children of root
INSERT INTO items (id, parent_id, value, type, sort_order, owner, created_at, modified_at, created_by, modified_by, is_remote)
VALUES
  (:system_root_id,    '00000000-0000-0000-0000-000000000000', 'system_root',    'system_root',    0, :owner, :now, :now, :owner, :owner, FALSE),
  (:app_root_id,       '00000000-0000-0000-0000-000000000000', 'app_root',       'app_root',       1, :owner, :now, :now, :owner, :owner, FALSE),
  (:component_root_id, '00000000-0000-0000-0000-000000000000', 'component_root', 'component_root', 2, :owner, :now, :now, :owner, :owner, FALSE),
  (:data_root_id,      '00000000-0000-0000-0000-000000000000', 'data_root',      'data_root',      3, :owner, :now, :now, :owner, :owner, FALSE);

COMMIT;
```

### Tree Traversal

```sql
-- Navigate directly to root (ID is always known)
SELECT * FROM items WHERE id = '00000000-0000-0000-0000-000000000000';

-- Find data_root (the user's tree entry point)
SELECT * FROM items
WHERE parent_id = '00000000-0000-0000-0000-000000000000'
  AND type = 'data_root';

-- Children of an item
SELECT * FROM items WHERE parent_id = :id ORDER BY sort_order;

-- Full user subtree starting from data_root (recursive CTE — SQL:1999+)
WITH RECURSIVE subtree AS (
    SELECT * FROM items WHERE type = 'data_root'
    UNION ALL
    SELECT i.* FROM items i
    JOIN subtree s ON s.id = i.parent_id
)
SELECT * FROM subtree ORDER BY sort_order;
```

### Creating Relationships

```sql
INSERT INTO relationships (id, source_id, target_id, type, created_at, created_by, note)
VALUES (:id, :source_id, :target_id, :type, :now, :actor, :note);
```

Direction is encoded by `source_id` / `target_id`. Querying `WHERE source_id = :id OR target_id = :id` gives the full relationship neighbourhood of an item.

### Adding Annotations

```sql
INSERT INTO annotations (id, target_id, author, content, created_at, parent_annotation_id)
VALUES (:id, :target_id, :actor, :content, :now, :parent_annotation_id);
```

Adding an annotation does not modify the target item's row. The `parent_annotation_id` column enables threaded discussions.

### Caching Remote Items

```sql
BEGIN TRANSACTION;

INSERT INTO items (
    id, parent_id, value, type, type_id,
    owner, license, sort_order, confidence,
    created_at, modified_at, created_by, modified_by,
    cached_at, subscribed_at, subscription_source, is_remote
) VALUES (
    :id, :parent_id, :value, :type, :type_id,
    :remote_owner, :license, :sort_order, :confidence,
    :original_created_at, :original_modified_at, :remote_owner, :remote_owner,
    :now, :subscribed_at, :subscription_source, TRUE
);

COMMIT;
```

### Updating the Search Index

On every create, update, or delete, notify the full-text search engine. Databases with native FTS may update automatically via computed columns or triggers. External engines receive explicit update calls after each transaction commits.

---

## 4. Constraints and Assumptions

- UUIDs are UUID v4 and globally unique across all installations. Stored as `CHAR(36)` with hyphens, or as a native UUID type when supported.
- `parent_id` is `NOT NULL` for every item. The only self-referential item is `root` (`parent_id = id = '00000000-0000-0000-0000-000000000000'`). All other items must have a `parent_id` that resolves to an existing item.
- The five well-known root types (`root`, `system_root`, `app_root`, `component_root`, `data_root`) are singletons. Each may appear exactly once in a datastore. Implementations must check for existence before inserting and reject duplicates.
- The `root` ID (`00000000-0000-0000-0000-000000000000`) is reserved. No user-created item may use this ID.
- Circular `parent_id` chains (other than the root self-reference) are not permitted. Applications must validate before inserting; the database cannot enforce acyclicity with a foreign key alone.
- Aliases must be unique within a datastore; enforced by the primary key on `aliases.alias`.
- Circular `[[uuid]]` inline links and relationships are allowed but should be detected and handled by UIs.
- Symlinks may reference remote items (`is_remote = TRUE`).
- The `history` table carries no foreign key to `items(id)` — history records must outlive the items they describe.
- The `links`, `item_tags`, and `relationships` tables are derivable from `items` and can be rebuilt. Only `items`, `history`, `annotations`, `aliases`, and `config` are authoritative.
- All multi-step operations must be wrapped in transactions to maintain consistency.
- For multi-user environments, appropriate isolation levels (at minimum `READ COMMITTED`) and row-level locking must be applied.

---

## 5. Future Extensibility

- **Permissions**: A `permissions` table granting read/write/admin access per item or subtree
- **Sync / Changelog**: An append-only `changelog` table for efficient multi-user sync
- **Templates**: A `templates` table or item type for reusable item structures
- **Reactions**: A lightweight `reactions` table distinct from `annotations`
- **Encrypted items**: Per-row encryption for sensitive data within shared datastores

---

## Notes

- This specification describes the relational schema at rest and the SQL operations that maintain consistency.
- Any application reading or writing a Kanecta database datastore must follow these business rules.
- The specification is versioned; datastores declare their conformance version in the `config` table (`spec_version` key).
- ANSI SQL syntax is used throughout. Dialect-specific extensions (e.g., native `UUID` type, `JSONB`, `BYTEA` vs. `BLOB`) may be substituted when the target database supports them.
- The protocol is intentionally designed to serve as a human-AI bridge: structured enough for machines to reason about, transparent enough for humans to audit.
