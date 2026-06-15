# Graph Projection — Apache AGE

## Philosophy

Apache AGE is a projection layer, not a store. It is derived from Kanecta's relational tables, expendable, and rebuildable at any time. Nothing authoritative lives in AGE. Losing the graph projection means losing Cypher-based traversal queries — not losing data.

This is the same philosophy as the SQLite index in the layered filesystem datastore, and the embeddings table for semantic search. Kanecta's Postgres tables are always the source of truth.

---

## Why AGE

SQL handles point lookups, filtering, and shallow joins well. It handles multi-hop traversal poorly — recursive CTEs become complex and slow as depth increases. Questions like:

- "Find everything connected to item X within 3 hops"
- "What is the shortest path between item A and item B?"
- "Find all items of type Decision that are upstream of this component"
- "Show me the neighbourhood of this item across all relationship types"

These are graph questions. AGE answers them in a single Cypher query. Postgres answers them in nested recursive CTEs that grow in complexity with depth.

AGE sits on top of the same Postgres instance as Kanecta's tables — no separate database, no sync infrastructure.

---

## What Kanecta is richer than AGE at

AGE is a property graph: vertices with labels and properties, edges with types and properties. Kanecta's data model is a superset:

| Kanecta feature | In AGE |
|---|---|
| Typed relationship schemas (jsonSchema on relationship types) | No — edges have untyped properties |
| Inverse relationship pairings | No — traverse both directions manually |
| Confidence on edges | As a property only — no semantic meaning |
| Relationship history and audit trail | No |
| Decision items with full reasoning | As vertex properties only |
| Bitemporal history | No |

**AGE is not used as a richer store — it is used purely as a traversal index.** AGE queries return UUIDs. Those UUIDs are then resolved against Kanecta's full relational data for the complete picture.

```
AGE query → set of UUIDs → Kanecta items/relationships tables → full rich data
```

---

## Mapping Kanecta to AGE

### Items → vertices

Every non-relationship item becomes a vertex:

```cypher
CREATE (:Item {
  id: $id,
  type: $type,
  value: $value,
  namespace: $namespace,
  confidence: $confidence
})
```

Only traversal-relevant properties are stored in AGE. Full item data stays in Postgres. The vertex label is `Item` for all items; the `type` property carries the Kanecta type.

Optionally, a secondary label can mirror the Kanecta type for more expressive Cypher:

```cypher
CREATE (:Item:Decision { id: $id, ... })
```

### Relationship items → edges

Items where `source_id IS NOT NULL` are relationship items. Each becomes an AGE edge:

```cypher
MATCH (a:Item {id: $source_id}), (b:Item {id: $target_id})
CREATE (a)-[:RELATES { id: $id, label: $label, confidence: $confidence }]->(b)
```

The edge type is the relationship type's `value` (e.g. `DEPENDS_ON`, `BLOCKS`, `DERIVED_FROM`), uppercased and with hyphens replaced by underscores for Cypher compatibility.

Edge properties: `id` (relationship item UUID), `confidence`, `owner`. Full relationship data (payload, history, annotations) resolved from Postgres by UUID.

### What is not mirrored

- Node items (type: `"node"`) — tree structure is a Kanecta concept, not a graph concept. Relationships are the graph.
- History items, annotation items, alias items — metadata, not graph edges.
- System and app namespace items — excluded by default; traversal queries scope to `namespace = 'user'` unless explicitly broadened.

---

## Sync pattern

### Trigger-based (recommended)

Three Postgres triggers keep AGE in sync automatically:

```sql
-- On item insert/update (non-relationship item): upsert vertex
CREATE OR REPLACE FUNCTION sync_item_to_age() RETURNS trigger AS $$
BEGIN
  -- Delete existing vertex if present
  PERFORM * FROM cypher('kanecta_graph', $$
    MATCH (n:Item {id: $id}) DELETE n
  $$, json_build_object('id', NEW.id)) AS (result agtype);

  -- Create updated vertex
  IF NEW.source_id IS NULL THEN
    PERFORM * FROM cypher('kanecta_graph', $$
      CREATE (:Item { id: $id, type: $type, value: $value,
                      namespace: $ns, confidence: $conf })
    $$, json_build_object(
      'id', NEW.id, 'type', NEW.type, 'value', NEW.value,
      'ns', NEW.namespace, 'conf', NEW.confidence
    )) AS (result agtype);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_item_to_age
  AFTER INSERT OR UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION sync_item_to_age();
```

A corresponding trigger handles relationship items (those with `source_id IS NOT NULL`) to create/update edges.

On item delete, a trigger removes the vertex or edge.

### Backfill

When AGE is first added to an existing Kanecta Postgres instance:

```sql
-- 1. Create vertices for all non-relationship items
SELECT * FROM items
WHERE source_id IS NULL
  AND valid_to IS NULL
  AND namespace = 'user';
-- → batch CREATE vertex statements

-- 2. Create edges for all relationship items
SELECT * FROM items
WHERE source_id IS NOT NULL
  AND valid_to IS NULL;
-- → batch CREATE edge statements
```

The backfill is a one-time operation. Triggers handle ongoing sync after that.

---

## Common graph queries

### Items connected to X within N hops
```cypher
MATCH (start:Item {id: $id})-[*1..3]-(connected:Item)
RETURN DISTINCT connected.id
```

### Shortest path between two items
```cypher
MATCH path = shortestPath(
  (a:Item {id: $from})-[*]-(b:Item {id: $to})
)
RETURN [node IN nodes(path) | node.id] AS ids,
       length(path) AS hops
```

### All items that depend on X (transitive)
```cypher
MATCH (x:Item {id: $id})<-[:DEPENDS_ON*1..]->(dependent:Item)
RETURN DISTINCT dependent.id
```

### Neighbourhood subgraph
```cypher
MATCH (centre:Item {id: $id})-[r*1..2]-(neighbour:Item)
RETURN centre.id, neighbour.id, type(r[0]) AS edge_type
```

---

## Combined search pipeline

AGE is one of three signals in Kanecta's full search pipeline:

```
1. pg_vector  → candidate UUIDs by semantic similarity (score: cosine distance)
2. Postgres FTS → candidate UUIDs by keyword match (score: ts_rank)
3. AGE         → expand candidates via graph (score: inverse hop distance from seed UUID)
```

Combined re-rank:

```sql
SELECT
  id,
  (vector_score * 0.35) + (fts_score * 0.25) + (graph_score * 0.40) AS combined
FROM candidates
ORDER BY combined DESC
LIMIT $limit;
```

Weights are tunable. Graph weight is highest when a seed UUID is provided (navigation mode). Vector weight is highest for open-ended discovery queries with no seed.

The full combined search tool is specified in [mcp-api-surface.md](mcp-api-surface.md) as `kanecta_search`.

---

## Rebuilding the graph

The AGE graph is fully rebuildable from Kanecta's items table at any time:

```sql
-- Drop and recreate
SELECT drop_graph('kanecta_graph', true);
SELECT create_graph('kanecta_graph');
-- Run backfill (above)
```

No data is lost. The rebuild takes as long as it takes to walk the items table — proportional to datastore size, typically minutes for a large datastore.
