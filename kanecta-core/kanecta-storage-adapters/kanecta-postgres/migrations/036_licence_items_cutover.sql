-- Kanecta postgres schema — spec version 1.4.0
--
-- Licence cutover (spec §licencePayload, §cqrs-projections / the four-table law):
-- a licence is a first-class item like any other structured built-in. An item's
-- meta.license (items.license) is a UUID that resolves to a `licence` ITEM whose
-- payload projects to obj_<licence-type> — never a bespoke `licences` table.
--
-- This retargets items.license from the licences lookup table back to items(id)
-- (undoing 010; restoring 009's target) and drops the table. The adapter's
-- _ensureSystemItems seeds the 19 licence items + their obj_licence projection on
-- init/open under the KANECTA_ALLOW_SCHEMA_CHANGES guard.
--
-- Circular-FK bootstrap: every item (root, the type items, and the licence items
-- themselves) carries license = the default "All Rights Reserved" licence
-- (bb3bf137…). Once items.license references items(id), that default must exist
-- as an item before anything referencing it — but its own parent is the licence
-- TYPE item, seeded later in bootstrap. Break the cycle exactly as `root` does:
-- seed the default licence self-parented here (so the retargeted FK validates for
-- every existing row and the bootstrap's licensed seeds resolve); the adapter
-- reparents it under the licence type container once that exists.

-- 1. Seed the default licence as a self-parented item, BEFORE the FK swap, so the
--    new items(id) FK validates against it for all existing items.license rows.
INSERT INTO items (id, spec_version, parent_id, path, value, type, type_id, owner,
                   license, sort_order, created_at, modified_at, created_by, modified_by)
VALUES ('bb3bf137-d8a9-4264-9fb7-ac373b1d4739', '1.4.0',
        'bb3bf137-d8a9-4264-9fb7-ac373b1d4739',
        'bb3bf137-d8a9-4264-9fb7-ac373b1d4739',
        'All Rights Reserved (Copyright)', 'licence',
        '9798b629-06f4-495f-90e8-2d70f817466e', 'kanecta',
        'bb3bf137-d8a9-4264-9fb7-ac373b1d4739', 0,
        NOW(), NOW(), 'kanecta', 'kanecta')
ON CONFLICT (id) DO NOTHING;

-- The self-parented insert queues a DEFERRED fk_items_parent check (the parent FK
-- is DEFERRABLE INITIALLY DEFERRED). Postgres refuses ALTER TABLE items while such
-- pending trigger events exist, so flush them now — the self-reference is valid.
SET CONSTRAINTS ALL IMMEDIATE;

-- 2. Retarget the FK: licences(id) -> items(id). DEFERRABLE INITIALLY DEFERRED so
--    a transactional bootstrap seed of self-referential rows validates at commit,
--    matching fk_items_parent.
ALTER TABLE items DROP CONSTRAINT IF EXISTS fk_items_license;
ALTER TABLE items
    ADD CONSTRAINT fk_items_license FOREIGN KEY (license)
        REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED;

-- 3. Drop the bespoke lookup table — the four-table law forbids it; licence data
--    now lives in items + obj_<licence-type>.
DROP TABLE IF EXISTS licences;
