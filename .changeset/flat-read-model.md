---
"@kanecta/api": minor
"@kanecta/api-client": minor
"@kanecta/sqlite-fs": patch
"@kanecta/datastore-utils": patch
"@kanecta/studio": patch
---

Unify the API/lib/MCP read model on the flat item.

`GET /items/:id` now returns the flat read model — item and meta fields promoted
to the top level, the derived `icon` slug always present, and the object data
kept boxed under `payload` (so payload field names never clash with the basic
fields) — instead of the grouped five-section document. This matches what the
list/children/tree/root endpoints already return. The `@kanecta/api-client`
`items.get()` return type changes from `KanectaItemDocument` to the flat
`KanectaItem` accordingly.

Also: intern filesystem adapter instances by resolved path in
`@kanecta/datastore-utils` so every consumer in a process shares one coherent
instance (bounds resource use to one datastore instance and keeps in-memory
caches consistent), and fix an off-by-one in the sqlite-fs `tree()` depth bound
for the implicit-root (`/tree`) case.
