---
"@kanecta/transcript-import": minor
---

Switch the transcript importer to store typed objects (portable to Postgres).

Transcript entities are now `type:'object'` items with flat, schema-defined
payloads instead of plain-typed items with inline JSON — so the same import
produces the same model on both the filesystem adapter (inline JSON) and Postgres
(columns in `obj_<typeId>` tables). Four types are seeded idempotently on import
(`claude-session`, `claude-turn`, `claude-tool-call`, and the reusable key-value
`property` type). A tool call's variable argument map and a session's model list
decompose into child `property` items, because a flat portable-SQL row can't hold
a per-tool-varying map (the canonical schema targets any ANSI SQL DB — no JSON
column). Text is stored in full (truncation removed; the `--max-*-chars` flags are
gone). Verified end-to-end on the filesystem and against live Postgres, with real
transcripts producing identical item counts on both backends.
