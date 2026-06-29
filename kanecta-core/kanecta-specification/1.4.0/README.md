# Kanecta Datastore Specification — v1.4.0

**Status:** Active  
**License:** MIT — © 2026 Richard Thomas  
**Breaking change from:** v1.3.0 — migration script in `kanecta-migrations/1.4.0/`

## Documents

| File | Description |
|---|---|
| [specification.adoc](specification.adoc) | Full specification. Start here. Covers the four-section item format, all item types, payload shapes, search (FTS + semantic), inline links, external type systems, multiple trees, provenance, type lifecycle, aspects, templates, well-known roots, DB table mapping, business rules, and constraints. Includes adapter hints for Postgres and SQLite throughout. |
| [core-file-specs/item.json](core-file-specs/item.json) | JSON Schema for `item.json`. Source of truth for all item fields and payload shapes. |
| [core-file-specs/config.json](core-file-specs/config.json) | JSON Schema for `config.json` — the bootstrap config that tells the platform where datastores live and how to connect to remotes. |
| [working-sets-and-branches.adoc](working-sets-and-branches.adoc) | Teaching chapter on working sets, branches (canonical / mirror / sparse), the three deployment shapes, storage layout, reading/querying, push/PR/merge, and why Kanecta branching is not Git. Read after the core spec. |
| [write-integrity-and-durability.adoc](write-integrity-and-durability.adoc) | Teaching chapter on how a write lands atomically across the storage levels (L0 Authority / L1 Structured store / L2 Projections): serialized writes, the journal + cross-process lock, rollback/roll-forward recovery, cross-store (S3) atomicity, and non-blocking snapshot reads. |
| [built-in-types/built-in-types.json](built-in-types/built-in-types.json) | Canonical list of all valid `item.type` values, grouped into `primitive`, `structured`, and `wellKnown` categories. |

## Key changes in 1.4.0

- **Single `item.json`** replaces `metadata.json` + `function.json` + `type.json` + `object.json`
- **Four-section structure** (`item` / `meta` / `search` / `payload`) maps directly to four DB tables
- **`parentId` always required** — root self-references the all-zeros UUID
- **`file` type** replaces the former `image` and `markdown` primitives (use `payload.mimeType`)
- **`relationship`** and **`grant`** are now first-class item types
- **`tree`** and **`node`** added as primitive types; **`component`** added as a structured type (has `componentPayload`)
- **Semantic search** — embedding metadata in `search` section, float vector in `embedding.bin` sidecar
- **`sameAs`** — open URI array for mapping to external type systems (schema.org, Wikidata, etc.)
- **`searchFields`** — type-level control over the FTS corpus
- **Provenance fields** — `ownerDomain`, `namespace`, `copyrightHolder`, `contentHash`, `mirrors`
