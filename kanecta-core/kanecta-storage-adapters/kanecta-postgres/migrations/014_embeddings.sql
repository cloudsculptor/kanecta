-- Vector/semantic search infrastructure (pgvector).
--
-- The `item_embeddings` table itself isn't created here — its `embedding`
-- column needs a fixed VECTOR(N) width matching whichever embedding model is
-- configured (Voyage's models alone range 512–1536), and that's only known at
-- runtime from cloud.json's `embeddings` config. The adapter creates it
-- on-demand the first time a provider is configured (see
-- PostgresAdapter#_ensureEmbeddingTable).
--
-- What *is* static is the queue: `pending_embeddings` tracks which items need
-- (re-)embedding. Two generic triggers — mirroring the search_index pattern in
-- migration 013 — enqueue an item whenever its own fields or its object data
-- change, without any per-type code. A background worker (see
-- PostgresAdapter#processPendingEmbeddings) drains the queue, calls the
-- configured provider, and removes entries once embedded. This keeps embedding
-- (a slow, paid, rate-limited network call) off the write path entirely.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS pending_embeddings (
    item_id   UUID NOT NULL,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_pending_embeddings PRIMARY KEY (item_id),
    CONSTRAINT fk_pending_embeddings_item
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION kanecta_queue_item_embedding()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO pending_embeddings (item_id) VALUES (NEW.id)
  ON CONFLICT (item_id) DO UPDATE SET queued_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_items_queue_embedding ON items;
CREATE TRIGGER trg_items_queue_embedding
    AFTER INSERT OR UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION kanecta_queue_item_embedding();

-- Generic — attached to every obj_* table (each has an item_id column), same
-- way migration 013 attaches the FTS trigger.
CREATE OR REPLACE FUNCTION kanecta_queue_object_embedding()
RETURNS TRIGGER AS $$
DECLARE
  affected UUID;
BEGIN
  affected := CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END;
  INSERT INTO pending_embeddings (item_id) VALUES (affected)
  ON CONFLICT (item_id) DO UPDATE SET queued_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = current_schema() AND tablename LIKE 'obj\_%' ESCAPE '\'
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'trg_object_queue_embedding' AND tgrelid = format('%I', tbl)::regclass
        ) THEN
            EXECUTE format(
                'CREATE TRIGGER trg_object_queue_embedding ' ||
                'AFTER INSERT OR UPDATE OR DELETE ON %I ' ||
                'FOR EACH ROW EXECUTE FUNCTION kanecta_queue_object_embedding()',
                tbl
            );
        END IF;
    END LOOP;
END $$;

-- No backfill here, deliberately: migrations re-run on every adapter open
-- (idempotently), but "queue everything that isn't embedded yet" is not
-- idempotent against a queue that drains over time — it would re-queue
-- already-embedded items forever. Backfilling the existing knowledge base
-- happens once, at runtime, the first time a provider is configured (see
-- PostgresAdapter#_ensureEmbeddingTable), scoped to that provider's model.
