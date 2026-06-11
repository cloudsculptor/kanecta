# Studio + Postgres smoke test — what to watch for

Context: kanecta-app-studio has been developed/tested against the FilesystemAdapter.
Cloud mode (`~/.config/kanecta/cloud.json` → Postgres @ localhost:45432 + S3/MinIO @
localhost:45900) is configured and reachable, with the 1074-item real datastore already
migrated in. Next session: point Studio at it and see what breaks.

## Likely friction points

1. **Creating new custom types through the UI**
   `PostgresAdapter.createType` only writes the `types` row — it never executes the
   type's `sqlSchema` to create its `obj_*` table (only the migration script does that,
   manually). Creating a type + adding object items of that type would create the items
   but `writeObjectJson` would silently fail (it catches the error and just logs a
   warning) — field data wouldn't persist or display.

2. **Async-refactor regressions surfacing for the first time**
   The recent "make all Datastore methods async" sweep (b5ac5692 etc.) was validated
   mainly through FilesystemAdapter/CLI tests. Any missed `await` on the Postgres/Cloud
   path wouldn't show up against the filesystem but could appear as `undefined`/
   `[object Promise]` values, silently-empty lists, or race conditions once the UI
   actually exercises `CloudAdapter`/`PostgresAdapter`.

3. **File operations via S3/MinIO**
   Studio file upload/download/preview goes through `S3Adapter` instead of local disk
   now. Worth checking whether the filesystem→Postgres migration script actually pushed
   file blobs into the `kanecta` bucket — if not, file-bearing items will show metadata
   but fail to load content.

4. **Performance differences**
   Tree/children rendering uses recursive CTEs and per-row queries instead of in-memory
   cached structures. Large views (1074 items) may feel noticeably slower, or reveal
   N+1 query patterns invisible against the filesystem.

5. **Field/shape mismatches in API responses**
   `rowToItem` maps snake_case Postgres columns back to the item shape; subtle
   differences (null vs. default values, date/timestamp formatting, array vs. JSON for
   `tags`) could trip up UI components that assumed FilesystemAdapter's exact shapes.

6. **New search-trigger overhead on writes**
   Every item/object create or update now fires the FTS triggers added in migration 013
   (search_index). Shouldn't cause correctness issues, but bulk operations (imports,
   bulk_create/update) will be marginally slower than before this session.

## Already verified working (don't need to re-check)
- Filesystem→Postgres migration: data matches exactly (1074 items, same owner/IDs)
- Migration 013 (search_index/FTS): triggers fire correctly on item and object updates,
  ranked search via `PostgresAdapter.search()` returns relevant results
