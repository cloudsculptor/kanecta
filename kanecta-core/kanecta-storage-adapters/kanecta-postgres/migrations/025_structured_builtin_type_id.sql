-- Kanecta postgres schema — spec version 1.4.0
--
-- Uniform-projection modernisation (spec §cqrs-projections, the four-table law):
-- a structured built-in type (grant, query, …) is an ordinary type with typed
-- columns, projected to obj_<typeId> exactly like a user 'object'. For that its
-- instance must carry its type's UUID in items.type_id — but the original
-- chk_items_type_id CHECK forbade type_id on any non-'object' row.
--
-- Relax it to: an 'object' STILL requires a type_id (it has no other type
-- identity), while any non-'object' row MAY carry a type_id (a projection-enabled
-- structured built-in does; a primitive leaves it NULL). Primitives that carry no
-- payload keep type_id NULL and live in items only.

ALTER TABLE items DROP CONSTRAINT IF EXISTS chk_items_type_id;
ALTER TABLE items ADD CONSTRAINT chk_items_type_id CHECK (
    type <> 'object' OR type_id IS NOT NULL
);
