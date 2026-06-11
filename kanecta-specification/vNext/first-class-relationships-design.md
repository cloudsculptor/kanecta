# First-Class Relationships Design

## The idea

Relationships are typed items — just like any other item in the system. They have a direction (source → target) and a label, and they live as their own files/rows alongside everything else.

A relationship item:

```json
{
  "id": "rel-uuid",
  "type": "rel-type-uuid",
  "label": "depends on",
  "source": "item-uuid-a",
  "target": "item-uuid-b"
}
```

Direction is implicit — `source → target`. The type is a reference to a relationship type item, same as any other typed item.

---

## Why not store outgoing/incoming arrays on the item

The obvious alternative is to put `outgoing` and `incoming` UUID arrays directly on each item's `item.json`. This seems convenient but has real problems:

- **Three-file writes** — creating one relationship touches three files: the relationship item, the source item, and the target item. Noisy git diffs and a consistency hazard if a write is interrupted halfway.
- **Cascading deletes** — deleting or moving an item means cleaning up arrays on other items.
- **Coupling** — items become aware of their relationships, which ties them together unnecessarily.

With relationship-as-item, the git story is clean:
- Create a relationship → one new file appears
- Delete a relationship → one file disappears
- Change a label → one file diff
- Endpoint items are completely untouched

---

## Storage on the filesystem

Relationship items live in the data folder like any other item:

```
k/data/ab/cd/<rel-uuid>/
  item.json   ← { type, source, target, label }
```

No separate relationships folder needed. `rebuildIndexes()` can reconstruct the SQLite relationship index by scanning items where `source IS NOT NULL`.

---

## Storage in SQLite

Relationships are just rows in the `items` table with `source` and `target` columns populated. Partial indexes make lookups fast without slowing down non-relationship item queries:

```sql
CREATE INDEX idx_relationships_source ON items(source) WHERE source IS NOT NULL;
CREATE INDEX idx_relationships_target ON items(target) WHERE target IS NOT NULL;
```

Finding all relationships for an item:

```sql
SELECT * FROM items WHERE source = $1 OR target = $1
```

---

## Storage in Postgres

Same model — relationship items are rows in the `items` table. No separate edges table needed. Same partial indexes apply.

The payoff of treating relationships as items rather than a separate table: all the same CRUD, history, annotations, and type machinery works on relationships for free. A relationship can be annotated, can have a type with a schema, can have its own relationships (meta-relationships). No special-case code paths.

---

## Export to Neo4j

This model maps almost perfectly to Neo4j's property graph model:

| Kanecta | Neo4j |
|---|---|
| Regular item | Node |
| Relationship item | Edge |
| Item fields | Node properties |
| Relationship fields (label etc.) | Edge properties |
| `source` → `target` | Direction |

Export is mechanical — one Cypher statement per relationship item:

```cypher
MATCH (a {id: $source}), (b {id: $target})
CREATE (a)-[:DEPENDS_ON { label: $label }]->(b)
```

**What you'd get in Neo4j for free:**
- Graph traversal — "find everything connected to X within 3 hops"
- Shortest path between two items
- Pattern matching — "find all items of type A that depend on items of type B"
- Visual graph exploration

**The one mismatch** — Neo4j edges can't have edges. Kanecta technically allows relationships between relationships since they're items. That won't export cleanly, but it's an edge case most graphs never need.

The broader point: by modelling relationships as first-class typed items with source and target, Kanecta's data model is a property graph. Neo4j, Memgraph, and similar engines expect exactly this shape. The export is almost mechanical.
