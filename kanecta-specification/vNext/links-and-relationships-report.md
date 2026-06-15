# Links vs Relationships — Architecture Report

*Written during design session, 2026-06-08.*

---

## Two distinct concepts

**Links** (`[[uuid]]` notation) are weak-signal, automatically derived connections.
They are created when one item's `value` contains `[[some-uuid]]`. They are stored
separately in `.kanecta/links/`, indexed so you can ask "what items mention this item?"
(`backlinks`). They require no curation — the connection is implicit in the text.

**Relationships** are strong-signal, intentional, curated edges. Today they carry a
typed slug (`depends-on`, `blocks`, etc.) and are the user's deliberate assertion that
two items are connected in a specific way. They are stored in
`.kanecta/relationships/[shard]/[source-uuid]/relationships.json` as
`{ outbound: [...], inbound: [...] }`.

These two mechanisms are complementary:
- Links = "this item references that item" (mention-graph, weak, auto-derived)
- Relationships = "this item depends on / contradicts / enables that item" (semantic
  graph, strong, user/AI-curated)

---

## What the typed relationship system adds

The plan is to make relationship **types** first-class items, like `type` and `function`
items today. Each relationship-type item defines:

- A human label (its `value`, e.g. `"depends-on"`)
- Whether the edge is directional (`meta.directional`)
- Its inverse type (e.g. `depends-on` ↔ `enables`)
- A `jsonSchema` validating the `data` payload each instance may carry
- A `sqlSchema` for a `rel_<id>` Postgres table to store that typed data
- Skills and functions can be **related** to it using the existing `relate()` mechanism,
  so AI agents know how to reason about edges of that type

Individual relationship instances become lightweight typed records:

```json
{
  "id": "<uuid>",
  "typeId": "<relationship-type-item-uuid>",
  "sourceId": "<item-uuid>",
  "targetId": "<item-uuid>",
  "data": { "reason": "..." },
  "confidence": "decided",
  "owner": "user@example.com",
  "visibility": "private",
  "createdAt": "...",
  "createdBy": "..."
}
```

---

## Does this cover a full property graph?

Yes. The combination gives you:

| Graph concept | Kanecta equivalent |
|---|---|
| Nodes | Items (with `typeId` pointing to a `type` item) |
| Node labels | Item `type` field + `typeId` |
| Node properties | Item `value`, typed `data` stored in `obj_<id>` table |
| Edges | Relationship instances |
| Edge labels | Relationship-type item's `value` (e.g. `"depends-on"`) |
| Edge direction | `directional` flag on relationship-type + `sourceId`/`targetId` |
| Edge properties | `data` JSONB on the relationship instance, validated by relationship-type's `jsonSchema`, stored in `rel_<id>` table |
| Multi-hop traversal | Possible once Postgres has `type_id` FK + indexes |
| Graph algorithms | Projectable to Apache AGE (Cypher) or Neo4j — all raw data present |

---

## Three fields identified as "add now, not later"

### 1. Edge-level `confidence`
- **Why**: If AI generates relationships, you need to distinguish "human deliberately
  asserted this" from "AI inferred this from a weak signal". `createdBy` tells you
  *who/what* made the edge; `confidence` tells you *how settled* it is.
- **Proposed**: reuse the existing item confidence enum:
  `experimental | exploring | decided | locked` (already in `metadata.json` schema).

### 2. Edge history / audit trail
- **Why**: Relationships are currently immutable (create-only). Once you can correct a
  wrong relationship type or update its `data`, you lose the history of what it was
  before. Items already snapshot to `.kanecta/history/` on create/update/delete — same
  pattern should apply to relationships.
- **Implication**: must add `updateRelationship()` and `unrelate()` operations first
  (they don't exist anywhere in the stack today).

### 3. Edge ownership + visibility
- **Why**: Once multiple users sync and share data over Postgres, a relationship
  asserted by user A shouldn't be visible to user B by default unless B has access.
  Items already have `owner` + `visibility` (private/organisation/public) — relationships
  need the same.
- **Proposed**: mirror exactly: `owner: string`, `visibility: "private" | "organisation" | "public"`,
  default `"private"`.

---

## Postgres + Apache AGE

All raw data needed to project a property graph is present once the typed relationship
system is in place:

- Nodes ← `items` table + `obj_<id>` type tables
- Edges ← `relationships` table + `rel_<id>` relationship-type data tables
- Labels, direction, properties ← all captured

Apache AGE (Postgres graph extension with Cypher) or Neo4j can be populated as a
**derived/projected layer** from this source data — the same philosophy as links,
types, and tags already being "derivable index caches" in the spec. You would not need
to store anything differently to support this later.
