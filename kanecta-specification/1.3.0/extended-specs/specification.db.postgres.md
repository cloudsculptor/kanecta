# Kanecta Datastore Specification — PostgreSQL

**Version:** 1.3.0
**Base spec:** [specification.db.md](specification.db.md)
**License:** [MIT](LICENSE) — © 2026 Richard Thomas

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

### status / completed_at

`metadata.json` also defines `status` (arbitrary lifecycle string, e.g. `active`/`archived`/`draft`) and `completedAt` (timestamp), both absent from `001_init.sql`. Migration `002_status_types_and_functions.sql` adds:

```sql
ALTER TABLE items
    ADD COLUMN status       VARCHAR(50),
    ADD COLUMN completed_at TIMESTAMPTZ;
CREATE INDEX idx_items_status ON items(status);
```

### due_at

`metadata.json` also defines `dueAt` (timestamp) — "when this item is due", a sibling concept to `completedAt` ("when this item was completed") rather than a replacement for it. Migration `006_due_at.sql` adds:

```sql
ALTER TABLE items
    ADD COLUMN due_at TIMESTAMPTZ;
```

### types — sync / superseded_by / implements / extends

`type.json` defines four type-level UUID-list cross-references, absent from `002_status_types_and_functions.sql`'s original `types` table. Migration `007_type_sync_and_superseded.sql` adds them, mirroring the existing `meta_functions_consumed_by`/`meta_functions_produced_by UUID[]` columns:

```sql
ALTER TABLE types
    ADD COLUMN sync           UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN superseded_by  UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN implements     UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN extends        UUID[] NOT NULL DEFAULT '{}';
```

- `sync` — UUIDs of `function`-primitive items that can refresh instances of this type from their original/external source.
- `superseded_by` — UUIDs of type definitions that replace this one (Kanecta types are immutable; a changed shape always means a new type).
- `implements` — UUIDs of types whose shape/contract this type fulfils, programming-language-interface style.
- `extends` — UUIDs of types this type extends/specialises, programming-language-class style.

None of these imply storage inheritance or constrain `sqlSchema` — they are purely declared relationships between type definitions.

### items.license — dedicated `licences` reference table

`metadata.json` originally defined `license` as a free-text identifier (e.g. `'CC-BY-4.0'`), stored as `license VARCHAR(100)` in `001_init.sql`. Migrations `009_license_reference.sql` and `010_licences_table.sql` replace it with a hard, `NOT NULL` foreign key to a dedicated `licences` lookup table, defaulting to "All Rights Reserved" — mirroring real-world copyright, where a work is copyrighted by default unless a licence says otherwise:

```sql
CREATE TABLE licences (
    id      UUID PRIMARY KEY,
    name    TEXT NOT NULL,
    spdx_id TEXT UNIQUE,
    url     TEXT,
    text    TEXT
);

ALTER TABLE items
    ALTER COLUMN license SET DEFAULT '<all-rights-reserved-uuid>',
    ALTER COLUMN license SET NOT NULL;
ALTER TABLE items
    ADD CONSTRAINT fk_items_license FOREIGN KEY (license) REFERENCES licences(id);
```

`010_licences_table.sql` seeds it with a fixed, well-known reference set covering "All Rights Reserved (Copyright)" (the default), Public Domain / CC0, every Creative Commons 4.0 variant, and the common software licences (MIT, Apache-2.0, GPL, LGPL, BSD, MPL, ISC, Unlicense). `text` is left for an application to backfill/cache from `url` if it wants full licence text stored locally — inlining ~19 full licence texts into a migration was judged not worth the bloat.

**Acknowledged shortcut.** This is *not* where licences are headed long-term — every other reusable, referenceable concept in Kanecta (Person, Pet, …) is modelled as a standalone custom-type item, referenced via the `typeId` convention, with its own author-defined `sqlSchema`-generated table. Licence should eventually follow that same pattern. A dedicated fixed table was chosen for now because (a) this is a small, genuinely enumerable, well-known reference set, (b) it benefits from referential integrity and a column `DEFAULT` immediately, and (c) modelling it as a shipped custom type would mean Kanecta forcing an imported type/items into every datastore before licensing is even usable — exactly the kind of foundational dependency presently being avoided while the type system itself is still being designed. Migrating these rows into real items later — preserving their UUIDs — is a plain data move; nothing that stores or reads `items.license` would need to change.

### items.visibility / item_grants — access control

`metadata.json` defines `visibility` (a coarse default access level: `private` / `organisation` / `public`) as a column on `items`, and fine-grained per-principal `read`/`write`/`subscribe` grants live in a companion `item_grants` table. Migration `008_access_control.sql` adds:

