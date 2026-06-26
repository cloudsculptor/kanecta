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
  to v1.4.0 (`migrate-1.3.0-to-1.4.0.js`). Merges split file-specs into a
  single `item.json`, converts `relationships.json` entries to typed
  relationship items, and adds provenance fields. Source-of-truth directory
  migrations (aliases, annotations, history, config, fields) will be added
  as Task 2 is finalised.