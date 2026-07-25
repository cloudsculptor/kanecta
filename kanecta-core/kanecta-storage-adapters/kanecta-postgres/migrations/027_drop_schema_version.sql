-- Kanecta postgres schema — spec version 1.4.0
--
-- Uniform-projection modernisation (spec §cqrs-projections): remove the
-- schema_version table. The spec is explicit that bootstrapping lives in the root
-- item's payload (rootPayload.specVersion) and that there is NO schema_version
-- table — it is a named four-table-law violation.
--
-- The table is also dead: it was seeded once with '1.0.0' in migration 004 and
-- never bumped, and nothing reads or writes it. The adapter tracks the spec
-- version in config (spec_version) and applied migrations in schema_migrations.

DROP TABLE IF EXISTS schema_version;
