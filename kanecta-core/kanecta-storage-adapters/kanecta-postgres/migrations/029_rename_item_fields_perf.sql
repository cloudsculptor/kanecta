-- Kanecta postgres schema — spec version 1.4.0
--
-- Uniform-projection modernisation (spec §cqrs-projections, step 6 "rename the
-- legitimate perf_/log tables"): item_fields is a rebuildable, performance-only
-- index of stable (item, field) UUIDs — a perf_ table by the four-table law, not
-- a bespoke store. Rename it to the conforming perf_fields.
--
-- Pure rename with no code impact: nothing in the codebase reads or writes this
-- table today (it was created in migration 011 ahead of the feature that will
-- populate it), so there are no SQL sites to update. Its indexes keep their
-- original names — functional, just cosmetically stale — to avoid needless churn.

ALTER TABLE IF EXISTS item_fields RENAME TO perf_fields;
