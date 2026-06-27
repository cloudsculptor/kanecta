# Haystack adapter

Haystack (by deepset) is Apache 2.0 licensed, fully open source, production-ready, and commercially unrestricted. It is one of the most mature AI pipeline frameworks, particularly strong in enterprise search, hybrid retrieval, and document processing. deepset also offers a managed cloud product (deepset Cloud) but the open-source library is complete and self-contained. Two adapter opportunities exist, mirroring the LlamaIndex adapter: ingestion and agent runtime.

See also [[llamaindex-adapter]] — the two adapters follow the same pattern and can be used interchangeably or together depending on which retrieval library the team prefers.

---

## Why Haystack over LlamaIndex (or alongside it)

Haystack and LlamaIndex overlap significantly but have different strengths:

| Concern | Haystack | LlamaIndex |
|---------|----------|------------|
| Document preprocessing and cleaning | Excellent — mature, battle-tested | Good |
| Hybrid dense + sparse retrieval | First-class, highly tunable | Supported but less central |
| Custom pipeline components | Very clean component model, well-typed | Good |
| Query strategy variety | Strong standard strategies | More exotic strategies (sub-question, recursive) |
| Self-hosted / on-premise focus | Strong — designed for regulated industries | Good, LlamaCloud is cloud-first |
| Community maturity | Older, more enterprise-focused | Broader, more startup-focused |
| Language | Python | Python + TypeScript (TS version less complete) |

For a team that needs on-premise deployment, hybrid search, or is in a regulated industry, Haystack is often the better choice. The Kanecta adapter design is identical in concept — the implementation uses Haystack components instead of LlamaIndex readers and query engines.

---

## Adapter 1 — Ingestion adapter (`kanecta-haystack-ingest`)

### What it does

Runs a Haystack document processing pipeline (fetching, preprocessing, splitting, embedding) and writes each resulting document chunk as a Kanecta item with `search.embedding` populated. Haystack's preprocessing components handle cleaning, deduplication, and chunking; the adapter translates the output into the Kanecta item model.

### Architecture

```
External source (PDF, HTML, database, ...)
        ↓
Haystack fetcher + preprocessor + document splitter
        ↓
Haystack embedder (dense) + optional sparse encoder (BM25)
        ↓
kanecta-haystack-ingest adapter
        ↓
Kanecta items (type: file or text) with search.embedding populated
```

Each ingested chunk becomes a Kanecta item:
- `item.value` = document title or chunk summary
- `item.parentId` = a collection item representing the source document or corpus
- `meta.files.body` = `body.md` sidecar with chunk text (filesystem adapter)
- `search.embedding.vector` = dense float vector from Haystack embedder
- `search.embedding.model` = embedding model identifier
- `meta.tags` = source metadata (filename, URL, page, section)
- `meta.status` = `"ingested"` to distinguish from hand-authored items

### Configuration

```json
{
  "runtime": "haystack-ingest",
  "model": null,
  "systemPrompt": null,
  "tools": [],
  "config": {
    "fetcher": "file",
    "source": "/path/to/documents",
    "splitBy": "word",
    "splitLength": 200,
    "splitOverlap": 20,
    "embeddingModel": "sentence-transformers/all-MiniLM-L6-v2",
    "sparseEncoding": false,
    "targetParentId": "<collection-item-uuid>",
    "outputType": "text",
    "deduplicateBy": "contentHash"
  }
}
```

`config.sparseEncoding: true` enables BM25 sparse vectors alongside the dense embedding — enabling true hybrid search from Kanecta's query layer. This is Haystack's strongest differentiator over LlamaIndex for retrieval quality.

### Open questions

- When `sparseEncoding: true`, where does the BM25 sparse vector live on the Kanecta item? The `search` section currently only defines a dense `embedding`. A `search.sparse` field (BM25 vector + model) should be added to the spec to support hybrid retrieval properly — this is worth a vNext spec addition independent of the Haystack adapter.
- How does re-ingestion handle updates when source documents change? ContentHash deduplication handles identical chunks but not updated chunks.
- Should Haystack's document metadata (author, created date, source URL) be mapped to `meta` fields or to a typed payload?

---

## Adapter 2 — Agent runtime adapter (`runtime: "haystack"`)

### What it does

Adds `"haystack"` as a supported `runtime` value in `agentPayload`. The runner uses a Haystack retrieval pipeline to fetch relevant context before invoking the model. Haystack handles the retrieval (including hybrid dense+sparse if configured); Kanecta handles everything after — orchestration, gates, output tracking, evals.

### Architecture

```
Pipeline phase starts
        ↓
Runner resolves runtime: "haystack"
        ↓
Haystack retrieval pipeline executes against config.indexId
(dense, sparse, or hybrid — configured on the index item)
        ↓
Retrieved documents injected into agent context preamble
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
  "runtime": "haystack",
  "model": "claude-sonnet-4-6",
  "systemPrompt": "You are a compliance analyst. Using the retrieved policy documents, identify clauses that conflict with the submitted proposal and write each conflict as a `finding` item.",
  "tools": ["kanecta_add_item", "kanecta_query"],
  "config": {
    "indexId": "<kanecta-item-uuid-describing-the-index>",
    "retriever": "hybrid",
    "topK": 10,
    "embeddingModel": "sentence-transformers/all-MiniLM-L6-v2"
  }
}
```

`config.retriever` values: `"dense"` (vector similarity only), `"sparse"` (BM25 keyword only), `"hybrid"` (reciprocal rank fusion of dense + sparse). `"hybrid"` is Haystack's strongest mode and the main reason to choose it over LlamaIndex for keyword-sensitive domains (legal, compliance, technical documentation where exact terms matter).

---

## Haystack + Kanecta: the regulated-industry case

Haystack is specifically designed for organisations that cannot send data to cloud APIs — it runs entirely on-premise with open-source embedding models (sentence-transformers) and open-source LLMs (via Ollama or vLLM). Combined with Kanecta running on-premise, this gives a fully self-hosted AI pipeline stack:

- Haystack ingests and indexes internal documents (on-premise)
- Kanecta pipeline orchestrates multi-agent workflows (on-premise)
- Kanecta stores all outputs as items (on-premise)
- No data leaves the organisation's infrastructure

This is a strong positioning story for legal, financial services, healthcare, and government — industries where cloud data processing is restricted.

---

## Relationship to the LlamaIndex adapter

The Haystack and LlamaIndex adapters are interchangeable at the `runtime` field level. A team chooses one based on preference, existing infrastructure, or specific capability needs. The Kanecta pipeline definition does not change — swap `"llamaindex"` for `"haystack"` in `agentPayload.runtime` and adjust `config` accordingly.

Both adapters compose with the ingestion adapter:

1. Run the ingestion adapter (Haystack or LlamaIndex) to bring external documents into Kanecta as items with embeddings.
2. Use the matching runtime adapter in pipeline phases to query those items with sophisticated retrieval.
3. Agents produce output items — also in Kanecta.

End result: a fully Kanecta-native knowledge graph where external documents, agent outputs, decisions, and pipeline run history all coexist and are mutually queryable.
