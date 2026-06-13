# Embeddings and Content Hash

## Two related concepts

**`content_hash`** — a SHA-256 fingerprint of an item's embeddable content. Lives on the item itself. Authoritative. Used by any projection layer to detect staleness.

**Embeddings** — vector representations of items for semantic search. A projection layer — derived, expendable, rebuildable. Postgres + pg_vector is the reference implementation. Not all backing stores will have an embedding layer.

---

## content_hash

### What it is

A SHA-256 hash of the canonical serialisation of `value` + `payload`. Stored as part of item meta. Recomputed and written on every item write.

```
content_hash = "sha256:" + hex(SHA-256(canonical(value, payload)))
```

Format: `sha256:<64 hex chars>` — 71 characters total.

### Canonical serialisation rule

This rule must be implemented identically by all Kanecta implementations. Divergence means hashes from different implementations never match, breaking cross-implementation sync and staleness detection.

**Rule:** Concatenate `value` and the JSON-serialised `payload` as follows:

1. `value` as a UTF-8 string (empty string if null)
2. JSON serialisation of `payload` with:
   - Keys sorted lexicographically at every level of nesting
   - No whitespace (no spaces, no newlines)
   - No trailing newline
   - Arrays preserve insertion order — do not sort arrays
   - Standard JSON encoding, no special escaping beyond JSON requirements
3. Concatenate: `{value}{payload_json}` (no separator)
4. If `payload` is null: hash just the value string

Example — item with `value: "calculateTotal"` and `payload: { "returnType": "number", "async": false }`:

```
Input string: calculateTotal{"async":false,"returnType":"number"}
SHA-256:      a3f1... (64 hex chars)
Stored as:    sha256:a3f1...
```

### What is excluded

Relationship context is excluded. Changing a relationship that points to or from this item does not change this item's `content_hash`. Projection layers that need to react to relationship changes handle that independently.

History, annotations, and node positions are also excluded — these are separate items, not part of the item's own content.

### Schema

```sql
-- Column on items table
content_hash CHAR(71)
```

Nullable — null means the hash has not yet been computed (e.g. items migrated from an older spec version). Applications should treat null as stale and recompute on next write.

### When to recompute

Recompute on every write that changes `value` or `payload`. Read operations never recompute. The hash is always current as of the last write.

---

## Embeddings

### Philosophy

Embeddings are a projection — the same philosophy as the AGE graph and the SQLite index. They are derived from the source of truth, never the source of truth themselves. An implementation with no vector store simply has no embedding layer. Losing the embeddings table means losing semantic search, not losing data.

### What gets embedded

`value` + `payload` — the same content that goes into `content_hash`. The embedding input string is constructed using the same canonical serialisation:

```
embedding_input = {value}{canonical_payload_json}
```

This means `content_hash` doubles as the cache key for the embedding — if the hash stored at embed time matches the current item hash, the embedding is current.

### Postgres schema

```sql
CREATE TABLE embeddings (
  item_id       CHAR(36)      NOT NULL,
  model         VARCHAR(100)  NOT NULL,
  vector        vector(1536)  NOT NULL,
  generated_at  TIMESTAMP     NOT NULL,
  content_hash  CHAR(71)      NOT NULL,

  CONSTRAINT pk_embeddings
    PRIMARY KEY (item_id, model),
  CONSTRAINT fk_embeddings_item
    FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE INDEX idx_embeddings_vector
  ON embeddings USING ivfflat (vector vector_cosine_ops)
  WITH (lists = 100);
```

The `content_hash` column stores the item's hash at the time the embedding was generated. Comparing this against the current `items.content_hash` detects staleness without a timestamp comparison.

### Multi-model support

The primary key is `(item_id, model)`. Each item can have embeddings from multiple models simultaneously. In practice, one active model is typical — but migration from one model to another is non-destructive:

1. Insert new rows with the new model name
2. Verify quality
3. Delete old model rows

No big-bang regeneration required.

### Staleness detection

```sql
-- Items with no embedding yet
SELECT i.id
FROM items i
LEFT JOIN embeddings e ON e.item_id = i.id AND e.model = $model
WHERE e.item_id IS NULL
  AND i.valid_to IS NULL
  AND i.namespace = 'user';

-- Items whose embedding is stale
SELECT i.id, i.content_hash AS current_hash, e.content_hash AS embedded_hash
FROM items i
JOIN embeddings e ON e.item_id = i.id AND e.model = $model
WHERE i.content_hash != e.content_hash
  AND i.valid_to IS NULL;
```

### Semantic search query

```sql
SELECT i.*, 1 - (e.vector <=> $query_vector) AS similarity
FROM embeddings e
JOIN items i ON i.id = e.item_id
WHERE e.model = $model
  AND i.valid_to IS NULL
  AND i.namespace = 'user'
ORDER BY e.vector <=> $query_vector
LIMIT $limit;
```

### Combined search — vector + FTS + graph

The full combined search pipeline is specified in [graph-projection.md](graph-projection.md). The vector score from this table is one of three signals combined with FTS rank and AGE graph proximity.

### Regeneration

A background worker or CLI command regenerates stale embeddings by:

1. Querying for stale or missing embeddings (queries above)
2. Fetching `value` + `payload` for each item
3. Calling the embedding model API
4. Upserting the `embeddings` row with the new vector and current `content_hash`

The embedding layer can be rebuilt from scratch at any time. Drop the table, recreate it, regenerate. No data is lost.
