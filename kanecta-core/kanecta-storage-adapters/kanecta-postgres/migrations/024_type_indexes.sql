-- Declared secondary indexes for a type's per-type projection table. The spec
-- (1.4.0) carries `indexes` in the type payload, peer to `jsonSchema`; the
-- adapter turns them into CREATE INDEX DDL (via @kanecta/schema-compiler) when
-- it materialises `obj_<typeId>`. Persisted here so readTypeJson can round-trip
-- the full type and _ensureProjection can rebuild the indexes on demand.

ALTER TABLE types
    ADD COLUMN IF NOT EXISTS indexes JSONB NOT NULL DEFAULT '[]';
