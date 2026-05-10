-- Add latest_message_at to threads for fast unread queries
ALTER TABLE discussions_threads ADD COLUMN latest_message_at TIMESTAMPTZ;

-- Backfill from existing messages (includes replies — any activity bumps the thread)
UPDATE discussions_threads t
SET latest_message_at = (
  SELECT MAX(created_at) FROM discussions_messages m WHERE m.thread_id = t.id
);

-- Read state: one row per user per thread they have visited
CREATE TABLE discussions_thread_reads (
  user_id      TEXT        NOT NULL,
  thread_id    UUID        NOT NULL REFERENCES discussions_threads(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, thread_id)
);
