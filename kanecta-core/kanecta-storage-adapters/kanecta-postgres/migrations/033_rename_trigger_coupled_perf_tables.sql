-- Kanecta postgres schema — spec version 1.4.0
--
-- Uniform-projection modernisation (spec §cqrs-projections): rename the two
-- trigger-maintained perf tables to their four-table-law names:
--   * search_index       → perf_search           (FTS tsvector index; migration 013)
--   * pending_embeddings  → perf_embedding_queue  (embedding work queue; migration 014)
--
-- Unlike 032, these two are written by trigger FUNCTIONS that name the table
-- literally, so the rename must CREATE OR REPLACE those functions to target the new
-- names. The TRIGGERS themselves reference the functions (not the tables), and the
-- dynamic per-obj_ attach (013/014 DO blocks + adapter _attachObjectSearchTrigger)
-- references the functions too — so only the four function bodies and the table names
-- change; no trigger is recreated. Column names and indexes are unchanged (they
-- follow the renamed table). Pure rename, no behaviour change.

ALTER TABLE IF EXISTS search_index      RENAME TO perf_search;
ALTER TABLE IF EXISTS pending_embeddings RENAME TO perf_embedding_queue;

-- ── FTS trigger functions (were: search_index) ───────────────────────────────
CREATE OR REPLACE FUNCTION kanecta_update_item_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO perf_search (item_id, item_tsv)
  VALUES (NEW.id, kanecta_row_to_tsvector(to_jsonb(NEW)))
  ON CONFLICT (item_id) DO UPDATE SET item_tsv = EXCLUDED.item_tsv;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kanecta_update_object_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE perf_search SET object_tsv = NULL WHERE item_id = OLD.item_id;
    RETURN OLD;
  END IF;

  INSERT INTO perf_search (item_id, object_tsv)
  VALUES (NEW.item_id, kanecta_row_to_tsvector(to_jsonb(NEW) - 'item_id'))
  ON CONFLICT (item_id) DO UPDATE SET object_tsv = EXCLUDED.object_tsv;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Embedding-queue trigger functions (were: pending_embeddings) ─────────────
CREATE OR REPLACE FUNCTION kanecta_queue_item_embedding()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO perf_embedding_queue (item_id) VALUES (NEW.id)
  ON CONFLICT (item_id) DO UPDATE SET queued_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kanecta_queue_object_embedding()
RETURNS TRIGGER AS $$
DECLARE
  affected UUID;
BEGIN
  affected := CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END;
  INSERT INTO perf_embedding_queue (item_id) VALUES (affected)
  ON CONFLICT (item_id) DO UPDATE SET queued_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
