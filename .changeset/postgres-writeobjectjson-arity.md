---
"@kanecta/postgres": patch
---

Fix `writeObjectJson` silently no-op'ing when called without an explicit `typeId`.

The `Datastore` facade (and its callers — the API's object-write endpoints and
`connectorEngine`) invoke `writeObjectJson(id, data)` with no `typeId`. The
Postgres adapter required `(id, typeId, data)`, so the payload landed in the
`typeId` position, the object-table lookup failed, and the write was swallowed by
a warning — object payloads written through the facade never persisted against
Postgres. `writeObjectJson` now looks the `typeId` up from the item when omitted
(mirroring `readObjectJson`), while the explicit `(id, typeId, data)` form still
works.
