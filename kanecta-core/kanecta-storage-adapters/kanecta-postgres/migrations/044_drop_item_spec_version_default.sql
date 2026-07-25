-- Kanecta postgres schema — spec version 1.4.0
--
-- Drop the DEFAULT on items.spec_version (the column stays NOT NULL).
--
-- Migration 017 added the column with DEFAULT '1.3.0' as a one-time backfill
-- value for pre-existing rows — but a column default lives forever, and it bit:
-- any writer that bypasses the adapter and omits spec_version silently stamps
-- rows with the stale default instead of the current spec version. That is
-- exactly what the community-hub backfill executor did (651 of 1359 nonprod
-- items mis-stamped '1.3.0', re-stamped by hand 2026-07-23; the executor now
-- stamps explicitly).
--
-- With no default and NOT NULL kept, a raw-SQL writer that omits spec_version
-- fails loudly at INSERT time instead of mis-stamping — the failure mode we
-- want. The adapter always stamps explicitly, so it is unaffected.
--
-- item_archive gets the same ALTER: migration 043 creates it LIKE items
-- INCLUDING DEFAULTS, and the schema-identity drift gate requires the two
-- tables to match column-for-column, defaults included.

ALTER TABLE items ALTER COLUMN spec_version DROP DEFAULT;
ALTER TABLE item_archive ALTER COLUMN spec_version DROP DEFAULT;
