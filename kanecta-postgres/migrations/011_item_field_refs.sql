-- item_fields: stable UUIDs for (item, field) pairs.
--
-- Allows a specific field value on a specific item to be addressed by a
-- single UUID. Created on demand only — never proactively generated.
--
-- Resolution order for the application layer:
--   dot notation ([item-uuid].[field-x-id]) → parse directly, no table
--   bare UUID                               → items first, then here
--   non-UUID string                         → aliases first
--
-- Rows must never be deleted while the parent item exists; CASCADE handles
-- cleanup automatically when the item is deleted.

CREATE TABLE item_fields (
    id        UUID    NOT NULL DEFAULT gen_random_uuid(),
    item_id   UUID    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    field_xid UUID    NOT NULL,
    CONSTRAINT pk_item_fields PRIMARY KEY (id),
    CONSTRAINT uq_item_fields UNIQUE (item_id, field_xid)
);

CREATE INDEX idx_item_fields_item_id ON item_fields (item_id);
