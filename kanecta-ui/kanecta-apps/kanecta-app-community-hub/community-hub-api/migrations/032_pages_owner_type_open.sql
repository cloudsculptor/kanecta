-- Widen owner_type to accept governance category values (gov-proc-* / gov-pol-*).
-- The application layer enforces valid values; the DB constraint was too narrow.
ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_owner_type_check;
