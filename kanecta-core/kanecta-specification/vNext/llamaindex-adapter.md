# LlamaIndex adapter

LlamaIndex is MIT-licensed, open source, production-ready, and widely used in commercial products. The core library is free with no usage restrictions. It is the leading data framework for connecting LLMs to external data sources — PDFs, databases, APIs, web pages, and more. Two distinct adapter opportunities exist: an ingestion adapter that brings external data into Kanecta, and an agent runtime adapter that uses LlamaIndex's query engine as the retrieval layer inside a Kanecta pipeline phase.

---

## Adapter 1 — Ingestion adapter (`kanecta-llamaindex-ingest`)

### What it does

LlamaIndex has 100+ data loaders (called readers) covering PDF, Word, Notion, Confluence, databases, S3, web pages, GitHub, and many more. The ingestion adapter runs a LlamaIndex ingestion pipeline and writes each resulting chunk or document as a Kanecta item — populating `search.embedding` from LlamaIndex's embedding step so the item is immediately queryable via Kanecta's semantic search.

### Why this matters

Kanecta currently requires data to be written as items directly. For data that lives outside Kanecta — a corpus of PDFs, a Confluence space, a database table — there is no standard ingestion path. LlamaIndex solves this with a mature, well-tested pipeline that handles parsing (including complex formats like tables in PDFs), chunking, deduplication, and embedding. The adapter treats LlamaIndex as the ingestion engine and Kanecta as the store.

### Architecture

```
External source (PDF, DB, API, ...)
        ↓
LlamaIndex reader + parser
        ↓
LlamaIndex chunking + embedding
        ↓
kanecta-llamaindex-ingest adapter
        ↓
Kanecta items (type: file or text) with search.embedding populated
```

Each ingested chunk becomes a Kanecta `file` or `text` item:
- `item.value` = document title or chunk summary
- `item.parentId` = a collection item representing the source (e.g. a `"source"` type item for the PDF or database)
- `meta.files.body` = `body.md` sidecar containing the chunk text (for filesystem adapter)
- `search.embedding.vector` = the float vector from LlamaIndex's embedding step
- `search.embedding.model` = the embedding model identifier
- `meta.tags` = source metadata (filename, page number, section, URL)

### Configuration

The adapter is configured via a Kanecta `agent` item with `runtime: "llamaindex-ingest"`:

```json
{
  "runtime": "llamaindex-ingest",
  "model": null,
  "systemPrompt": null,
  "tools": [],
  "config": {
    "reader": "pdf",
    "source": "/path/to/documents",
    "chunkSize": 512,
    "chunkOverlap": 64,
    "embeddingModel": "text-embedding-3-small",
    "targetParentId": "<collection-item-uuid>",
    "outputType": "text",
    "deduplicateBy": "contentHash"
  }
}
```

### Open questions

- Should ingested items be marked `meta.layer = "ingested"` to distinguish them from hand-authored items?
- How does re-ingestion (when the source changes) handle deduplication? ContentHash on the chunk text is the natural key.
- Should the adapter write a `relationship` item linking each chunk back to a root document item, so the full document is reconstructable from its parts?
- LlamaCloud offers better parsing for complex documents (tables, figures) — should the adapter optionally route through LlamaCloud rather than local parsing?

---

## Adapter 2 — Agent runtime adapter (`runtime: "llamaindex"`)

### What it does

Adds `"llamaindex"` as a supported `runtime` value in `agentPayload`. Instead of the runner invoking a model directly, it uses a LlamaIndex query engine to perform sophisticated retrieval against a configured index, then passes the retrieved context to a standard model invocation. The agent produces Kanecta items as usual.

### Why this matters

Kanecta's `inputQuery` is a structured item lookup — good for deterministic retrieval ("give me all findings for this screen") but not designed for complex reasoning-over-documents tasks. LlamaIndex query strategies go much further:

- **Sub-question decomposition** — breaks a complex question into targeted sub-questions, answers each against the index, synthesises the results
- **Recursive retrieval** — queries a summary index first, drills into relevant chunks only
- **Multi-hop reasoning** — follows chains of references across documents
- **RouterQueryEngine** — routes different query types to different index strategies automatically
- **HyperQueryEngine** — parallel queries across multiple indexes

These strategies surface much richer context for the agent before it starts. Kanecta handles everything after: orchestration, gates, forEach fan-out, output tracking, evals.

### Architecture

```
Pipeline phase starts
        ↓
Runner resolves runtime: "llamaindex"
        ↓
LlamaIndex QueryEngine executes against config.indexId
(sub-question decomposition / recursive / multi-hop / etc.)
        ↓
Retrieved context injected into agent context preamble
        ↓
Model invocation (using agent.model)
        ↓
Agent writes Kanecta items via kanecta_add_item
        ↓
itemsProduced tracked on pipeline-run as normal
```

### Configuration

```json
{
  "runtime": "llamaindex",
  "model": "claude-sonnet-4-6",
  "systemPrompt": "You are a research analyst. Using the retrieved context, identify key risks and write each as a `finding` item.",
  "tools": ["kanecta_add_item", "kanecta_query"],
  "config": {
    "indexId": "<kanecta-item-uuid-describing-the-index>",
    "queryStrategy": "sub-question",
    "topK": 8,
    "embeddingModel": "text-embedding-3-small"
  }
}
```

`config.indexId` points to a Kanecta item (e.g. a `"source"` or `"context"` type item) that describes the LlamaIndex index — its location, index type, and embedding model. This keeps the index configuration as a Kanecta item: versioned, queryable, and inspectable.

`config.queryStrategy` values: `"default"` (standard vector + keyword), `"sub-question"`, `"recursive"`, `"router"`. Each maps to a LlamaIndex query engine class.

### Why each does what it does best

| Concern | Who handles it |
|---------|----------------|
| Retrieval quality and depth | LlamaIndex |
| Orchestration and DAG | Kanecta pipeline |
| Human gates and approval | Kanecta confidenceGate / pauseAfter |
| Output tracking | Kanecta pipeline-run itemsProduced |
| Quality assertions | Kanecta eval / llm-judge |
| Run history queryability | Kanecta pipeline-run items |

### Open questions

- Where does the LlamaIndex index live? Options: local filesystem (same machine as Kanecta adapter), LlamaCloud (managed), or an external vector store (Pinecone, Weaviate, pgvector). The adapter should be storage-agnostic via LlamaIndex's existing storage abstraction.
- Should the query results themselves be written as Kanecta items (a `retrieval-result` type), so the retrieval step is auditable? Or is injection into context preamble sufficient?
- If Kanecta items already have `search.embedding` populated (from the ingestion adapter), can the LlamaIndex runtime query the Kanecta datastore's own vector index rather than an external one? This would make the ingestion adapter and the runtime adapter a complete pipeline: ingest external data as Kanecta items → query them via LlamaIndex strategies.

---

## Relationship between the two adapters

The ingestion adapter and the runtime adapter compose naturally:

1. Run the ingestion adapter to bring external documents into Kanecta as items with embeddings.
2. Use `runtime: "llamaindex"` in a pipeline phase with `config.indexId` pointing at the Kanecta collection containing those items.
3. LlamaIndex queries the Kanecta-hosted embeddings using its sophisticated strategies.
4. The agent produces findings, decisions, or other output items — also in Kanecta.

End result: external documents ingested → reasoned over → outputs produced — all in one Kanecta datastore, all queryable, all tracked in pipeline-run items, all testable via evals. LlamaIndex provides the retrieval depth; Kanecta provides the knowledge graph, the orchestration, and the audit trail.
