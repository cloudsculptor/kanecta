# Kanecta Core Data Model Architecture

A record of a design session exploring the foundational data model for Kanecta — what tables we need, why, and the principles behind each decision.

---

## The conclusion up front

Kanecta's source of truth is **three tables**. Everything else is a projection.

```
items          — what exists
item_history   — what existed  
activity       — what happened
```

No exceptions. Every concept in the system — entities, relationships, types, permissions, comments, likes — is an item. The other two tables capture time and behaviour.

---

## Starting point: key-value stores at scale

The session started with a survey of large-scale storage options, which informed the data model decisions.

### Popular open-source KV stores

- **Redis / Valkey** — in-memory, fast, rich data types, persistence optional. Default for caching and sessions. Valkey is the Linux Foundation fork after Redis changed its license in 2024.
- **RocksDB** — embedded, LSM-tree, SSD-optimised. The storage engine inside many other systems (Kafka, TiKV, Cassandra internals).
- **LevelDB** — Google-made embedded KV, simpler than RocksDB (RocksDB is a fork of it).
- **etcd** — distributed, strongly consistent via Raft, used for config and service discovery. Kubernetes stores all state here.
- **LMDB** — embedded, memory-mapped, extremely fast reads, copy-on-write MVCC.
- **TiKV** — distributed, transactional, MVCC, built by PingCAP. The strongest open-source answer for planet-scale KV.

### For truly massive scale

A single-node KV store isn't enough. The pattern used by hyperscalers:

> **RocksDB per node + Raft consensus + consistent hashing/range sharding**

TiKV packages all three as open source. Meta uses ZippyDB (RocksDB underneath). Google uses Bigtable/Spanner (proprietary). Amazon uses DynamoDB (proprietary).

---

## Do KV stores only hold one value per key?

No — it depends on the abstraction level:

| Store type | Value shape |
|---|---|
| Pure KV (Redis, RocksDB) | Opaque bytes — one value per key |
| Wide-column (Bigtable, HBase, Cassandra) | Row → sparse columns, many values per key |
| Document (MongoDB, CouchDB) | Key → nested JSON document |
| TiKV | Raw bytes, but TiDB adds SQL on top |

**Bigtable model** (the "big table"): `row key → column family → column → value`. A single row can have thousands of columns, each with its own value.

```
row: "user:123"
  personal:name    → "Richard"
  personal:email   → "r@example.com"
  activity:login   → "2026-06-12"
```

HBase is the canonical open-source Bigtable clone. Cassandra and ScyllaDB are the more operationally mature alternatives.

---

## Why not just use Postgres?

Postgres is surprisingly capable but has real ceilings.

### Where Postgres holds up fine
- Single node: handles billions of rows, terabytes of data
- JSONB column gives you wide-column / document model natively
- GIN indexes on JSONB are fast
- Logical replication scales reads

### The real limits

**Single-writer bottleneck** — all writes go to one primary node. Horizontal write scaling (via Citus or partitioning) is possible but bolted on, not native.

**MVCC bloat** — every update writes a new row version. Heavy write workloads generate dead tuples requiring vacuum. At extreme scale, vacuum can't keep up.

**No automatic sharding** — Cassandra/HBase rebalance automatically as nodes are added. Postgres requires manual intervention.

**WAL throughput** — the write-ahead log becomes the bottleneck at very high ingest rates. LSM-tree stores are architecturally better suited to write-heavy workloads.

**Statistics problem** — Postgres builds column statistics to optimise query plans. With JSONB it has no statistics on individual fields — the planner is partially blind on complex queries.

### Practical verdict

| Scale | Verdict |
|---|---|
| < 1TB, < 10k writes/sec | Postgres is fine, probably ideal |
| 1–10TB, moderate writes | Postgres + read replicas + partitioning, still workable |
| 10TB+, high write throughput | You're fighting Postgres; purpose-built system wins |

**Most projects never hit the ceiling.** The risk of choosing Postgres and being wrong is much lower than choosing Cassandra and not needing it.

---

## The items table: JSONB with a flat payload

The proposed schema:

```sql
items (
  uuid,
  type,
  typeId,
  created_at,
  updated_at,
  -- other metadata fields
  value,      -- simple primitive value
  payload     -- jsonb
)
```

### Querying JSONB vs real columns

