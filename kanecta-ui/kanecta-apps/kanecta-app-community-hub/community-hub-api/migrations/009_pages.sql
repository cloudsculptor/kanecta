CREATE TABLE IF NOT EXISTS pages (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT         NOT NULL UNIQUE,
  title           TEXT         NOT NULL DEFAULT '',
  content_json    JSONB        NOT NULL DEFAULT '{}',
  created_by_id   VARCHAR(255) NOT NULL,
  created_by_name VARCHAR(255) NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS page_files (
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id)  ON DELETE CASCADE,
  PRIMARY KEY (page_id, file_id)
);

CREATE INDEX IF NOT EXISTS page_files_page_idx ON page_files (page_id);
CREATE INDEX IF NOT EXISTS page_files_file_idx ON page_files (file_id);
