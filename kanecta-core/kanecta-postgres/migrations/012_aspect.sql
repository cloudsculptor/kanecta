-- aspect: named parallel dimension for children under a parent.
-- null = main tree (default). Any string = named dimension (e.g. 'settings', 'hidden').
-- sortOrder is scoped per-aspect; UIs filter children by aspect, showing null by default.

ALTER TABLE items ADD COLUMN IF NOT EXISTS aspect TEXT;

CREATE INDEX IF NOT EXISTS idx_items_aspect ON items (parent_id, aspect);
