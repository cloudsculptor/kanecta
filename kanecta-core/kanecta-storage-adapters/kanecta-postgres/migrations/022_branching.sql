-- Kanecta postgres schema — branching support
--
-- Implements the delta/overlay branch model described in the 1.4.0 spec.
-- A branch is never a full copy — it stores only what changed (additions,
-- modifications, deletions) relative to the main branch.
--
-- Reading an item on a branch: COALESCE branch override onto main tables.
-- Merge: apply all branch_changes to main tables in one transaction, then drop the branch.
--
-- item_references is a derived index of all structural UUID dependencies
-- within the item graph. It is maintained by the adapter on every item write
-- and used by the PR pre-flight scan to compute blast radius.

-- ── Branch registry ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS branches (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,
  base_branch TEXT        NOT NULL DEFAULT 'main',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  merged_at   TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_branches_name ON branches(name) WHERE deleted_at IS NULL;

-- ── Branch delta store ────────────────────────────────────────────────────────
-- One row per changed section per item. Sections mirror the five-section
-- item.json format: item, meta, search, payload, time.
-- change_type = 'create'  → item exists only in this branch (not in main tables)
-- change_type = 'update'  → item exists in main but is overridden on this branch
-- change_type = 'delete'  → item should be excluded when reading this branch

CREATE TABLE IF NOT EXISTS branch_changes (
  branch_id   UUID        NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  item_id     UUID        NOT NULL,
  change_type TEXT        NOT NULL CHECK (change_type IN ('create', 'update', 'delete')),
  section     TEXT        NOT NULL CHECK (section IN ('item', 'meta', 'search', 'payload', 'time')),
  data        JSONB,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, item_id, section)
);

CREATE INDEX IF NOT EXISTS idx_bc_branch      ON branch_changes(branch_id);
CREATE INDEX IF NOT EXISTS idx_bc_item        ON branch_changes(branch_id, item_id);
CREATE INDEX IF NOT EXISTS idx_bc_change_type ON branch_changes(branch_id, change_type);

-- ── item_references — structural UUID dependency index ────────────────────────
-- Tracks every UUID reference within the item graph so the PR pre-flight scan
-- can compute blast radius for any set of changed item IDs.
--
-- reference_type values:
--   parent          → item.parent_id
--   inline-link     → [[uuid]] in item.value
--   payload-field   → UUID-shaped value in items_payload JSON
--   relationship    → relationship item source/target

CREATE TABLE IF NOT EXISTS item_references (
  source_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  target_item_id UUID NOT NULL,
  reference_type TEXT NOT NULL,
  field_name     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_item_references_unique_with_field
  ON item_references(source_item_id, target_item_id, reference_type, field_name)
  WHERE field_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_item_references_unique_no_field
  ON item_references(source_item_id, target_item_id, reference_type)
  WHERE field_name IS NULL;

CREATE INDEX IF NOT EXISTS idx_item_references_target ON item_references(target_item_id);
CREATE INDEX IF NOT EXISTS idx_item_references_source ON item_references(source_item_id);

-- Seed existing parent references from current items table
INSERT INTO item_references (source_item_id, target_item_id, reference_type)
SELECT id, parent_id, 'parent'
FROM items
WHERE parent_id IS NOT NULL AND id != parent_id
ON CONFLICT DO NOTHING;
