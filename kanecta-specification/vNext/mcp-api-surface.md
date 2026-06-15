# MCP API Surface

## Status

This document defines the target MCP tool surface for Kanecta. It will be formalised into `specification.md` as a first-class section when the next major version is cut.

The gaps listed in [kanecta.md](kanecta.md) under "Enhancements that Claude would like" are the immediate source of this spec. This document extends those with graph query tools enabled by the AGE projection layer.

---

## Design principles

- **One tool, one clear job.** No tool does two things.
- **Scoped by default.** Searches and traversals scope to `namespace: "user"` unless overridden.
- **UUIDs are the currency.** Tools return UUIDs; callers resolve full data as needed.
- **Bulk operations are atomic.** Bulk create/update either fully succeeds or fully rolls back.
- **Graph tools return UUIDs only.** Full item data is resolved via `kanecta_get` or `kanecta_get_many`.

---

## Core item tools

### kanecta_get
Get a single item by UUID or alias. Unchanged from current. Returns full item including meta and payload.

### kanecta_get_many *(new)*
Get multiple items by UUID in one call. Eliminates N round trips after graph queries.

```
kanecta_get_many(ids: string[]) → Item[]
```

### kanecta_add_item
Add a single item. Extended with new optional fields:

```
kanecta_add_item(
  value: string,
  type?: string,
  parentNodeId?: string,       -- node to attach to (replaces parentId on item)
  sortOrder?: number,          -- explicit sort position
  alias?: string,              -- register an alias at creation time
  confidence?: string,
  namespace?: string,          -- default: "user"
  sourceSystem?: string,
  sourceId?: string,
  sourceRunId?: string,
  payload?: object
) → Item
```

### kanecta_bulk_create *(new)*
Create a parent item and any number of children in one atomic operation.

```
kanecta_bulk_create(
  items: Array<{
    tempId: string,             -- caller-assigned temp ID for linking children to parents
    value: string,
    type?: string,
    parentTempId?: string,      -- reference to another item in this batch
    parentNodeId?: string,      -- reference to an existing node outside this batch
    sortOrder?: number,
    alias?: string,
    payload?: object
  }>
) → { created: Item[], nodeIds: Record<tempId, nodeId> }
```

### kanecta_update_item
Update an item's value and/or payload. Extended:

```
kanecta_update_item(
  id: string,
  value?: string,
  payload?: object,
  confidence?: string,
  alias?: string               -- set or update alias
) → Item
```

### kanecta_bulk_update *(new)*
Update multiple items in one atomic call.

```
kanecta_bulk_update(
  updates: Array<{ id: string, value?: string, payload?: object, confidence?: string }>
) → Item[]
```

### kanecta_move *(new)*
Move a node to a new parent. Does not affect the item itself.

```
kanecta_move(
  nodeId: string,
  newParentNodeId: string,
  sortOrder?: number
) → Node
```

### kanecta_delete_item
Delete a single item. Unchanged.

### kanecta_delete_subtree *(new)*
Delete a node and all its descendant nodes and their items.

```
kanecta_delete_subtree(
  nodeId: string,
  dryRun?: boolean             -- return what would be deleted without deleting
) → { deleted: number }
```

### kanecta_clone_subtree *(new)*
Clone a node and all its descendants under a new parent. Items are deep-copied with new UUIDs.

```
kanecta_clone_subtree(
  sourceNodeId: string,
  targetParentNodeId: string,
  sortOrder?: number
) → { root: Item, created: number }
```

---

## Navigation tools

### kanecta_get_children
Get immediate children of a node. Unchanged from current.

### kanecta_get_ancestors *(new)*
Get the full ancestor chain from a node up to the tree root.

```
kanecta_get_ancestors(
  nodeId: string
) → Array<{ node: Node, item: Item }>   -- ordered root → parent
```

### kanecta_get_tree
Get the full subtree under a node. Unchanged from current.

---

## Search tools

### kanecta_search
Full search combining FTS, vector similarity, and optional graph expansion. Replaces the current keyword-only search.

```
kanecta_search(
  query: string,
  seedId?: string,             -- UUID anchor for graph expansion
  namespace?: string,          -- default: "user"
  rootNodeId?: string,         -- restrict results to descendants of this node
  typeFilter?: string[],       -- restrict to specific item types
  tagFilter?: string[],        -- restrict to items with these tags
  confidenceFilter?: string[], -- restrict to specific confidence levels
  limit?: number               -- default: 20
) → Array<{ item: Item, score: number, matchType: "fts" | "vector" | "graph" | "combined" }>
```

When `seedId` is provided, graph proximity is weighted higher. When no `seedId`, vector similarity is weighted higher. See [graph-projection.md](graph-projection.md) for the scoring formula.

