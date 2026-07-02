---
"@kanecta/sqlite-fs": minor
"@kanecta/lib": minor
---

Add idempotent external-ingestion primitives to the filesystem adapter.

`create()` now accepts `sourceSystem` and `sourceExternalId` (the item schema and
the unique `idx_meta_source` index already reserved these), and a new
`bySource(sourceSystem, sourceExternalId)` looks an item up by that key. Together
they give deterministic importers a clean upsert: `bySource() ? update() :
create()`. Surfaced on the `Datastore` facade as `bySource(system, externalId)`.
