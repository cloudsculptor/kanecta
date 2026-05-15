-- Uses gen_random_uuid() — built into PostgreSQL 13+, no extension needed

-- ── UUID on transactions ──────────────────────────────────────────────────────
ALTER TABLE finances_transactions
  ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS finances_transactions_uuid_idx
  ON finances_transactions (uuid);

-- ── Files table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT         NOT NULL,
  storage_key      TEXT         NOT NULL UNIQUE,
  mime_type        VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
  size_bytes       BIGINT,
  description      TEXT,
  uploaded_by_id   VARCHAR(255) NOT NULL,
  uploaded_by_name VARCHAR(255) NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Transaction ↔ file join table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finances_transaction_files (
  transaction_id INTEGER NOT NULL REFERENCES finances_transactions(id) ON DELETE CASCADE,
  file_id        UUID    NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, file_id)
);

CREATE INDEX IF NOT EXISTS ftf_transaction_idx ON finances_transaction_files (transaction_id);
CREATE INDEX IF NOT EXISTS ftf_file_idx        ON finances_transaction_files (file_id);
