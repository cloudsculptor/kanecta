-- Kanecta postgres schema — spec version 1.4.0
--
-- Uniform-projection modernisation (spec §cqrs-projections): rename the three
-- rebuildable/log tables to their conformant four-table-law names. These are pure
-- renames — no schema or behaviour change, no triggers involved:
--   * history          → item_history   (the append-only snapshot LOG; exempt kind)
--   * links            → perf_backlinks  (rebuildable backlink index)
--   * item_references  → perf_references (rebuildable structural-dependency index,
--                                         backfilled by 022; branching preFlightScan reads it)
-- The adapter now references the new names. Indexes keep their existing names —
-- the conformance guardrail classifies tables, not indexes, and index names are
-- cosmetic. Idempotent via IF EXISTS so a partially-applied run is safe.

ALTER TABLE IF EXISTS history         RENAME TO item_history;
ALTER TABLE IF EXISTS links           RENAME TO perf_backlinks;
ALTER TABLE IF EXISTS item_references  RENAME TO perf_references;
