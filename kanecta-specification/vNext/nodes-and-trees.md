# Nodes and Trees

## The decision

`parent_id` is removed from the `items` table entirely. The tree is a separate concept. Nodes are items (type: `"node"`) that reference items by UUID and carry all tree-positioning information. Items are pure data — they know nothing about where they sit in any tree.

See [settled-decisions.md](settled-decisions.md) §1 for why.

---

## Core concepts

### Item
Pure data. No tree information. Identified by UUID. Can appear in zero, one, or many trees simultaneously via nodes.

### Node
An item of type `"node"`. Its payload points to a target item and records its position in a tree: parent node, materialized path, sort order, aspect. Nodes live in `data/` like everything else — they are items.

### Tree
An item of type `"tree"`. The anchor for a collection of nodes. A tree has no special payload — its UUID is what nodes ultimately trace back to via their path. Multiple independent trees can exist in one datastore.

### Aspect
An optional dimension on a node that indicates its role in the tree. Examples: `null` (normal content node), `"history"` (the history dimension of its target item), `"annotations"` (the annotations dimension). Aspects allow a single item to participate in multiple conceptual layers of the same tree without duplication.

---

## Well-known root

One well-known item exists in every datastore:

| Field | Value |
|---|---|
| `id` | `00000000-0000-0000-0000-000000000000` |
| `type` | `"tree"` |
| `value` | `"root"` |
| `namespace` | `"system"` |

This is the bootstrap anchor. The bootstrapper knows this UUID and starts here. All other structure is discovered from the tree rooted here. No other item has a fixed UUID.

The root tree is the default tree for user data. Additional trees (workspaces, views, archived snapshots) are created as needed — they are just items of type `"tree"` with nodes hanging off them.

---

## Node payload shape

```json
{
  "target": "item-uuid",
  "parentId": "parent-node-uuid-or-null",
  "path": "/00000000-0000-0000-0000-000000000000/node-uuid-a/node-uuid-b",
  "sortOrder": 3,
  "aspect": null
}
```

| Field | Description |
|---|---|
| `target` | UUID of the item this node positions in the tree |
| `parentId` | UUID of the parent node. `null` for root-level nodes (direct children of the tree) |
| `path` | Materialized path — `/{tree-uuid}/{node-uuid-1}/.../{this-node-uuid}` |
| `sortOrder` | Integer for sibling ordering. Lower numbers appear first |
| `aspect` | Dimension identifier or `null` for normal content nodes |

### Path format

The path begins with the tree UUID and contains the UUID of every ancestor node down to and including this node. Separator is `/`.

```
/{tree-id}/{node-id}                          ← root-level node
/{tree-id}/{node-id-a}/{node-id-b}            ← one level deep
/{tree-id}/{node-id-a}/{node-id-b}/{node-id-c} ← two levels deep
```

The path is derived from the node structure and is always rebuildable by walking `parentId` chains. It is stored for query performance, not as a source of truth.

---

## Same item in multiple trees

A node in tree A and a node in tree B can both have `target` pointing to the same item UUID. The item is unchanged. Both nodes have independent paths, sort orders, and aspects.

This replaces symlinks entirely. There is no symlink type — multi-location is just multiple nodes.

---

## Postgres schema

### Items table — no parent_id

```sql
CREATE TABLE items (
  id            CHAR(36)     NOT NULL,
  type          VARCHAR(50)  NOT NULL,
  value         TEXT,
  namespace     VARCHAR(20)  NOT NULL DEFAULT 'user',
  owner         VARCHAR(255) NOT NULL,
  visibility    VARCHAR(20)  NOT NULL DEFAULT 'private',
  confidence    VARCHAR(20),
  content_hash  CHAR(71),
  created_at    TIMESTAMP    NOT NULL,
  modified_at   TIMESTAMP    NOT NULL,
  created_by    VARCHAR(255) NOT NULL,
  modified_by   VARCHAR(255) NOT NULL,
  valid_from    TIMESTAMP    NOT NULL,
  valid_to      TIMESTAMP,
  is_remote     BOOLEAN      NOT NULL DEFAULT FALSE,
  cached_at     TIMESTAMP,
  source_system VARCHAR(100),
  source_id     VARCHAR(255),
  source_run_id CHAR(36),

  CONSTRAINT pk_items
    PRIMARY KEY (id),
  CONSTRAINT chk_items_namespace CHECK (
    namespace IN ('system', 'app', 'user')
  ),
  CONSTRAINT chk_items_visibility CHECK (
    visibility IN ('private', 'organisation', 'public')
  ),
  CONSTRAINT chk_items_confidence CHECK (
    confidence IS NULL OR confidence IN (
      'experimental', 'exploring', 'decided', 'locked'
    )
  ),
  CONSTRAINT uq_items_source
    UNIQUE (source_system, source_id)
);

CREATE INDEX idx_items_type       ON items(type)      WHERE valid_to IS NULL;
CREATE INDEX idx_items_namespace  ON items(namespace)  WHERE valid_to IS NULL;
CREATE INDEX idx_items_owner      ON items(owner)      WHERE valid_to IS NULL;
CREATE INDEX idx_items_current    ON items(id)         WHERE valid_to IS NULL;
CREATE INDEX idx_items_source     ON items(source_system, source_id);
```

