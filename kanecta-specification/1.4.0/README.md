# Kanecta Datastore Specification — v1.4.0

**Status:** Active  
**License:** MIT — © 2026 Richard Thomas  
**Breaking change from:** v1.3.0 — migration script in `kanecta-migrations/1.4.0/`

## Documents

| File | Description |
|---|---|
| [specification.adoc](specification.adoc) | Full specification. Start here. Covers the four-section item format, all item types, payload shapes, search (FTS + semantic), inline links, external type systems, multiple trees, provenance, type lifecycle, aspects, templates, well-known roots, DB table mapping, business rules, and constraints. Includes adapter hints for Postgres and SQLite throughout. |
| [file-specs/item.json](file-specs/item.json) | JSON Schema for `item.json`. Source of truth for all item fields and payload shapes. |
| [types/built-in-types.json](types/built-in-types.json) | Canonical list of all valid `item.type` values, grouped into `primitive`, `structured`, and `wellKnown` categories. |

## Key changes in 1.4.0

- **Single `item.json`** replaces `metadata.json` + `function.json` + `type.json` + `object.json`
- **Four-section structure** (`item` / `meta` / `search` / `payload`) maps directly to four DB tables
- **`parentId` always required** — root self-references the all-zeros UUID
- **`file` type** replaces the former `image` and `markdown` primitives (use `payload.mimeType`)
- **`relationship`** and **`grant`** are now first-class item types
- **`component`**, **`tree`**, and **`node`** added as primitive types
- **Semantic search** — embedding metadata in `search` section, float vector in `embedding.bin` sidecar
- **`sameAs`** — open URI array for mapping to external type systems (schema.org, Wikidata, etc.)
- **`searchFields`** — type-level control over the FTS corpus
- **Provenance fields** — `ownerDomain`, `namespace`, `copyrightHolder`, `contentHash`, `mirrors`
