# kanecta-migrations

Automated scripts to help customers migrate their Kanecta datastore between
spec versions.

## Layout

Migrations are stored in child folders named for the **target** spec version,
e.g. `1.3.0/`. Each folder contains whatever scripts (and notes) are needed to
bring a datastore from the previous spec version up to that target version.

## Available migrations

- [1.3.0](1.3.0/README.md) — filesystem datastore migration from spec v1.2.0
  to v1.3.0 (`migrate-1.2.0-to-1.3.0.js` + an AI-assisted data-reshaping
  runbook for the parts that need human judgement).
- [1.4.0](1.4.0/README.md) — filesystem datastore migration from spec v1.3.0
  to v1.4.0. A two-step chain: `migrate-1.3.0-to-1.4.0.js` merges split
  file-specs into a single `item.json`, converts `relationships.json` entries
  to typed relationship items, and adds provenance fields; then
  `migrate-datastore-to-per-branch.js` restructures the datastore into the
  per-branch full-folder layout. `migrate-config-keys.js` migrates the versioned
  device config to the working-set shape. See the folder README for the full
  ordered runbook (owner-assisted) and `reshape-data-with-ai.md` for the
  reshape queue.