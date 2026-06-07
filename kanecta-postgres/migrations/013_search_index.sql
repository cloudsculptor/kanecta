-- Full-text search index over every field of every item.
--
-- One central table (search_index) holds a combined tsvector per item,
-- built from two parts maintained independently:
--   item_tsv   — every column of the item's row in `items`
--   object_tsv — every column of the item's row in its obj_<typeId> table
--                (NULL for non-object items)
-- `tsv` concatenates both and is what queries match against.
--
-- A single generic trigger function (kanecta_row_to_tsvector) builds a
-- tsvector from *any* row by stringifying it through to_jsonb — this is what
-- lets one trigger cover `items` and every obj_* table without per-type code,
-- and keeps each type's author-defined sqlSchema untouched (it's immutable
-- per spec — we can't add a search column to it).
--
-- Triggers keep both halves in sync automatically: editing an item's own
-- fields updates item_tsv; editing its object data updates object_tsv;
-- deleting the item cascades the search_index row away.

CREATE TABLE IF NOT EXISTS search_index (
    item_id    UUID      NOT NULL,
    item_tsv   TSVECTOR,
    object_tsv TSVECTOR,
    tsv        TSVECTOR  GENERATED ALWAYS AS (coalesce(item_tsv, ''::tsvector) || coalesce(object_tsv, ''::tsvector)) STORED,

    CONSTRAINT pk_search_index PRIMARY KEY (item_id),
    CONSTRAINT fk_search_index_item
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_index_tsv ON search_index USING GIN (tsv);

-- Builds a tsvector from every value in a row, via its jsonb representation —
-- works for any table shape, which is what lets this be reused generically.
CREATE OR REPLACE FUNCTION kanecta_row_to_tsvector(row_data JSONB)
RETURNS TSVECTOR AS $$
  SELECT to_tsvector('english', coalesce(string_agg(value, ' '), ''))
  FROM jsonb_each_text(row_data) AS kv(key, value);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION kanecta_update_item_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO search_index (item_id, item_tsv)
  VALUES (NEW.id, kanecta_row_to_tsvector(to_jsonb(NEW)))
  ON CONFLICT (item_id) DO UPDATE SET item_tsv = EXCLUDED.item_tsv;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_items_search_vector ON items;
CREATE TRIGGER trg_items_search_vector
    AFTER INSERT OR UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION kanecta_update_item_search_vector();

-- Generic — attached to every obj_* table (each has an item_id column).
CREATE OR REPLACE FUNCTION kanecta_update_object_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE search_index SET object_tsv = NULL WHERE item_id = OLD.item_id;
    RETURN OLD;
  END IF;

  INSERT INTO search_index (item_id, object_tsv)
  VALUES (NEW.item_id, kanecta_row_to_tsvector(to_jsonb(NEW) - 'item_id'))
  ON CONFLICT (item_id) DO UPDATE SET object_tsv = EXCLUDED.object_tsv;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach the generic object trigger to every obj_* table that doesn't have it
-- yet. Runs on every startup (migrations re-run idempotently), so any obj_*
-- table created later — by a future type — is picked up automatically too.
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename LIKE 'obj\_%' ESCAPE '\'
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'trg_object_search_vector' AND tgrelid = format('%I', tbl)::regclass
        ) THEN
            EXECUTE format(
                'CREATE TRIGGER trg_object_search_vector ' ||
                'AFTER INSERT OR UPDATE OR DELETE ON %I ' ||
                'FOR EACH ROW EXECUTE FUNCTION kanecta_update_object_search_vector()',
                tbl
            );
        END IF;
    END LOOP;
END $$;

-- Backfill: index any item that doesn't have a search_index row yet.
INSERT INTO search_index (item_id, item_tsv)
SELECT i.id, kanecta_row_to_tsvector(to_jsonb(i))
FROM items i
WHERE NOT EXISTS (SELECT 1 FROM search_index s WHERE s.item_id = i.id)
ON CONFLICT (item_id) DO UPDATE SET item_tsv = EXCLUDED.item_tsv;

-- Backfill: index any object row whose item doesn't have object_tsv yet.
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename LIKE 'obj\_%' ESCAPE '\'
    LOOP
        EXECUTE format(
            'INSERT INTO search_index (item_id, object_tsv) ' ||
            'SELECT t.item_id, kanecta_row_to_tsvector(to_jsonb(t) - ''item_id'') ' ||
            'FROM %I t ' ||
            'WHERE NOT EXISTS (SELECT 1 FROM search_index s WHERE s.item_id = t.item_id AND s.object_tsv IS NOT NULL) ' ||
            'ON CONFLICT (item_id) DO UPDATE SET object_tsv = EXCLUDED.object_tsv',
            tbl
        );
    END LOOP;
END $$;
