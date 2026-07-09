# community-hub type manifest (cutover scaffolding)

Authored `type` items for the community-hub → kanecta-api cutover (plan gap **G5**).
This is the **discussions** slice — the hardest domain — as the worked example;
other domains are listed as TODO in `kanecta.manifest.json`.

**Status: branch scaffolding, not seeded.** Placeholder (deterministic) UUIDs;
finalise before seeding. Nothing here touches the live community-hub app.

## What's here
- `kanecta.manifest.json` — the manifest index: the `Discussions` container, the
  type files, and the computed-field function references.
- `ch-thread.type.json`, `ch-message.type.json`, `ch-file.type.json` — the type
  items. Each ships `meta` + `jsonSchema` (with the `x-graphql` vocabulary); the
  **`sqlSchema` is intentionally omitted** — the seeder derives it via
  `@kanecta/schema-compiler` (`deriveSqlSchema`), per the spec's sqlSchema rules
  ("ontology-generated types which ship only a jsonSchema get storage for free").

## Conventions (see ../../src/graphql/README.md)
- Fields are **camelCase**; DB columns become **snake_case** automatically
  (`createdByUserId` → `created_by_user_id`).
- The `x-graphql` block declares non-column fields: `containment` (messages,
  replies), `reference` (files, via an `attaches` relationship), and `computed`
  (hasUnread / isNotificationsEnabled per-viewer; replyCount).
- Soft-delete columns (`archivedAt`, `deletedAt`) are stored but hidden from the
  GraphQL surface via `x-graphql.expose: false`.

## Verified by
`../../tests/graphql/manifest.test.ts` — loads these real files, builds the
SchemaModel + SDL, derives each type's Postgres DDL via the compiler, and runs the
generic executor over an in-memory discussions graph.
