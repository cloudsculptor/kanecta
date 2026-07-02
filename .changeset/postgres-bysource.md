---
"@kanecta/postgres": minor
---

Add `bySource(sourceSystem, sourceExternalId)` to the Postgres adapter — the peer
of the filesystem adapter's lookup, using the existing unique
`(source_system, source_external_id)` index (migration 020). This gives
deterministic importers the same idempotent upsert (`bySource() ? update() :
create()`) against a Postgres backend. `create()`/`update()` already accepted the
source fields; this completes the primitive.