**Query syntax — nearly identical:**
```sql
-- JSONB
SELECT * FROM items WHERE data->>'make' = 'Ford';

-- Real table  
SELECT * FROM cars WHERE make = 'Ford';
```

**Performance — real columns win on indexes:**

Real columns get indexes automatically. JSONB requires manually creating a partial index per field:
```sql
CREATE INDEX ON items((data->>'make')) WHERE type = 'cars';
```

These work well but require explicit creation, and the planner can't reason about them as reliably.

**The deeper problem with typed rows in one table:**

```sql
SELECT * FROM items WHERE data->>'make' = 'Ford' AND data->>'colour' = 'Red';
```

This query is meaningless (cars don't have colour) but Postgres won't stop you. You lose type safety, foreign key constraints, and not-null enforcement entirely.

**Sweet spot:** Works great when different types genuinely have different shapes and you're querying mostly by `id` or `type`. Falls over when you need complex joins across fields, strong constraints, or deep query optimisation.

---

## The universal items model: why it's right for Kanecta

The type universe in Kanecta is **genuinely open-ended** — users define types. You can't define a schema per type upfront. This is the actual reason a single items table makes sense. It has nothing to do with event sourcing.

### The pattern

**Single source of truth** (items table) → **projections** for query performance.

This is the CQRS read-model pattern: one write model, multiple read models. Projections are derived, disposable, and rebuildable from items.

**The key discipline:** projections must be treated as truly disposable. If any code writes to a projection as source of truth, the guarantee is lost. This boundary is surprisingly hard to maintain as a codebase grows.

---

## item_history: temporal dimension

### Full row snapshots, not diffs

**Store the entire row on every change — not just what changed.**

Why full snapshots win:

- **Diffs are cheap to store, expensive to use.** To answer "what did this item look like on June 1st?" with diffs you must replay every change from the beginning. With snapshots you query by date.
- **JSONB diffs are especially painful.** Diffing and patching nested JSON correctly is fiddly code with edge cases.
- **Storage is cheap.** The extra bytes per version are negligible vs operational complexity.
- **Postgres already does this internally.** MVCC keeps full row versions — you're just surfacing that pattern explicitly.

Exception: if payloads are genuinely huge (megabytes) with thousands of versions per item, diffs start making sense. Cross that bridge only if you hit it.

### Schema

```sql
item_versions (
  id,
  item_id,
  version_number,
  changed_at,
  changed_by,
  snapshot     -- entire row as jsonb
)
```

### Capture every lifecycle event

The trigger must fire on **INSERT, UPDATE, and DELETE**. If only updates are captured, items that were created and never modified can't be rebuilt. Deleted items need a final snapshot with a `deleted` marker, otherwise a rebuild would resurrect them.

### item_history as disaster recovery

If the items table is destroyed, item_history is a complete audit log you can replay to rebuild it. This gives you:

- Full backup
- Audit log  
- Event source (if you ever want to go there)
- Disaster recovery

All four for the cost of one trigger and some storage.

---

## What Git taught us

Git's internal architecture is a masterclass in content-addressable, append-only storage. Several lessons apply directly to Kanecta.

### Git's object model

Everything in Git is content-addressable. There is no distinction between text and binary at the storage layer. Four object types, all stored by SHA hash in `.git/objects/`:

| Type | What it is |
|---|---|
| blob | File contents (text, binary, anything) |
| tree | Directory listing (names + hashes of blobs/subtrees) |
| commit | Pointer to a tree + parent commit hash + metadata |
| tag | Pointer to a commit + metadata |

The whole structure is a **Merkle tree** — the same structure blockchains use. If you know a commit hash, you've cryptographically verified the entire state of the repo at that point. You can't change a single byte anywhere in history without changing every commit hash above it.

### Content-addressable storage: same file stored once

If the same file appears in multiple locations, Git stores it **once** and points to it from multiple tree entries. The tree structure is a separate layer of pointers on top of content.

```
commit
  └── tree (root)
        ├── blob ab3f9c2  ← "main.ts"
        └── blob ab3f9c2  ← "copy-of-main.ts" (same hash, same object)
```

**Location and name are metadata. Content is identity.**

Practical consequences:
- Rename a file → no new blob, just a new tree entry
- Copy a file to 10 places → one blob, 10 pointers
- Move a file → Git detects rename by noticing hash already exists

### Hash collisions: are they a real risk?

- **Accidental collision**: practically impossible (1 in 2^80 for SHA-1, 2^128 for SHA-256)
- **Adversarial/crafted SHA-1 collision**: demonstrated by Google's SHAttered attack in 2017, but required ~6,500 CPU years
- **SHA-256**: no known collisions; considered safe for the foreseeable future

**Use SHA-256 for content-addressable storage in Kanecta.** Hash collision is not a real engineering concern — sync reliability, projection consistency, and schema evolution are orders of magnitude more likely to bite you.

### Git lessons applied to Kanecta

1. **Content-addressable blobs** — store payloads/attachments by SHA-256 hash. Deduplication and integrity checking fall out for free. If two items share a payload, store the blob once, reference by hash from both rows.

2. **Separate identity from location** — a file's identity is its content, not its name or path. In Kanecta: an item's identity is its UUID, not its position in a tree or its type. Never use tree position as a primary reference.

3. **The tree is just a pointer layer** — folder structure in Git is metadata on top of content. In Kanecta, the parent/child hierarchy is just relationships — a separate layer on top of items. Destroying a relationship doesn't destroy the item.

4. **Cheap branching via pointer indirection** — Git branches are just pointers to commit hashes, almost free to create. If Kanecta ever needs workspaces or drafts, the same idea applies: a workspace is a pointer to a set of item versions, not a copy of the data.

5. **The staging area lesson** — Git separates working state from committed state. Kanecta might benefit from a draft/uncommitted state for items before they're published or shared.

6. **Merkle chaining for tamper-evidence** — each item version could include a hash of the previous version, giving a cryptographic audit chain. **Decision: skip for now.** Only valuable when making legal/compliance guarantees to users or when there's a multi-party trust problem. Neither applies to Kanecta today. Add later if a specific requirement emerges.

---

## activity table: behavioural dimension

A separate append-only table for everything that *happened* — not what changed (that's item_history) but what was done.

```sql
activity (
  id,
  created_at,
  actor_id,       -- user, MCP client, system
  actor_type,     -- human | mcp | system | external
  verb,           -- viewed | liked | commented | created | updated | deleted | denied
  item_id,        -- the item acted on (nullable for system events)
  outcome,        -- success | denied | failed
  payload         -- jsonb, anything extra
)
```

### What activity covers

- User actions: viewed, created, updated, deleted, liked, commented
- MCP/system actions
- Permission changes: grant, revoke
- Authentication events: login, logout
- Failed/denied actions: a user tried to access something and was denied — this never touches items or item_history, only lives in activity
- Bulk operations: 500 items updated in one go (log one row or 500 — tradeoff to decide)
- External events: webhook arrived, email sent, integration fired (`actor_type: "external"`)

### The outcome field matters

Without `outcome` you can't distinguish "viewed" from "tried to view but couldn't". Always capture success | denied | failed.

### Comments as both item and activity

A comment is:
- An **item** in its own right (`type: "comment"`, related to target item)
- Plus an **activity row** recording the `commented` event

This way comments are first-class queryable items, and activity is still a pure event log. Don't make one table do both jobs.

---

## Relationships are first-class items

Relationships are not a separate table. A relationship is just an item:

```sql
item: { type: "relationship", payload: { fromId, toId, label: "parent-of" } }
```

**Why this is correct:**

- Relationships get everything items get for free: history, activity, types, annotations, payload
- A relationship can have metadata, be versioned, appear in the activity feed
- No special-case code needed
- The "relationships table" people normally reach for is just a projection — an index over items of type `relationship` for query performance

---

## Permissions and ReBAC

### Permissions are items too

```sql
item: { type: "permission", payload: { principalId, itemId, access: "read" } }
```

A principal (user, group, role) is also just an item.

Access control becomes: **can principal X reach item Y via a permission item?**

Benefits:
- Permission granted → item created
- Permission revoked → item deleted + activity row  
- Permission history → item_history
- Full audit of who granted what to whom and when, for free

### ReBAC — Relationship-Based Access Control

The modern access control model. Google Zanzibar is the canonical implementation (powers Google Drive, Docs, Calendar).

Zanzibar's core tuple:
```
object:id#relation@user:id
doc:readme#viewer@user:alice
group:eng#member@user:alice
```

In Kanecta's model this is just:
```sql
item: { type: "permission", payload: { 
  objectId, 
  relation: "viewer", 
  principalId 
} }
```

**Inherited permissions** fall out naturally — if Alice is a member of group `eng`, and `eng` has viewer access to a document, that's just graph traversal over permission items, which are relationships, which are items.

### Open-source Zanzibar implementations

- **OpenFGA** — by Auth0, most production-ready
- **SpiceDB** — by Authzed, very popular
- **Permify** — newer, gaining traction

**Key insight:** Kanecta's items model is already a Zanzibar-compatible tuple store. The permission check logic can be a query over items — or a projection optimised for graph traversal.

---

## Projections: the indexing/caching layer

A **projection** is a derived representation of data optimised for a specific read pattern. The word comes from mathematics — you're projecting source data into a different shape.

### Key properties

- **Derived** — calculated from source data, never written to directly
- **Disposable** — if corrupted or lost, rebuild from source
- **Optimised** — shaped for a specific query pattern
- **Potentially stale** — may lag behind source by milliseconds or more

### Examples in Kanecta

| Source of truth | Projection |
|---|---|
| items of type `relationship` | `item_children` table for fast tree queries |
| items of type `permission` | `permissions` table for fast auth checks |
| activity rows where verb='like' | `likeCount` on item payload |
| item payload fields | Full-text search index |
| item_history | Point-in-time snapshots for time-travel queries |

Think of a projection like a **materialised database view** — actually stored for performance rather than computed on every query.

---

## The like-count problem: write-time aggregation

If you show like counts and query activity on every page load, at scale this is a full count query on every read. The solution used by every major platform:

### Write-time aggregation

Store the count as a denormalised field, increment/decrement it directly. Don't recount from source on reads.

```sql
item: { type: "post", payload: { likeCount: 4821 } }
```

When a like activity row is written, also increment `likeCount` in the **same transaction**.

### Redis for extreme volume

At Twitter-scale:
- Like arrives → `INCR post:4821:likes` in Redis (microseconds)
- Periodically flush Redis counts back to Postgres
- Reads hit Redis, not Postgres

### Preventing drift

Denormalised counts can drift if a transaction writes the activity row but fails to increment the counter. Fix:
- Always do both in the **same transaction**, or
- Background worker periodically counts from activity and reconciles

`likeCount` on an item is just a projection — derived from activity, cached for performance. Activity remains the source of truth.

---

## Could item_history and activity fold into items?

Technically yes. They're both just items:
```sql
item: { type: "history", payload: { snapshot } }
item: { type: "activity", payload: { verb: "viewed", actorId } }
```

**Why it's a bridge too far:**

**Volume** — history and activity are potentially orders of magnitude more rows than items. Every item change writes a history row. Every page view writes an activity row. The core entity table would be dominated by audit/event noise.

**Query patterns are completely different** — items you query by id and type; history by itemId + time range; activity by actor, verb, time (essentially a time-series). Sharing a table means indexes for one pattern hurt the others.

**Retention policies differ** — you might prune activity older than 1 year, keep history forever, and never delete items. Separate tables make this clean.

**Conceptual clarity** — the three-table model is explainable in one sentence each. Collapsing everything into items makes it harder to reason about and harder to onboard new developers.

**The principle:** The goal was never fewest tables. It was **clearest model**. The three tables aren't redundancy — they're three genuinely different access patterns and lifecycles that happen to share a similar shape.

---

## Final model

```
items          — what exists (entities, relationships, types, permissions, everything)
item_history   — what existed (full row snapshots on every change)
activity       — what happened (append-only event log)
```

**Everything else is a projection** — derived, disposable, rebuildable.

The single discipline this requires: **never let a projection become a source of truth.** The moment application code writes to a projection without also writing to items, the model is broken. Protect this boundary with convention, code review, or a lint rule.

This foundation covers:
- Any entity type (open-ended, user-defined)
- Relationships (first-class items)
- Permissions and ReBAC (items + graph traversal)
- History and audit (item_history + activity)
- Disaster recovery (rebuild items from item_history)
- Performance at scale (projections, Redis counters, content-addressed blobs)
- Tamper-evident audit chains (Merkle chaining, available when needed)
