-- specVersion: records which version of the Kanecta specification an item's
-- metadata conforms to (e.g. '1.3.0'), mirroring metadata.json's new required field.
-- Existing rows are backfilled to '1.3.0' since that is the spec version they were
-- created under; new rows are stamped by the adapter at insert time.

ALTER TABLE items ADD COLUMN IF NOT EXISTS spec_version TEXT NOT NULL DEFAULT '1.3.0';
