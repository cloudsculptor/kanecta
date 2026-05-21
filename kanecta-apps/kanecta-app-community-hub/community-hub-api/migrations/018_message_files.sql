CREATE TABLE discussions_message_files (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID        NOT NULL REFERENCES discussions_messages(id) ON DELETE CASCADE,
  file_id      UUID        NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  show_preview BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, file_id)
);

CREATE INDEX ON discussions_message_files (message_id);
