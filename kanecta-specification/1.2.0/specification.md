# Kanecta Datastore Specification

**Version:** 1.2.0
**License:** [MIT](LICENSE) — © 2026 Richard Thomas

This document is the entry point for the Kanecta Datastore Specification. Two variants are provided — choose the one that matches your implementation target.

## Variants

| Variant | File | Description |
|---|---|---|
| [File system](specification.fs.md) | `specification.fs.md` | Datastore stored as a directory tree on disk |
| [Database](specification.db.md) | `specification.db.md` | Datastore stored in an ANSI SQL relational database |

Both variants implement the same data model, business rules, and link syntax. The filesystem variant is the original format; the database variant maps all concepts to relational tables and SQL operations.
