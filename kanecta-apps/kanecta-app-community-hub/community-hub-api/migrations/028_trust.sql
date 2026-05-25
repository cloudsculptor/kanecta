CREATE TABLE trust (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  endorsed_by_id VARCHAR(255) NOT NULL,
  know_personally BOOLEAN NOT NULL DEFAULT false,
  trusted_by_someone BOOLEAN NOT NULL DEFAULT false,
  resilience_hui BOOLEAN NOT NULL DEFAULT false,
  other_reason TEXT,
  locality VARCHAR(20) NOT NULL CHECK (locality IN ('local', 'supporter')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
