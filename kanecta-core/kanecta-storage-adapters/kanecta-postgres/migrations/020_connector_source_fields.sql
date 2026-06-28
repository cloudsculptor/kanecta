-- Kanecta postgres schema — spec version 1.4.0
--
-- Adds source_system and source_external_id to the items table.
-- These fields identify where a connector-managed item came from in the
-- external system. Together they form a workspace-unique natural key for
-- duplicate-ingestion detection and for routing write-back operations to the
-- correct external record.
--
-- source_system       — human-readable identifier of the external system
--                       (e.g. "jira", "github", "xero"). Matches the connector
--                       item's `system` field. Null for native items.
-- source_external_id  — ID of this record in the source system
--                       (e.g. "ENG-1234", "42"). Null for native items.
--
-- The combination (source_system, source_external_id) is unique per workspace
-- (partial unique index, only applied when both are non-null) to prevent
-- duplicate ingestion of the same external record.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS source_system      TEXT,
  ADD COLUMN IF NOT EXISTS source_external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_source
  ON items (source_system, source_external_id)
  WHERE source_system IS NOT NULL AND source_external_id IS NOT NULL;
