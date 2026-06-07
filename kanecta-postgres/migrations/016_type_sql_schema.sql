-- type.json requires `sqlSchema` (the type's immutable storage DDL), but the
-- `types` table never persisted it — only the obj_<typeId> table it produced.
-- Without it, readTypeJson/writeTypeJson can't round-trip the full type.json
-- shape (needed by GET/PUT /types/:id/schema).

ALTER TABLE types
    ADD COLUMN IF NOT EXISTS sql_schema TEXT[] NOT NULL DEFAULT '{}';
