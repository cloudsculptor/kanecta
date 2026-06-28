-- Add sort_order for ordering within a date
ALTER TABLE finances_transactions
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Drop the positive-only check so amounts can be negative
ALTER TABLE finances_transactions
  DROP CONSTRAINT IF EXISTS finances_transactions_amount_check;

-- Convert existing expense amounts to negative
UPDATE finances_transactions
  SET amount = -ABS(amount)
  WHERE type = 'expense' AND amount > 0;

CREATE INDEX IF NOT EXISTS finances_transactions_sort_idx
  ON finances_transactions (date ASC, sort_order ASC, id ASC);
