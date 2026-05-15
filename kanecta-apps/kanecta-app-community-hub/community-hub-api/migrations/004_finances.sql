CREATE TABLE IF NOT EXISTS finances_transactions (
  id            SERIAL PRIMARY KEY,
  date          DATE           NOT NULL,
  description   TEXT           NOT NULL,
  amount        NUMERIC(10,2)  NOT NULL CHECK (amount > 0),
  type          VARCHAR(10)    NOT NULL CHECK (type IN ('income', 'expense')),
  category      VARCHAR(50)    NOT NULL,
  reference     VARCHAR(100),
  created_by_id   VARCHAR(255) NOT NULL,
  created_by_name VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ    DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS finances_transactions_date_idx     ON finances_transactions (date DESC);
CREATE INDEX IF NOT EXISTS finances_transactions_type_idx     ON finances_transactions (type);
CREATE INDEX IF NOT EXISTS finances_transactions_category_idx ON finances_transactions (category);
