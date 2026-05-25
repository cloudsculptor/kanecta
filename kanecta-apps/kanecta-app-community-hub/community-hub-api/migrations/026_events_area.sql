ALTER TABLE events
  ADD COLUMN area VARCHAR(50) NOT NULL DEFAULT 'Featherston'
  CHECK (area IN (
    'Featherston', 'Greytown', 'Carterton', 'Martinborough',
    'Masterton', 'South Wairarapa', 'Wairarapa'
  ));
