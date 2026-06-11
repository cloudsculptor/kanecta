# Plan: Typed relationships via first-class `relationship-type` items

## Context

Today, relationships are typed by a flat string slug (9 hardcoded values: `relates-to`,
`depends-on`, `enables`, `contradicts`, `blocks`, `blocked-by`, `prerequisite-for`,
`derived-from`, `supersedes`) enforced by a CHECK constraint in Postgres and a
`VALID_REL_TYPES` array in the filesystem adapter. Relationships are create-only — no
update/delete exists anywhere in the stack.

The goal: make relationship **types** first-class items (same `{meta, jsonSchema, sqlSchema}`
pattern as `type` items), keep relationship *instances* lightweight typed records
referencing them by UUID, add richer edge-level fields for graph-database readiness, and
introduce mutability (update/delete) with history snapshotting.

---

## Target relationship-instance record shape

| Field | Change |
|---|---|
| `typeId` | **new**, required UUID — replaces the old `type` slug |
| `data` | **new**, nullable object — validated against the relationship-type's `jsonSchema` |
| `confidence` | **new**, nullable — reuses item enum: `experimental/exploring/decided/locked` |
| `owner` / `visibility` | **new** — mirrors item fields (`visibility: private/organisation/public`, default `private`) |
| `id`, `sourceId`, `targetId`, `createdAt`, `createdBy`, `note` | unchanged |

The old `type` slug is **retired** — the relationship-type item's `value` (e.g. `"depends-on"`)
is the human-readable label, resolved via `typeId`. This avoids a redundant, driftable cached copy.

---

## New `relationship-type` item shape

Stored in `.kanecta/relationship-types/` (own namespace, `parentId: null`,
`type: "relationship-type"`) with a sidecar `relationship-type.json`:

- **`meta`**: standard fields + `directional` (boolean) + `inverse` (UUID of paired
  inverse type, e.g. `depends-on` ↔ `enables`)
- **`jsonSchema`**: validates the `data` payload on relationship instances of this type
  (e.g. `{ strength: "soft"|"hard", reason: string }`)
- **`sqlSchema`**: DDL for a `rel_<id>` table keyed by `relationship_id` (mirrors
  `obj_<id>` for typed objects)
- Functions/skills attach via the **existing** `relate()` mechanism — no new field needed

---

## Implementation phases

### Phase 1 — Specification & validation
- Add `kanecta-specification/1.3.0/file-specs/relationship-type.json` (mirrors `type.json`,
  plus `directional`/`inverse` in `meta`)
- Add `relationship-type` to item-type categories in `types/primitive.json`
- Update `specification.md` "Semantic Relationships" section with new record shape; add
  Updating/Deleting Relationships business rules with history snapshotting (mirroring
  the existing Updating/Deleting Items section)
- Add `validateRelationshipType()` to `kanecta-schema-validator/index.js`, parallel to
  `validateType()`

### Phase 2 — Storage layer
- **Filesystem** (`kanecta-filesystem/src/adapter.js`): add `.kanecta/relationship-types/`
  namespace + CRUD (mirroring `_typeDir`/`createType`/`readTypeJson`/`writeTypeJson`/
  `_addTypeEntry`); rework `relate()` to accept `typeId`/`data`/`confidence`/`owner`/
  `visibility`; add `updateRelationship()`/`unrelate()` with history snapshots to
  `.kanecta/history/`
- **Postgres** (`kanecta-postgres/`): add `relationship_types` table (mirrors `types` table
  with `json_schema`, `meta_*` columns, `sql_schema`); migrate `relationships` table —
  replace the hardcoded CHECK constraint with `type_id UUID REFERENCES relationship_types(id)`,
  add `data JSONB`, `confidence`, `owner`, `visibility` columns; implement update/delete
  for relationship instances
- **kanecta-lib** (`datastore.js`): extend delegation layer with
  `createRelationshipType`/`readRelationshipTypeJson`/`writeRelationshipTypeJson`/
  `listRelationshipTypes`/`updateRelationship`/`unrelate`; update
  `kanecta-api-client/index.d.ts` types

### Phase 3 — API & MCP surface
- **kanecta-api** (`src/app.js`): add relationship-type CRUD routes; extend
  `POST /relationships` to accept `typeId`/`data`/`confidence`; add
  `PATCH`/`DELETE /relationships/:id`
- **kanecta-mcp** (`src/index.js`): add `kanecta_create_relationship_type` /
  `kanecta_get_relationship_type_schema` / `kanecta_update_relationship_type_schema` tools
  (parallel to `kanecta_create_type` etc.); update `kanecta_relate` to take `typeId`/
  `data`/`confidence` instead of a slug `type`; add `kanecta_unrelate`/
  `kanecta_update_relationship`

### Phase 4 — Studio frontend
- Reconcile the stale `RelationshipType` enum (`related/supports/contradicts/...` doesn't
  match backend slugs) and the `fromId/toId` → `sourceId/targetId` mapping in
  `src/types/kanecta.ts` and `src/api/relationships.ts`
- Add relationship-type browser UI and `typeId`/`data` picker when creating a relationship

### Phase 5 — Seed data & migration
- Seed canonical `relationship-type` system items for the 9 existing slugs with `inverse`
  pairings (`depends-on` ↔ `enables`, `blocks` ↔ `blocked-by`, `prerequisite-for` ↔
  `derived-from`, `supersedes` → none, `contradicts` → self, etc.) in
  `kanecta-system-items/`
- Write a `1.3.0→1.4.0` migration script: seed relationship-type items, then walk every
  existing relationship record and replace its `type` slug with the matching
  relationship-type item's `typeId`; backfill `confidence: null`, `owner`/`visibility`
  defaults

---

## Verification
- Schema-validator unit tests: `validateRelationshipType()` against good/bad fixtures;
  `validateItem()` against `data` payloads
- Filesystem + Postgres adapter tests: create a relationship-type, create/update/unrelate
  a typed relationship, confirm `data` validation, history snapshots, index consistency
- Migration dry-run against `kanecta-datastore-sample` and a real datastore copy — every
  relationship ends up with a valid `typeId`, old slug fully retired, clean validation pass
- API/MCP smoke test: create a relationship-type → relate two items with `typeId`+`data`
  → fetch via `kanecta_get_relationships` → confirm shape end-to-end

---

## Key constraints found during research
- Relationships are currently **create-only** — `updateRelationship`/`unrelate` don't
  exist anywhere (lib, filesystem, postgres, API, MCP). Adding history requires adding
  mutability first.
- Postgres has a hardcoded `CHECK (type IN (...))` constraint on `relationships.type` —
  must be replaced with a FK.
- Studio's `RelationshipType` enum already mismatches backend slugs (historical drift).
- Item `confidence` enum already includes `experimental/exploring/decided/locked/low/
  medium/high/verified` — reuse this for relationship confidence.
