CREATE TABLE IF NOT EXISTS site_nodes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id      UUID        REFERENCES site_nodes(id) ON DELETE RESTRICT,
  slug           TEXT        NOT NULL,
  title          TEXT        NOT NULL,
  node_type      TEXT        NOT NULL CHECK (node_type IN ('index', 'page', 'component')),
  component_name TEXT,
  page_id        UUID        REFERENCES pages(id) ON DELETE SET NULL,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  public         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,
  UNIQUE (parent_id, slug)
);

CREATE INDEX IF NOT EXISTS site_nodes_parent_idx ON site_nodes (parent_id);
CREATE INDEX IF NOT EXISTS site_nodes_page_idx   ON site_nodes (page_id);