### kanecta_recent
List recently created or modified items. Unchanged from current. Add `namespace` and `typeFilter` parameters.

---

## Graph query tools

These tools query the AGE graph projection. They return UUIDs only — resolve full data with `kanecta_get_many`.

All graph tools require the AGE projection to be enabled. On datastores without AGE, these tools return an error indicating the graph layer is unavailable.

### kanecta_graph_related *(new)*
Find all items connected to a given item within N hops, across any combination of relationship types.

```
kanecta_graph_related(
  id: string,
  depth?: number,              -- default: 2, max: 5
  edgeTypes?: string[],        -- filter to specific relationship type labels
  direction?: "any" | "outbound" | "inbound",  -- default: "any"
  confidenceFilter?: string[]  -- e.g. ["decided", "locked"] for human-curated only
) → Array<{ id: string, hops: number, path: string[] }>
```

### kanecta_graph_path *(new)*
Find the shortest path between two items.

```
kanecta_graph_path(
  fromId: string,
  toId: string,
  maxHops?: number             -- default: 10
) → {
  found: boolean,
  hops: number,
  path: Array<{ itemId: string, relationshipId?: string, edgeType?: string }>
}
```

### kanecta_graph_neighbourhood *(new)*
Return the subgraph around an item — all items and relationships within N hops, structured as a graph.

```
kanecta_graph_neighbourhood(
  id: string,
  depth?: number               -- default: 2
) → {
  nodes: Array<{ id: string, type: string, value: string }>,
  edges: Array<{ id: string, sourceId: string, targetId: string, type: string, confidence: string }>
}
```

Useful for giving an AI agent a visual/structural picture of an item's context before reasoning about it.

---

## Relationship tools

### kanecta_relate
Create a typed relationship between two items. Currently faked with text — this becomes a proper relationship item.

```
kanecta_relate(
  sourceId: string,
  targetId: string,
  typeId: string,              -- UUID of the relationship-type item
  data?: object,               -- payload validated against relationship type's jsonSchema
  confidence?: string,         -- default: "experimental" for AI-created
  note?: string,
  sourceRunId?: string
) → RelationshipItem
```

### kanecta_unrelate *(new)*
Delete a relationship item by UUID. Snapshots to history before deleting.

```
kanecta_unrelate(relationshipId: string) → void
```

### kanecta_update_relationship *(new)*
Update a relationship's data, confidence, or note.

```
kanecta_update_relationship(
  relationshipId: string,
  data?: object,
  confidence?: string,
  note?: string
) → RelationshipItem
```

### kanecta_get_relationships
Get all relationships for an item. Extend with direction filter:

```
kanecta_get_relationships(
  id: string,
  direction?: "outbound" | "inbound" | "both",  -- default: "both"
  typeId?: string              -- filter to a specific relationship type
) → RelationshipItem[]
```

---

## Annotation tools *(new)*

Annotations are threaded comments on items without modifying them. In the nodes model they are items of type `"annotation"` living in the `"annotations"` aspect of their target's node.

### kanecta_add_annotation
```
kanecta_add_annotation(
  targetId: string,
  value: string,
  parentAnnotationId?: string  -- for threaded replies
) → AnnotationItem
```

### kanecta_get_annotations
```
kanecta_get_annotations(
  targetId: string
) → AnnotationItem[]           -- threaded, ordered by created_at
```

---

## Capture tool

### kanecta_capture
Save a thought, finding, or insight to Kanecta. Unchanged from current. Add `confidence`, `sourceRunId`, and `tags` parameters.

---

## Summary of new tools

| Tool | Closes gap from kanecta.md |
|---|---|
| `kanecta_get_many` | Eliminates N round trips after graph queries |
| `kanecta_bulk_create` | Bulk item creation |
| `kanecta_bulk_update` | Bulk update |
| `kanecta_move` | Move / reparent |
| `kanecta_delete_subtree` | Delete subtree |
| `kanecta_clone_subtree` | Copy/clone subtree |
| `kanecta_get_ancestors` | Navigate up the tree |
| `kanecta_search` (extended) | Scoped search, filter-by-type, filter-by-tag, vector + graph |
| `kanecta_graph_related` | Graph traversal |
| `kanecta_graph_path` | Shortest path |
| `kanecta_graph_neighbourhood` | Subgraph around an item |
| `kanecta_relate` (proper) | Relationships API — was faked with text |
| `kanecta_unrelate` | Delete relationship |
| `kanecta_update_relationship` | Update relationship |
| `kanecta_add_annotation` | Annotations API |
| `kanecta_get_annotations` | Annotations API |
| `sortOrder` on add/update | Sort order control |
| `alias` on add/update | Alias setting |