```sql
ALTER TABLE items
    ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'private'
        CHECK (visibility IN ('private', 'organisation', 'public'));
CREATE INDEX idx_items_visibility ON items(visibility);

CREATE TABLE item_grants (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id        UUID        NOT NULL REFERENCES items(id),
    principal_id   UUID        NOT NULL,
    principal_type VARCHAR(50) NOT NULL,
    permission     VARCHAR(20) NOT NULL
                       CHECK (permission IN ('read', 'write', 'subscribe')),
    granted_by     UUID        NOT NULL,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ,
    CONSTRAINT uq_item_grants_principal_permission UNIQUE (item_id, principal_id, permission)
);
CREATE INDEX idx_item_grants_item ON item_grants(item_id);
CREATE INDEX idx_item_grants_principal ON item_grants(principal_id);
```

**Two layers, evaluated together:**
- `visibility` is the cheap, no-join fast path covering the common case — most items are either `private` (owner and explicitly-granted principals only), `organisation` (anyone in the owner's organisation) or `public`.
- `item_grants` layers fine-grained, per-principal permissions on top — e.g. "this specific group also gets `write`", or "these three people may `subscribe`" (kept separate from `read` because subscriptions carry a real cost: recording them and pushing updates). Grants can only *extend* what `visibility` allows, never narrow it — there is deliberately no deny mechanism yet (see below).

**Why `principal_id` is a bare `UUID`, not a foreign key to `items`:** a principal (user, group, service account, …) may be a Kanecta item one day (e.g. a future shipped `Group` type), a Keycloak-resolved identifier today, or a row in some entirely different identity store tomorrow. Keeping it opaque means grants keep working unchanged no matter where or how identities end up being stored — swapping identity sources becomes a data migration ("give this group row a matching item, keep the UUID"), never a grants rewrite. `principal_type` records what kind of principal it is (`user`, `group`, …) so the application knows how to resolve it; it is deliberately *not* constrained to a fixed set of values, since new principal kinds shouldn't require a schema migration to introduce.

**Deliberately deferred (additive later, not designed away):** deny-rules/negative grants, inheritance/cascading of grants down the tree, and recursive group membership. None of these are precluded by this shape — they're graph-walks and extra rows on top of the same `(principal, action, resource)` data model — they're just not needed for the first cut.

### children — denormalised UUID[] cache on items

`metadata.json`'s parent/child relationship is, and remains, defined solely by `items.id` / `items.parent_id` — that is the source of truth. Migration `003_items_children_cache.sql` adds a `children UUID[]` column to `items` purely as a read-performance cache:

```sql
ALTER TABLE items
    ADD COLUMN children UUID[] NOT NULL DEFAULT '{}';
CREATE INDEX idx_items_children ON items USING GIN (children);
```

This turns "get an item's children" from a lookup/join on `parent_id` into a single-row array read, which makes tree reads (e.g. building a subtree for the studio UI) substantially faster.

`children` is kept in lock-step with `parent_id` by a database trigger (`trg_items_sync_children` / `items_sync_children()`, defined in `003_items_children_cache.sql`) rather than in application code — this guarantees correctness under *any* write path, including raw-SQL tools that bypass the adapter (e.g. the filesystem→postgres migration script). On `INSERT` the new row's id is appended to its parent's `children`; on `UPDATE` of `parent_id` it is moved from the old parent's array to the new parent's; on `DELETE` it is removed from its parent's array. The root item is self-referential (`parent_id = id`) and is excluded from its own `children` array. If `children` and `parent_id` ever disagree, `parent_id` wins — `children` can always be rebuilt with `array_agg(id) GROUP BY parent_id`.

### spec_version — per-item column on items

`metadata.json` requires every record to carry `specVersion` (e.g. `'1.3.0'`) — the version of the Kanecta specification that record's shape conforms to, recorded at creation time so tooling can pick the right schema/migration rules when reading older records. Migration `017_item_spec_version.sql` adds it as a plain column on `items`:

```sql
ALTER TABLE items ADD COLUMN IF NOT EXISTS spec_version TEXT NOT NULL DEFAULT '1.3.0';
```

Existing rows are backfilled to `'1.3.0'` (the version they were created under); `create()`/`createType()` stamp new rows with the running `@kanecta/specification` package's `version`. This is distinct from the singleton `schema_version` table below, which tracks the *database schema's* version, not individual items' spec conformance.

### schema_version — app/database lock-step check

A singleton `schema_version` table (added in `004_schema_version.sql`) records the schema's current version as a `major.minor.patch` string (e.g. `'1.1.1'`):

```sql
CREATE TABLE schema_version (
    id         BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
    version    VARCHAR(32) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The application reads this at connection time (`SELECT version FROM schema_version`) and compares it against the schema version it expects, refusing to run (or warning loudly) on a mismatch — this is what keeps the app and database "in lock-step". Each migration that changes the schema bumps the row via upsert:

```sql
INSERT INTO schema_version (id, version)
VALUES (TRUE, '1.1.0')
ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW();
```

### object.json / function.json — fully normalised, no JSON blobs

Rather than storing `object.json`/`function.json` sidecar payloads as opaque JSON blobs, the postgres implementation normalises them into real tables. **`types.json_schema` is the only JSON column anywhere in this schema** — it holds the JSON Schema Draft-07 document itself (kept verbatim, since it *is* a schema, not instance data). Everything else is columns and rows.

#### `types` — mirrors `type.json`, 1:1 with `items`

One row per item with `type='type'`. `table_name` records the per-type table backing this type's instances (see below) — `NULL` until the type's first `object` item is created.

```sql
CREATE TABLE types (
    item_id  UUID PRIMARY KEY REFERENCES items(id),
    table_name VARCHAR(63) UNIQUE,
    meta_icon, meta_description, meta_details, meta_keywords,
    meta_tags, meta_primary_field, meta_ai_instructions_claude,
    meta_functions_consumed_by UUID[], meta_functions_produced_by UUID[],
    json_schema JSONB NOT NULL
);
```

#### `functions` (+ child tables) — mirrors `function.json`, 1:1 with `items`

One row per item with `type='function'`. Scalar fields (`description`, `is_async`, `is_ai`, `skill_id`, `return_type`/`return_type_id`, `deprecated_notice`, `body`, `include_kanecta_sdk`, `dependencies`) are columns on `functions`. Array-of-object fields become child tables ordered by `sort_order`:

- `function_type_parameters` — `function.typeParameters[]`
- `function_parameters` — `function.parameters[]` (each row enforces `type` XOR `type_id`, mirroring the spec's `oneOf`)
- `function_throws` — `function.throws[]`

`function.dependencies` (an array of plain strings) is a native `TEXT[]` column — no child table needed for scalar arrays.

#### Per-type tables — one flat table per type, defined by the author via `sqlSchema`

Kanecta types are **flat — exactly one level deep** (see `file-specs/type.json` and `specification.md`). Every property in a type's `jsonSchema.properties` is one of:
- a **primitive** (`string`/`number`/`integer`/`boolean`, optionally with `format`)
- an **array of primitives**
- a **reference to another standalone type**, written `{ "type": "string", "format": "uuid", "typeId": "<uuid>" }` (the same `typeId` convention as `metadata.json`/`function.json.parameters[]` — deliberately not `$ref`, which would wrongly imply the value is validated against the referenced type's full shape rather than being a UUID pointer to it)

Inline nested objects and arrays of objects are **not permitted** — a reusable nested concept must be its own standalone type, referenced via `typeId`. This guarantees **every type maps to exactly one table**, with a purely mechanical, near 1:1 mapping:

| `jsonSchema` property | SQL column |
|---|---|
| primitive (`string`, `string`+`format:date`, `integer`, `number`, `boolean`, `string`+`format:uuid`, …) | `TEXT` / `DATE` / `INTEGER` / `NUMERIC` / `BOOLEAN` / `UUID` |
| array of primitives | native array column, e.g. `TEXT[]`, `INTEGER[]` |
| `typeId` reference | `UUID` column with `FOREIGN KEY ... REFERENCES items(id)` |

`type.json` requires a `sqlSchema` field: an ordered list of complete SQL DDL statements that, run against a database that already has `items`, create everything needed for that type — the table, its FK relationships/constraints (inline `REFERENCES` preferred), and indexes. The adapter never infers table shape from `json_schema` at runtime; it just executes `sqlSchema` once, at type-creation time. Even though the mapping is now mechanical, `sqlSchema` stays author-defined (typically generated alongside `jsonSchema` by a UI flow or Claude) rather than runtime-inferred — it's the explicit, immutable record of exactly what was run, and it's what makes the contract "run this SQL, get the storage" hold without any adapter-side generation logic in the loop.

**Required even for filesystem-only types** — every type defines `sqlSchema` regardless of whether its datastore currently uses Postgres, so a future filesystem→cloud migration never needs retrofitting.

**Naming convention.** Table: `obj_<type-uuid-with-hyphens-replaced-by-underscores>` (raw UUIDs aren't valid unquoted SQL identifiers). Columns are named to match `jsonSchema` property names, so the correspondence between an `object.json` instance and its SQL row is unambiguous from naming alone. Strict **1:1 with `items`** via `item_id PRIMARY KEY REFERENCES items(id)`.

```sql
-- Worked example: "Person" — name/born/died (primitives), nicknames (array of
-- primitives), favouritePet (typeId reference to a standalone "Pet" type)
CREATE TABLE "obj_f1e2d3c4_b5a6_7890_abcd_ef1234567890" (
    item_id UUID NOT NULL,
    "name" TEXT,
    "born" DATE,
    "died" DATE,
    "nicknames" TEXT[],
    "favourite_pet" UUID,
    CONSTRAINT "pk_obj_f1e2d3c4..." PRIMARY KEY (item_id),
    CONSTRAINT "fk_obj_f1e2d3c4..._item" FOREIGN KEY (item_id) REFERENCES items(id),
    CONSTRAINT "fk_obj_f1e2d3c4..._favourite_pet" FOREIGN KEY (favourite_pet) REFERENCES items(id)
);
```

This mirrors `readObjectJson`/`writeObjectJson`/`readFunctionJson`/`writeFunctionJson` in `@kanecta/filesystem`, which read/write `object.json`/`function.json` from `<item-dir>/`.

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
