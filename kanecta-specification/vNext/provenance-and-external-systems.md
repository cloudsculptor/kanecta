# Provenance and External Systems

## Two related problems

**External system origin** — an item that represents a Jira ticket, GitHub PR, or Confluence page needs to record where it came from so ingestion is idempotent and lookups by external ID are fast.

**AI pipeline provenance** — an item or relationship created by an AI agent needs to record which pipeline run produced it, so any AI-generated knowledge can be traced back to its origin and its confidence level is distinguishable from human-curated knowledge.

Both are solved by new fields on items and relationships.

---

## New fields on items

```sql
source_system  VARCHAR(100),   -- e.g. "jira", "github", "confluence", "langgraph"
source_id      VARCHAR(255),   -- the external system's own identifier for this item
source_run_id  CHAR(36),       -- UUID of the pipeline-run item that created/updated this

CONSTRAINT uq_items_source UNIQUE (source_system, source_id)
```

All three are nullable. `null` means a native Kanecta item with no external origin and no AI pipeline context.

### source_system + source_id

Records that this item is a projection of something in an external system.

| source_system | source_id example |
|---|---|
| `"jira"` | `"PROJ-1234"` |
| `"github"` | `"owner/repo/pulls/42"` |
| `"confluence"` | `"space/page-id"` |
| `"linear"` | `"issue-uuid"` |

The `UNIQUE (source_system, source_id)` constraint makes ingestion idempotent — running a Jira sync twice does not create duplicate items. The sync script does an upsert:

```sql
INSERT INTO items (id, type, value, source_system, source_id, ...)
VALUES ($new_uuid, 'object', $title, 'jira', 'PROJ-1234', ...)
ON CONFLICT (source_system, source_id)
DO UPDATE SET value = EXCLUDED.value, modified_at = now(), ...;
```

Lookup by external ID:

```sql
SELECT * FROM items
WHERE source_system = 'jira'
  AND source_id = 'PROJ-1234'
  AND valid_to IS NULL;
```

### source_run_id

Records that this item was created or last updated by a specific AI pipeline run. Points to the UUID of a pipeline-run typed object in the datastore.

This creates a traceable chain:

```
item (AI-written decision)
  └── source_run_id → pipeline-run item
        └── relates-to → pipeline item
        └── derived-from → input jira-ticket item
        └── produced → output github-pr item
```

Any AI-written item can be traced to the run that produced it, the pipeline it ran under, and the input that triggered it.

`source_run_id` is set by AI agents when writing items. Human-created items leave it null.

---

## New fields on relationships

The same fields apply to relationship items:

```sql
source_system  VARCHAR(100),
source_id      VARCHAR(255),
source_run_id  CHAR(36)
```

When an AI agent infers a relationship (e.g. "this ticket depends-on this architectural decision"), `source_run_id` records which pipeline run made that assertion. This is distinct from `created_by`, which records the agent identity — `source_run_id` records the specific execution context.

---

## AI confidence convention

When AI agents create items or relationships, they must set `confidence` explicitly. The convention:

| Who created it | confidence value |
|---|---|
| AI agent, unreviewed | `"experimental"` |
| AI agent, human has seen it | `"exploring"` |
| Human has reviewed and agrees | `"decided"` |
| Human has locked it | `"locked"` |
| Human-created, no confidence set | `null` |

This convention is enforced at the application layer, not the schema. It is the primary mechanism for distinguishing AI-inferred knowledge from human-curated knowledge in the graph and in search results.

**Why this matters at scale:** A knowledge graph populated by AI agents over years will contain a mix of high-confidence human decisions and speculative AI inferences. Without a confidence signal, a query result looks identical regardless of source. With it, consumers can filter, weight, and surface the most trustworthy results.

### Confidence in AGE

When relationship items are mirrored into the AGE graph, `confidence` is stored as an edge property. This allows graph queries to filter by confidence:

```cypher
MATCH (a:Item {id: $id})-[r:DEPENDS_ON]->(b:Item)
WHERE r.confidence IN ['decided', 'locked']
RETURN b.id
```

Human-decided relationships only, no speculative AI inferences.

---

## Relationship to access control

`source_system`, `source_id`, and `source_run_id` are provenance fields — they record origin, not permission. An item from Jira is not automatically readable by everyone because it came from Jira. Access is still governed by `visibility` and `owner`.

External system items typically default to `visibility: "organisation"` since they represent shared work. AI-written items default to `visibility: "private"` of the agent's owner until promoted by a human.
