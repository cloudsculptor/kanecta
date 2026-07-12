-- Kanecta postgres schema — spec version 1.4.0
--
-- Uniform-projection modernisation (spec §cqrs-projections): retire the legacy
-- item_grants table. Grants are now first-class `grant` items projected to
-- obj_<grant-type> (migration 025 + the create()/update() projection path), and
-- PgAuthzSource reads that typed projection — never item_grants. The table has no
-- remaining reader or writer anywhere in the codebase, so it is dead weight and a
-- four-table-law violation. Drop it.

DROP TABLE IF EXISTS item_grants;