### payload_node table

```sql
CREATE TABLE payload_node (
  id          CHAR(36) NOT NULL,
  target      CHAR(36) NOT NULL,
  parent_id   CHAR(36),
  path        TEXT     NOT NULL,
  sort_order  INTEGER  NOT NULL DEFAULT 0,
  aspect      VARCHAR(50),

  CONSTRAINT pk_payload_node
    PRIMARY KEY (id),
  CONSTRAINT fk_node_item
    FOREIGN KEY (id) REFERENCES items(id),
  CONSTRAINT fk_node_target
    FOREIGN KEY (target) REFERENCES items(id),
  CONSTRAINT fk_node_parent
    FOREIGN KEY (parent_id) REFERENCES payload_node(id),
  CONSTRAINT uq_node_path
    UNIQUE (path)
);

CREATE INDEX idx_node_path   ON payload_node(path);
CREATE INDEX idx_node_target ON payload_node(target);
CREATE INDEX idx_node_parent ON payload_node(parent_id);
CREATE INDEX idx_node_sort   ON payload_node(parent_id, sort_order);
```

---

## Common queries

### Children of a node
```sql
SELECT n.*, i.*
FROM payload_node n
JOIN items i ON i.id = n.target AND i.valid_to IS NULL
WHERE n.parent_id = $node_id
ORDER BY n.sort_order;
```

### Root-level nodes of a tree
```sql
SELECT n.*, i.*
FROM payload_node n
JOIN items i ON i.id = n.target AND i.valid_to IS NULL
WHERE n.path LIKE '/' || $tree_id || '/%'
  AND n.parent_id IS NULL
ORDER BY n.sort_order;
```

### Full subtree under a node
```sql
SELECT n.*, i.*
FROM payload_node n
JOIN items i ON i.id = n.target AND i.valid_to IS NULL
WHERE n.path LIKE $node_path || '/%'
ORDER BY n.path, n.sort_order;
```

### Ancestors of a node (walk up)
```sql
-- Split the path and look up each segment
-- Path: /tree-uuid/a/b/c → ancestors are a, b (not c, which is self)
SELECT n.*, i.*
FROM payload_node n
JOIN items i ON i.id = n.target AND i.valid_to IS NULL
WHERE n.id = ANY(
  -- extract all node UUIDs from path except the last segment
  string_to_array(trim('/' FROM $node_path), '/')
)
ORDER BY length(n.path);
```

### All trees an item appears in
```sql
SELECT DISTINCT split_part(n.path, '/', 2) AS tree_id
FROM payload_node n
WHERE n.target = $item_id;
```

---

## Move a node

Moving a node to a new parent updates `parent_id`, `path`, and the paths of all descendants in one statement:

```sql
-- Move node $node_id to new parent $new_parent_id
-- $old_path = current path of the node
-- $new_path = /{tree-id}/.../{new-parent-node-id}/{node-id}

UPDATE payload_node
SET
  parent_id  = CASE WHEN id = $node_id THEN $new_parent_id ELSE parent_id END,
  path       = $new_path || substr(path, length($old_path) + 1)
WHERE path = $old_path
   OR path LIKE $old_path || '/%';
```

The item itself is not touched. Move cost is proportional to subtree size but is a single SQL statement.

---

## Filesystem representation

Node items live in `data/` like any other item:

```
data/ab/cd/<node-uuid>/
  item.json   ← { meta, payload: { target, parentId, path, sortOrder, aspect } }
```

`path` on the filesystem is the same materialized path as in Postgres. Rebuildable from `parentId` chains if corrupted.

The path is the source of truth for subtree membership. `parentId` is the source of truth for the parent relationship. Both are stored for query performance — either can be reconstructed from the other.
