BEGIN;

-- 1. Add a UUID column to the join table to hold the new FK value
ALTER TABLE finances_transaction_files ADD COLUMN transaction_uuid UUID;

-- 2. Populate it from the transactions table
UPDATE finances_transaction_files tf
SET transaction_uuid = t.uuid
FROM finances_transactions t
WHERE t.id = tf.transaction_id;

-- 3. Drop the old PK on the join table (it references integer id)
ALTER TABLE finances_transaction_files DROP CONSTRAINT finances_transaction_files_pkey;

-- 4. Drop the old integer FK
ALTER TABLE finances_transaction_files
  DROP CONSTRAINT finances_transaction_files_transaction_id_fkey;

-- 5. Drop the old integer column and rename the UUID column
ALTER TABLE finances_transaction_files DROP COLUMN transaction_id;
ALTER TABLE finances_transaction_files RENAME COLUMN transaction_uuid TO transaction_id;
ALTER TABLE finances_transaction_files ALTER COLUMN transaction_id SET NOT NULL;

-- 6. Drop the integer PK on transactions
ALTER TABLE finances_transactions DROP CONSTRAINT finances_transactions_pkey;

-- 7. Drop the old integer id column
ALTER TABLE finances_transactions DROP COLUMN id;

-- 8. Rename uuid → id and make it the PK
ALTER TABLE finances_transactions RENAME COLUMN uuid TO id;
ALTER TABLE finances_transactions ADD PRIMARY KEY (id);
DROP INDEX IF EXISTS finances_transactions_uuid_idx;

-- 9. Restore the join table PK and FK
ALTER TABLE finances_transaction_files ADD PRIMARY KEY (transaction_id, file_id);
ALTER TABLE finances_transaction_files
  ADD CONSTRAINT finances_transaction_files_transaction_id_fkey
  FOREIGN KEY (transaction_id) REFERENCES finances_transactions(id) ON DELETE CASCADE;

COMMIT;
