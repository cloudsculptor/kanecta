-- Kanecta postgres schema — spec version 1.4.0
--
-- Uniform-projection modernisation (spec §cqrs-projections): retire the bespoke
-- files table. Its replacement is the `file` built-in type projected to
-- obj_<file-type> (metadata as typed columns; bytes stay in S3 / an on-disk
-- sidecar) — the same collapse item_grants underwent.
--
-- The table is safe to drop now: it was created in migration 001 and never wired
-- up — no adapter code reads or writes it, it is never seeded, and nothing
-- references it (its only FK points outward to items). So it is empty in every
-- datastore this codebase has ever produced.

DROP TABLE IF EXISTS files;
