# Kanecta Datastore Specification — PostgreSQL

**Version:** 1.2.0
**Base spec:** [specification.db.md](specification.db.md)

This document describes the PostgreSQL-specific implementation of the Kanecta database datastore. It extends the base `specification.db.md` with dialect decisions, type mappings, and postgres-native features. Read the base spec first; this document only records where postgres differs or where a choice must be made explicit.

---

## 1. Type Mappings

| Base spec type | Postgres type | Notes |
|---|---|---|
| `CHAR(36)` UUID | `UUID` | Native UUID type; no hyphens stored separately; comparison is byte-level |
| `TEXT` / `VARCHAR` | `TEXT` / `VARCHAR` | Unchanged |
| `TIMESTAMP` | `TIMESTAMPTZ` | All timestamps stored with timezone (UTC). Application always writes UTC |
| `BLOB` (files.content) | `BYTEA` | Postgres byte array |
| `BOOLEAN` | `BOOLEAN` | Native; no integer substitution |
| `snapshot TEXT` (history) | `JSONB` | Stored as JSONB for structured querying and compression |
| `tags` (item_tags junction) | `TEXT[]` on `items` | Tags are stored as a native array column on `items` rather than a separate junction table (see §2) |

---

## 2. Schema Divergences from Base Spec

### tags — array column, not junction table

The base spec stores tags in a separate `item_tags` junction table. The postgres implementation inlines tags as a `TEXT[]` column on `items`:

```sql
tags TEXT[] NOT NULL DEFAULT '{}'
```

A GIN index makes tag queries efficient:

```sql
CREATE INDEX idx_items_tags ON items USING GIN (tags);
```

Tag queries:
```sql
-- Items with tag 'urgent'
SELECT * FROM items WHERE 'urgent' = ANY(tags);

-- Items with all of a set of tags
SELECT * FROM items WHERE tags @> ARRAY['urgent', 'reviewed'];
```

This eliminates a join for the common case of reading a single item's tags, and simplifies create/update transactions.

### history.snapshot — JSONB

`history.snapshot` stores the full JSON item row as `JSONB` rather than `TEXT`. This allows partial reads and indexed querying of history without JSON parsing at the application layer:

```sql
-- Find history entries where value changed to a specific string
SELECT * FROM history WHERE snapshot->>'value' = 'some value';
```

### items self-referential FK — DEFERRABLE

The `root` item is self-referential (`parent_id = id`). To allow inserting `root` in the same transaction that creates the schema, the FK is deferred:

```sql
CONSTRAINT fk_items_parent
    FOREIGN KEY (parent_id) REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED
```

---

## 3. Full-Text Search

Use `pg_trgm` for trigram-based similarity search over `items.value`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_items_value_trgm ON items USING GIN (value gin_trgm_ops);
```

Search query:
```sql
SELECT *, similarity(value, $1) AS score
FROM items
WHERE value % $1
ORDER BY score DESC
LIMIT 50;
```

For longer text values, `tsvector`-based FTS is preferred:

```sql
ALTER TABLE items ADD COLUMN IF NOT EXISTS search_vector TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(value, ''))) STORED;

CREATE INDEX idx_items_fts ON items USING GIN (search_vector);
```

FTS query:
```sql
SELECT * FROM items
WHERE search_vector @@ plainto_tsquery('english', $1)
ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC;
```

Both indexes may coexist: trigram for short phrases and fuzzy matching, tsvector for document-scale text fields.

---

## 4. Connection and Pooling

- Use `pg.Pool` from the `pg` npm package. The application owns the pool lifecycle.
- Minimum recommended pool size: 2. Maximum: tune to `(num_cores * 2) + 1`.
- Set `statement_timeout` to prevent runaway queries (recommended: 30 000 ms).
- Set `idle_in_transaction_session_timeout` to prevent hung transactions (recommended: 10 000 ms).

```js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 10_000,
});
```

---

## 5. Migrations

Migrations live in `kanecta-postgres/migrations/` and are named `NNN_description.sql`. The adapter runs them in filename order at `init()` time. All DDL uses `IF NOT EXISTS` so re-running is safe.

Future migrations must be additive. Never drop columns or tables in a migration — soft-delete or rename with a deprecation comment instead.

---

## 6. Transactions and Isolation

- All multi-step operations (create, update, delete, relate) must run inside a transaction.
- Default isolation level: `READ COMMITTED`.
- For bulk operations or index rebuilds: use `SERIALIZABLE` to prevent phantom reads.

```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // ... operations ...
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

---

## 7. Initialisation SQL

```sql
BEGIN;

-- 1. root (self-referential) — FK is deferred so this is safe in one transaction
INSERT INTO items (id, parent_id, value, type, sort_order, owner, tags,
                   created_at, modified_at, created_by, modified_by, is_remote)
VALUES ('00000000-0000-0000-0000-000000000000',
        '00000000-0000-0000-0000-000000000000',
        'root', 'root', 0, $owner, '{}',
        NOW(), NOW(), $owner, $owner, FALSE)
ON CONFLICT (id) DO NOTHING;

-- 2. Four well-known children of root
INSERT INTO items (id, parent_id, value, type, sort_order, owner, tags,
                   created_at, modified_at, created_by, modified_by, is_remote)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'system_root',    'system_root',    0, $owner, '{}', NOW(), NOW(), $owner, $owner, FALSE),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'app_root',       'app_root',       1, $owner, '{}', NOW(), NOW(), $owner, $owner, FALSE),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'component_root', 'component_root', 2, $owner, '{}', NOW(), NOW(), $owner, $owner, FALSE),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'data_root',      'data_root',      3, $owner, '{}', NOW(), NOW(), $owner, $owner, FALSE)
ON CONFLICT (id) DO NOTHING;

COMMIT;
```

Singleton enforcement — check before inserting well-known children:
```sql
SELECT COUNT(*) FROM items WHERE type = $well_known_type;
-- If count > 0, skip insert
```

---

## 8. Constraints and Assumptions

All constraints from the base spec apply. Postgres-specific additions:

- UUIDs are stored as the native `UUID` type. `gen_random_uuid()` (postgres ≥ 13) generates UUID v4.
- All timestamps are `TIMESTAMPTZ`. Applications must always pass UTC values.
- The `tags` array is authoritative; no separate `item_tags` table exists in this implementation.
- `history.snapshot` is `JSONB`. The serialised item must be a valid JSON object.
- The self-referential FK on `items(parent_id)` is deferred to allow single-transaction initialisation.
- `pg_trgm` extension is required for fuzzy search. Install with `CREATE EXTENSION IF NOT EXISTS pg_trgm`.
