CREATE TABLE IF NOT EXISTS site_node_history (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id      UUID         NOT NULL REFERENCES site_nodes(id),
  action       TEXT         NOT NULL CHECK (action IN ('Created', 'Updated', 'Deleted')),
  snapshot     JSONB        NOT NULL DEFAULT '{}',
  user_id      VARCHAR(255) NOT NULL,
  user_name    VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS site_node_history_node_idx ON site_node_history(node_id);
CREATE INDEX IF NOT EXISTS site_node_history_created_idx ON site_node_history(created_at DESC);
