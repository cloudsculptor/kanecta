-- Kanecta postgres schema — spec version 1.4.0
--
-- Brings the items table to the 1.4.0 item model:
--   - Materialized path column for O(1) subtree reads (replaces recursive CTEs on the hot path)
--   - soft-delete lifecycle: deleted_at
--   - Connector / virtual-DOM fields: expires_at, connector_id, materialized
--   - Time section storage: time_data JSONB
--   - Remove stale 1.3.x columns: subscribed_at, subscription_source, is_remote
--   - Drop chk_items_cached_at (depended on is_remote)
--   - Drop chk_items_type CHECK — too many built-in types now (30+), rely on app validation
--   - Drop chk_relationships_type CHECK — custom rel types now supported via rel_types table
--   - Add rel_types table: seeded with built-in types, open for addRelTypes()
--   - Update history.change_type CHECK to include soft-delete and restore events

-- ── Drop stale constraints before column changes ───────────────────────────────

ALTER TABLE items DROP CONSTRAINT IF EXISTS chk_items_cached_at;
ALTER TABLE items DROP CONSTRAINT IF EXISTS chk_items_type;
ALTER TABLE relationships DROP CONSTRAINT IF EXISTS chk_relationships_type;

-- ── Remove stale 1.3.x columns ────────────────────────────────────────────────

ALTER TABLE items DROP COLUMN IF EXISTS subscribed_at;
ALTER TABLE items DROP COLUMN IF EXISTS subscription_source;
ALTER TABLE items DROP COLUMN IF EXISTS is_remote;

-- ── Add 1.4.0 columns ─────────────────────────────────────────────────────────

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS path         TEXT,
  ADD COLUMN IF NOT EXISTS expires_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS connector_id UUID,
  ADD COLUMN IF NOT EXISTS materialized BOOLEAN,
  ADD COLUMN IF NOT EXISTS time_data    JSONB;

-- ── Indexes for new columns ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_items_path         ON items(path);
CREATE INDEX IF NOT EXISTS idx_items_deleted_at   ON items(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_expires_at   ON items(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_connector_id ON items(connector_id) WHERE connector_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_materialized ON items(materialized, connector_id) WHERE materialized = false AND connector_id IS NOT NULL;

-- ── Populate path for all existing items ──────────────────────────────────────
-- Uses a recursive CTE rooted at the all-zeros UUID. Items without a path after
-- this step (disconnected from root) are left NULL — tree() falls back to CTE.

WITH RECURSIVE paths AS (
  SELECT id, id::text AS path
  FROM items
  WHERE id = '00000000-0000-0000-0000-000000000000'
  UNION ALL
  SELECT i.id, p.path || '/' || i.id::text
  FROM items i
  JOIN paths p ON i.parent_id = p.id AND i.id != i.parent_id
)
UPDATE items
SET path = paths.path
FROM paths
WHERE items.id = paths.id
  AND items.path IS NULL;

-- ── Custom relationship types ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rel_types (
  type TEXT NOT NULL,
  CONSTRAINT pk_rel_types PRIMARY KEY (type)
);

INSERT INTO rel_types (type) VALUES
  ('relates-to'), ('depends-on'), ('enables'), ('contradicts'),
  ('blocks'), ('blocked-by'), ('prerequisite-for'), ('derived-from'), ('supersedes')
ON CONFLICT DO NOTHING;

-- ── history.change_type: add soft-delete and restore ─────────────────────────

ALTER TABLE history DROP CONSTRAINT IF EXISTS chk_history_change_type;
ALTER TABLE history ADD CONSTRAINT chk_history_change_type CHECK (
  change_type IN ('create', 'update', 'delete', 'soft-delete', 'restore')
);
