ALTER TABLE suggestions
  ADD COLUMN archived_at TIMESTAMPTZ,
  ADD COLUMN archived_by_id VARCHAR(255);
