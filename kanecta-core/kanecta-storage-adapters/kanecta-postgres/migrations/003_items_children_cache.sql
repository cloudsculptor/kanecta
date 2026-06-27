-- Kanecta postgres schema — spec version 1.2.0
-- Adds items.children: a denormalised UUID[] cache of an item's child IDs,
-- kept in lock-step with items.id / items.parent_id by a trigger (below) —
-- so it stays correct under ANY write path, including raw-SQL tools that
-- bypass the application adapter (e.g. the filesystem->postgres migration script).
--
-- Source of truth for parent/child relationships remains items.id / items.parent_id.
-- This column is a read-performance cache only (avoids a child-lookup query/join
-- for tree reads).

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS children UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_items_children ON items USING GIN (children);

-- ─── trigger: keep items.children in sync with items.parent_id ─────────────
-- INSERT   -> append the new row's id to its parent's children
-- UPDATE   -> if parent_id changed, remove from old parent, append to new parent
-- DELETE   -> remove the deleted row's id from its parent's children
--
-- The root item is self-referential (parent_id = id); it is excluded from its
-- own children array (id <> NEW.id) since it is not really its own child.

CREATE OR REPLACE FUNCTION items_sync_children() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE items SET children = array_append(children, NEW.id)
            WHERE id = NEW.parent_id AND id <> NEW.id;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
            UPDATE items SET children = array_remove(children, OLD.id)
                WHERE id = OLD.parent_id;
            UPDATE items SET children = array_append(children, NEW.id)
                WHERE id = NEW.parent_id AND id <> NEW.id;
        END IF;
        RETURN NEW;
    ELSE -- DELETE
        UPDATE items SET children = array_remove(children, OLD.id)
            WHERE id = OLD.parent_id;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_items_sync_children ON items;

CREATE TRIGGER trg_items_sync_children
    AFTER INSERT OR UPDATE OF parent_id OR DELETE ON items
    FOR EACH ROW EXECUTE FUNCTION items_sync_children();
