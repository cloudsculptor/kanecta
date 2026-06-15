# Settled Decisions

Locked architectural decisions for the next major version of the Kanecta spec. These are not proposals — they have been explicitly decided and should be treated as the baseline for all new design work.

Each entry records what was decided, why, and where the full spec lives.

---

## 1. Nodes win — parent_id removed from items

**Decision:** The tree is a separate concept from items. Nodes are distinct items (type: `"node"`) that reference items by UUID. Items carry no tree information — no `parent_id`, no `sort_order`, no `aspect`. An item can appear in multiple trees via multiple nodes.

**Why:** Conflating "what an item is" with "where it lives" forces symlinks as a second-class workaround for multi-location, ties CRUD operations to tree position, and pollutes `loadAll()` with tree concerns. Separating them gives clean items, unlimited trees, and move operations that don't touch items at all.

**Full spec:** [nodes-and-trees.md](nodes-and-trees.md)

---

## 2. Well-known root nodes retired — namespace field replaces them

**Decision:** `system_root`, `app_root`, `component_root`, `data_root` are retired. The only well-known item is `root` — UUID `00000000-0000-0000-0000-000000000000`, type `"tree"`, the bootstrap anchor. Namespace separation is provided by a `namespace` field on every item (`"system" | "app" | "user"`), not by tree position.

**Why:** Using well-known UUIDs as a proxy for access control is a workaround, not a solution. Namespace as a field is explicit, queryable, and independent of where an item sits in the tree. Real access control (tiered trust, organisation-level visibility) will be solved properly as a whole — namespace provides separation in the meantime.

**Full spec:** [namespace.md](namespace.md)

---

## 3. content_hash is authoritative on every item

**Decision:** Every item carries a `content_hash` field in meta — SHA-256 of the canonical serialisation of `value` + `payload`. Recomputed and stored on every write. Authoritative — not derived.

**Canonical serialisation rule:** UTF-8, JSON keys lexicographically sorted at every level of nesting, no whitespace, no trailing newline, arrays preserve insertion order.

Format: `sha256:<64 hex chars>` (71 characters total).

**Why:** Any projection layer (AGE graph, pg_vector embeddings, Elasticsearch, future stores) has the same staleness problem. A single authoritative hash on the item means every projection layer can detect staleness without independently computing it. Also enables integrity verification and efficient sync between datastores.

**Relationship context is excluded from the hash.** Changing a relationship does not stale the item's hash. Projection layers that need to react to relationship changes handle that separately.

**Full spec:** [embeddings.md](embeddings.md) (hash spec is there; embeddings build on it)

---

## 4. Embeddings are a projection, not authoritative

**Decision:** Embeddings are a derived layer — expendable, rebuildable, never backed up as source of truth. Postgres + pg_vector is the reference implementation. Other backing stores may have no embedding layer at all.

What gets embedded: `value` + `payload` combined. Relationship context excluded.
Model: one active model per item in the typical case; the schema supports multiple.
Staleness: detected by comparing `content_hash` on the item against `content_hash` stored at embed time.

**Full spec:** [embeddings.md](embeddings.md)

---

## 5. AGE graph is a projection, not authoritative

**Decision:** Apache AGE (Postgres graph extension) is a derived traversal index, not a store. Items become vertices, relationship items become edges. Populated via triggers, rebuildable from the items table. Nothing authoritative lives in AGE.

**Why:** AGE adds Cypher-based multi-hop traversal and path-finding that SQL cannot match efficiently. The Kanecta data model is richer than AGE — AGE is used purely for traversal performance, then UUIDs returned are resolved against Kanecta's full data.

**Full spec:** [graph-projection.md](graph-projection.md)

---

## 6. Pipeline and agent types are user-defined, not core

**Decision:** `pipeline`, `agent`, and `pipeline-run` are not in the minimum viable type set. They are user-defined typed objects, shipped as a canonical `kanecta-pipelines` system item package.

**Why:** These types need no special treatment from the generic layer. No indexed columns, no special query paths, no system behaviour that depends on them existing. Adding them to the core spec would be premature specificity. They belong alongside domain types like `epic` or `stakeholder` — powerful, but not Kanecta's concern to define.

---

## 7. MCP API surface belongs in the main spec

**Decision:** The MCP tool surface is specified in `specification.md` as a first-class section, not in an extended spec. MCP is how AI agents interact with Kanecta — it is central enough to the protocol's purpose to belong alongside the data model.

**Design doc:** [mcp-api-surface.md](mcp-api-surface.md)

---

## 8. External system provenance fields on all items

**Decision:** Items carry `source_system` and `source_id` for external system origin tracking, and `source_run_id` for AI pipeline provenance. These are nullable — null means native Kanecta item, no external origin.

**Full spec:** [provenance-and-external-systems.md](provenance-and-external-systems.md)

---

## 9. AI confidence convention

**Decision:** Items and relationships created by AI agents default to `confidence: "experimental"`. Human review promotes to `"exploring"` or `"decided"`. Human lock sets `"locked"`. Existing items with no confidence value remain `null`.

This convention is enforced at the application layer, not the schema. It is the mechanism that distinguishes AI-inferred knowledge from human-curated knowledge in the graph.

**Full spec:** [provenance-and-external-systems.md](provenance-and-external-systems.md)
