CREATE TABLE IF NOT EXISTS finances_expenses (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier    TEXT         NOT NULL,
  description TEXT         NOT NULL,
  category    VARCHAR(50)  NOT NULL,
  frequency   VARCHAR(10)  NOT NULL CHECK (frequency IN ('monthly', 'annual')),
  currency    VARCHAR(3)   NOT NULL DEFAULT 'NZD',
  amount      NUMERIC(10,2) NOT NULL,
  nzd_amount  NUMERIC(10,2) NOT NULL,
  url         TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
