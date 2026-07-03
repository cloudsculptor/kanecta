---
"@kanecta/schema-compiler": minor
---

New package: derive a type's SQL storage schema from its `jsonSchema`, per backend.

`deriveSqlSchema(jsonSchema, { typeId, dialect })` compiles the flat, one-level
type schema into `CREATE TABLE` DDL for `postgres`, `sqlite`, or portable `ansi`.
The canonical (ansi) model uses only scalar column types — no JSON, no array
columns — so a scalar-array field decomposes into an ordered child value-table;
Postgres keeps a native `TYPE[]` column and SQLite stores JSON text (same logical
array). UUID references become foreign keys to `items(id)`; camelCase properties
become snake_case columns; the object table is `obj_<typeId>`. This makes a type's
`sqlSchema` derived (never hand-authored) and portable to any ANSI SQL database.
