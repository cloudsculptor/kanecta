-- Kanecta postgres schema — spec version 1.2.0
-- Adds items.due_at: ISO 8601 timestamp for when an item is due, mirroring
-- metadata.json's new `dueAt` field (sibling to `completedAt` — "when it's due"
-- vs "when it was completed", distinct concepts kept as distinct columns).
--
-- See specification.db.postgres.md for dialect notes.

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

INSERT INTO schema_version (id, version)
VALUES (TRUE, '1.2.0')
ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW();
