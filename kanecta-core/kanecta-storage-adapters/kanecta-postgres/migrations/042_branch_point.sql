-- 042 — branch fork watermark
--
-- Conflict-aware merge parity with the sqlite-fs adapter (spec «Conflict-aware
-- merge»): every branch records the instant it forked so a merge can tell an
-- EDIT (upstream unchanged since the fork) from a CONFLICT (upstream also
-- changed) per item. The sqlite-fs adapter stores this as branch.json's
-- `branchPoint.at`; here it is a column on the branches registry.
--
-- For a branch pushed from a local sqlite-fs branch, the watermark is the
-- LOCAL fork point (carried by SyncEngine.push), not the push time — upstream
-- may have moved between fork and push, which is exactly the window conflict
-- detection exists for. Existing rows backfill from created_at (the best
-- available approximation, and the previous implicit semantics).

ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_point_at TIMESTAMPTZ;

UPDATE branches SET branch_point_at = created_at WHERE branch_point_at IS NULL;
