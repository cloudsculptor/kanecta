-- Per-branch base content fingerprints for cross-adapter conflict detection.
--
-- When a local sqlite-fs branch forks an item, it records a content fingerprint
-- of the version it forked from (bases.json). Pushing that branch to a remote
-- postgres carries those fingerprints here, so previewMerge/mergeBranch can
-- detect whether main's CURRENT content differs from the fork base — clock-free,
-- no shared-clock assumption. Mirrors sqlite-fs bases.json:
--   { itemId: { sha256, modifiedAt, capturedAt } }
-- Empty for branches created directly on postgres; those fall back to the
-- branch_point_at timestamp watermark.

ALTER TABLE branches ADD COLUMN IF NOT EXISTS bases JSONB NOT NULL DEFAULT '{}'::jsonb;
