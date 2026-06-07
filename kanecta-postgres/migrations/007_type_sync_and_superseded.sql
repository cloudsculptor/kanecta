-- Kanecta postgres schema — spec version 1.2.0
-- Adds four type-level UUID-list cross-references newly defined on type.json:
--   - sync:         UUIDs of function items that can refresh instances of this
--                   type from their original/external source
--   - supersededBy: UUIDs of type definitions that replace this one (Kanecta
--                   types are immutable — a changed shape means a new type,
--                   and supersededBy records suggested migration paths)
--   - implements:   UUIDs of types whose "interface" (shape contract) this
--                   type fulfils, programming-language-interface style
--   - extends:      UUIDs of types this type extends/specialises
--
-- All four are lists, mirroring meta_functions_consumed_by/produced_by.
-- See specification.db.postgres.md for dialect notes.

ALTER TABLE types
    ADD COLUMN IF NOT EXISTS sync           UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS superseded_by  UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS implements     UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS extends        UUID[] NOT NULL DEFAULT '{}';

INSERT INTO schema_version (id, version)
VALUES (TRUE, '1.3.0')
ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW();
