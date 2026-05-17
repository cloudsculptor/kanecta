CREATE TABLE IF NOT EXISTS groups (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  description       TEXT,
  public_description TEXT,
  banner            UUID        REFERENCES files(id),
  deleted_datetime  TIMESTAMPTZ
);
