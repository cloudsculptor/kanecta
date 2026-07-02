---
"@kanecta/postgres": minor
---

Bring the Postgres adapter to 1.4.0 (suite now 197/197, was 47 failing).

Schema/SQL fixes:
- `createType` reused one parameter as both a uuid and the text `path` column,
  breaking Postgres parameter-type inference; give `path` its own parameter.
- `history.change_type` was `VARCHAR(10)` — too narrow for `'soft-delete'` (the
  CHECK already allowed it); widen to `VARCHAR(20)`.
- `chk_functions_return_type` required exactly one of `return_type` /
  `return_type_id`; a function may declare neither — relax to forbid only both.
- `_migrate` re-ran every migration on each open (failing on non-idempotent
  `ADD CONSTRAINT`); add a `schema_migrations` ledger so each runs once, with a
  baseline guard for already-migrated databases.

Adapter fixes:
- `tree()` infinite-looped because root is self-parented; skip self-parented
  nodes when building the parent→children map.
- `delete()` now clears derived backlink (`links`) rows before removing an item.
- Fixed the materialized-path cascade on a `parentId` move: `SUBSTRING(path FROM
  $n)` with an untyped parameter is the regex-pattern form and returned null,
  wiping descendant paths — cast the position to `::int`.
- `query()` with an unknown non-strict type now returns an empty set (with a
  warning) instead of ignoring the filter and returning everything.
