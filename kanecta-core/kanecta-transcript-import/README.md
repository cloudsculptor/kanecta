# @kanecta/transcript-import

Deterministic, idempotent importer for **Claude Code session transcripts** into a
Kanecta datastore.

Every Claude Code session is a JSONL file under
`~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` — one event per line
(user turn, assistant turn with tool calls, tool result, system event), each
stamped with `timestamp`, `sessionId`, `uuid`, and — on assistant turns — a real
`message.usage` (input / output / cache tokens) and `model`. This is the
ground-truth record of all agent work; ingesting it gives Kanecta a queryable
history of every session and exact per-step token + time accounting.

The import is **automated and deterministic** — no human authoring, no review,
no branch/PR cycle. It is safe to re-run: it upserts, never duplicates.

## Item model — typed objects

Every entity is a **typed object** (`type: 'object'` with a `typeId`) whose
payload is a flat, schema-defined shape. The same model stores identically on both
backends — Postgres as columns in an `obj_<typeId>` table, the filesystem adapter
as inline JSON. The four types are seeded idempotently on import (see
[`src/types.js`](src/types.js)).

```
claude-session          (child of root)          key: session:<sessionId>
  └─ claude-turn         (child of session)       key: turn:<uuid>
       └─ claude-tool-call  (child of turn)        key: tool:<toolUseId>
            └─ property     (a tool argument)      key: tool:<toolUseId>:param:<name>
```

- **claude-session** columns: `session_id`, `cwd`, `git_branch`, `version`,
  `started_at`, `ended_at`, `turn_count`, `tool_call_count`, and the summed
  `tokens_input/output/cache_creation/cache_read`. (The set of models used is not
  stored separately — it is derivable from each turn's `model` column.)
- **claude-turn** columns: `kind`, `timestamp`, `model`, `usage_*`, `parent_uuid`,
  `is_sidechain`, `agent_id`, `text` (full, never truncated), `text_length`.
- **claude-tool-call** columns: `name`, `tool_use_id`, `is_error`, `result` (full).
- **property** — the core key-value type (`item.value` = the key, payload `value` =
  the value). A tool call's variable argument map decomposes into child `property`
  items, because a flat SQL row can't hold a per-tool-varying map and the canonical
  schema (portable ANSI SQL) has no JSON column. `property` is a Kanecta *core*
  built-in; the importer seeds it (with the canonical id) only until the
  bootstrapper does.

Text is stored in full and never offloaded (large text is a `TEXT`/`CLOB` column;
S3 is only for actual files). Postgres returns `BIGINT` columns (the token totals)
as strings — `Number()` them if you need arithmetic.

## Idempotency

Each item carries an external key — `sourceSystem = 'claude-code'`,
`sourceExternalId = <kind>:<id>` — and every write is
`bySource() ? update() : create()` (the adapter primitives added in
`@kanecta/sqlite-fs`). Re-importing the same transcript updates in place;
re-importing a **grown** transcript appends only the new turns.

Claude Code splits one logical turn across several lines that share a `uuid` and
repeat the same `usage`; the parser merges these by `uuid` and counts `usage`
exactly once, so tokens and text never double-count.

## CLI

```sh
# Import every transcript into the active working set's datastore
kanecta-import-transcripts

# A single file or a specific directory
kanecta-import-transcripts ~/.claude/projects/-home-me-proj/<session>.jsonl

# Target selection (same resolution as the Kanecta CLI)
kanecta-import-transcripts --working-set my-set --branch main
kanecta-import-transcripts --datastore /path/to/.kanecta

# Parse and report only; write nothing
kanecta-import-transcripts --dry-run
```

Default path is `~/.claude/projects` (scanned recursively for `*.jsonl`).

## Library

```js
const { Datastore } = require('@kanecta/lib');
const { importTranscriptFile, parseTranscript } = require('@kanecta/transcript-import');

const ds = Datastore.open('/path/to/.kanecta');
const stats = await importTranscriptFile(ds, '/path/to/session.jsonl');
// [{ sessionId, created, updated, turns, toolCalls, properties }]

// Or parse without importing (pure, no datastore):
const sessions = parseTranscript(fs.readFileSync(file, 'utf8'));
```
