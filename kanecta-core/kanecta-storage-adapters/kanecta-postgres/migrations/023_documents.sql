-- 023_documents: document type payload storage
--
-- Documents store their payload (targetId, roleMap, expandState, etc.) as JSONB.
-- A partial index on targetId enables O(1) listDocuments(targetId) queries.

CREATE TABLE IF NOT EXISTS documents (
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (item_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_target_id
  ON documents ((payload->>'targetId'));
