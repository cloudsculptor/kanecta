CREATE TABLE IF NOT EXISTS page_history (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id      UUID         NOT NULL REFERENCES pages(id),
  action       TEXT         NOT NULL CHECK (action IN ('Created', 'Updated', 'Published', 'Unpublished', 'Archived')),
  version      INTEGER      NOT NULL,
  content_json JSONB        NOT NULL DEFAULT '{}',
  licence_id   UUID         REFERENCES licences(id),
  user_id      VARCHAR(255) NOT NULL,
  user_name    VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS page_history_page_idx ON page_history(page_id);
CREATE INDEX IF NOT EXISTS page_history_created_idx ON page_history(created_at DESC);
