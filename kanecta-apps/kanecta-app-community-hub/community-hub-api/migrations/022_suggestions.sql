CREATE TABLE suggestions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content           TEXT NOT NULL,
  submitted_by_id   VARCHAR(255) NOT NULL,
  submitted_by_name VARCHAR(255),
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
