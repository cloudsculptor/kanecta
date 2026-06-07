# Kanecta Datastore Specification — v1.3.0

**License:** [MIT](../../LICENSE) — © 2026 Richard Thomas

## Documents

| File | Description |
|------|-------------|
| [specification.md](specification.md) | Full filesystem specification — directory layout, file schemas, business rules, constraints |
| [extended-specs/specification.db.md](extended-specs/specification.db.md) | Database variant — maps the data model to ANSI SQL |
| [extended-specs/specification.db.postgres.md](extended-specs/specification.db.postgres.md) | PostgreSQL-specific implementation notes |

## File schemas

JSON Schema definitions for every file type written by a conforming implementation. Published as part of the [`@kanecta/specification`](https://www.npmjs.com/package/@kanecta/specification) npm package.

| Schema | File location in datastore | Description |
|--------|---------------------------|-------------|
| [file-specs/metadata.json](file-specs/metadata.json) | `.kanecta/data/{s1}/{s2}/{uuid}/metadata.json` and `.kanecta/types/{s1}/{s2}/{uuid}/metadata.json` | Item and type-definition metadata |
| [file-specs/type.json](file-specs/type.json) | `.kanecta/types/{s1}/{s2}/{uuid}/type.json` | Custom type definition (display meta + JSON Schema) |
| [file-specs/items.json](file-specs/items.json) | `.kanecta/tags/{s1}/{s2}/{tag}/items.json` and `.kanecta/types/{s1}/{s2}/{uuid}/items.json` | Tag and type index files |
| [file-specs/meta.json.md](file-specs/meta.json.md) | `.kanecta/data/{s1}/{s2}/{uuid}/meta.json` | Denormalized type display cache — derived from `metadata.json` + `type.json`, not a fixed schema |
| [file-specs/object.json.md](file-specs/object.json.md) | `.kanecta/data/{s1}/{s2}/{uuid}/object.json` | Field values for a typed object item — an instance of the type's `jsonSchema` |
