# Semantic Retrieval for Kanecta

Kanecta pipelines need to inject relevant org context into AI prompts. This doc captures the retrieval
architecture options — from quick wins to longer-term infrastructure — to guide the roadmap.

## The problem

Naively injecting all tagged items bloats prompts and doesn't scale. We need retrieval that finds the
right context for a given input (e.g. a Jira ticket) without hardcoding UUIDs or requiring manual tags.

## Current approach (interim)

Two-pass AI filter: fetch titles of all `org-context` tagged items, ask Claude which are relevant to the
ticket, then fetch full subtrees for selected items only. Works today. Replaces the `org-context` tag
with something smarter once pgvector is available.

---

## Retrieval approaches

### 1. BM25 / full-text search

Postgres `tsvector` + `tsquery`. Built-in, no model required. Handles stemming and ranking. Great for
exact terminology: acronyms like "NoC", "PRNoC", system names. Much better than LIKE.

```sql
ALTER TABLE items ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(value, ''))) STORED;
CREATE INDEX ON items USING gin(fts);

SELECT id, value FROM items
WHERE fts @@ plainto_tsquery('english', 'NoC multiple names display')
ORDER BY ts_rank(fts, plainto_tsquery('english', 'NoC multiple names display')) DESC
LIMIT 20;
```

**Best for:** exact term matching, acronyms, system names that semantics would miss.

---

### 2. Vector / semantic search (pgvector)

Embed each item (or its full subtree serialisation) with a text embedding model. Store in postgres.
Query by nearest-neighbour to the ticket content embedding.

```sql
CREATE TABLE item_embeddings (
  item_id      UUID REFERENCES items(id) ON DELETE CASCADE,
  model        TEXT,
  embedding    VECTOR(1536),
  content_hash TEXT,       -- skip re-embed if content unchanged
  embedded_at  TIMESTAMPTZ,
  PRIMARY KEY (item_id, model)
);
CREATE INDEX ON item_embeddings USING hnsw (embedding vector_cosine_ops);
```

Auto-embed on item write: generate and upsert embedding whenever an item or its subtree changes.
The pipeline then calls `kanecta.search.semantic(text, { topN })` — no tags, no manual wiring.

**Best for:** conceptual similarity, finds relevant items even when vocabulary differs.

---

### 3. Hybrid search — BM25 + vector (recommended default)

The current production standard. Run both searches, combine scores with Reciprocal Rank Fusion (RRF).
BM25 catches exact terminology; vector catches meaning. Almost always outperforms either alone.

```ts
// Pseudocode
const bm25Results  = await kanecta.search.fullText(query, { topN: 20 })
const vectorResults = await kanecta.search.semantic(query, { topN: 20 })
const merged = reciprocalRankFusion([bm25Results, vectorResults])
return merged.slice(0, 5)
```

**Best for:** general-purpose retrieval. Use this as the default once pgvector is live.

---

### 4. Reranking (cross-encoder)

Retrieve top 20 cheaply with hybrid search, then score each (query, item) pair directly with a
cross-encoder model (Cohere Rerank, or a local model). More expensive per call but higher precision.

```ts
const candidates = await kanecta.search.hybrid(query, { topN: 20 })
const reranked   = await rerank(query, candidates)  // cross-encoder
return reranked.slice(0, 5)
```

**Best for:** high-stakes retrieval where precision matters more than latency.

---

### 5. HyDE — Hypothetical Document Embedding

Instead of embedding the raw ticket, first ask Claude: *"What would a perfect context document look
like for this ticket?"* Then embed that hypothetical document and search against it.

Retrieves much better because you match document-to-document rather than short-query-to-document.
Costs one extra LLM call per pipeline run.

```ts
const hypothetical = await kanecta.ai(`
  Write a short technical reference document that would be the ideal background
  knowledge for an engineer working on this ticket: "${ticketSummary}"
`)
const embedding = await embed(hypothetical)
return kanecta.search.byEmbedding(embedding, { topN: 5 })
```

**Best for:** tickets where the right context is conceptually related but uses different vocabulary.
Easy to layer on top of hybrid search.

---

### 6. Multi-query retrieval

Generate 3–5 rephrasings of the ticket summary, run all searches, deduplicate by item ID. Covers
vocabulary mismatches that a single query would miss.

**Best for:** ambiguous or terse ticket descriptions.

---

### 7. Step-back prompting

Abstract the ticket to a higher-level question before searching. "NoC won't display multiple names"
→ "How does NoC handle name display and data rendering?" Search against the abstraction, not the
literal bug description.

**Best for:** bug tickets where the literal symptom isn't the right search query.

---

### 8. Graph traversal from entity match

Extract entities from the ticket ("NoC", "multiple names", "display"). Find those strings in Kanecta
items via BM25 or exact match. Walk the knowledge graph outward (parent → children → related items)
to pull in adjacent context. No embeddings required — uses Kanecta's native structure.

**Best for:** Kanecta-native retrieval. Especially powerful once relationships are richer.

---

### 9. PathRAG / graph-aware retrieval

Retrieve not just matching nodes but the *paths* between them in the knowledge graph. The relationship
chain (e.g. NoC → Initiative V → affected systems) becomes part of the injected context, not just the
leaf nodes. Gives the LLM reasoning chains, not just isolated facts.

**Best for:** multi-hop reasoning tasks where context relationships matter.

---

### 10. Agentic retrieval

The pipeline step decides what to search for, gets results, decides what *else* to look up, and
iterates until it judges it has enough context. More research than lookup. Slow but thorough.

**Best for:** complex tickets with many unknowns. Overkill for most runs.

---

### 11. RAPTOR — recursive summarisation

Build a tree of summaries at multiple granularities over the Kanecta knowledge base. Store embeddings
at each level. Retrieval hits whichever level of abstraction best matches the query. Good when items
have very different lengths and verbosity.

---

### 12. ColBERT / late interaction

Token-level embeddings rather than one vector per document. Much more precise for long items.
`pg_colbert` exists. Higher infrastructure cost than standard pgvector.

---

## Recommended roadmap

| Phase | What | Why |
|---|---|---|
| Now | Two-pass AI filter (implemented) | Works today, no infra changes |
| Next | pgvector + auto-embed on write | Drops `org-context` tag requirement entirely |
| After | Hybrid BM25 + vector | Production-grade, best general retrieval |
| Optional | HyDE on top of hybrid | Easy multiplier, one extra LLM call |
| Later | Reranking, graph traversal, PathRAG | Precision and multi-hop reasoning |

## The pitch

With hybrid search + auto-embed: every item Richie adds to Kanecta becomes findable context for any
future pipeline run — with no tagging, no wiring, no code changes. The knowledge graph becomes a
semantic memory for the org.
