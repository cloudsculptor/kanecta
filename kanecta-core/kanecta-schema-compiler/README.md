# @kanecta/schema-compiler

Derive a Kanecta type's **SQL storage schema from its `jsonSchema`** — per backend.

A type's `sqlSchema` is not hand-authored; it is *compiled* from the `jsonSchema`
(the single source of truth). The canonical model is portable to **any ANSI SQL
database**: only scalar column types, no JSON columns, no array columns. Each
adapter may then optimise physically without changing the logical shape.

```js
const { deriveSqlSchema } = require('@kanecta/schema-compiler');

deriveSqlSchema(
  { properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } },
  { typeId: '…uuid…', dialect: 'postgres' },
);
// => [ 'CREATE TABLE "obj_…" ( item_id UUID NOT NULL, "name" TEXT, "tags" TEXT[], … )' ]
```

## Dialects

| jsonSchema | `postgres` | `sqlite` | `ansi` (portable) |
|---|---|---|---|
| `string` | `TEXT` | `TEXT` | `CLOB` |
| `integer` | `BIGINT` | `INTEGER` | `BIGINT` |
| `number` | `DOUBLE PRECISION` | `REAL` | `DOUBLE PRECISION` |
| `boolean` | `BOOLEAN` | `INTEGER` | `BOOLEAN` |
| uuid reference (`typeId` / `x-kanecta-itemType`) | `UUID` + FK to `items(id)` | `TEXT` + FK | `CHAR(36)` + FK |
| **scalar array** | native `TYPE[]` column | JSON `TEXT` column | **decomposed child value-table** |

The object table is `obj_<typeId>` (hyphens → underscores), with `item_id` as the
primary key and a foreign key to `items(id)`. camelCase property names become
snake_case columns.

### Arrays and portability

ANSI SQL has no array type, so in the `ansi` dialect a scalar-array field is
decomposed into an ordered child value-table `obj_<typeId>_<field>(item_id, ord,
value)` — a portable multi-valued field. Postgres keeps the native `TYPE[]` column
(fast) and SQLite stores JSON text; all three are the same logical array in the
read model. Object arrays (arrays of typed objects) are not columns at all — they
are child items, per the flat one-level type rule.

## Returns

An ordered array of DDL strings: the object table first, then any child
value-tables (ANSI arrays). Feed them to the adapter's `CREATE TABLE` path.
