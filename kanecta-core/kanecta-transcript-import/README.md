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

## Item model

Everything is an item; structured data lives on each item's object payload.

```
claude-session          (child of root)          key: session:<sessionId>
  └─ claude-turn         (child of session)       key: turn:<uuid>
       └─ claude-tool-call  (child of turn)        key: tool:<toolUseId>
```

- **session** payload: `cwd`, `gitBranch`, `version`, `startedAt`, `endedAt`,
  `models`, summed `tokens`, `turnCount`, `toolCallCount`.
- **turn** payload: `kind` (`user`/`assistant`), `timestamp`, `model`, `usage`,
  `parentUuid`, `isSidechain`, `agentId`, `text` (capped), `textLength`.
- **tool-call** payload: `name`, `input`, `result` (capped), `isError`.

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

# Caps for stored text / tool-result bodies (0 = unlimited)
kanecta-import-transcripts --max-text-chars 0 --max-result-chars 0
```

Default path is `~/.claude/projects` (scanned recursively for `*.jsonl`).

## Library

```js
const { Datastore } = require('@kanecta/lib');
const { importTranscriptFile, parseTranscript } = require('@kanecta/transcript-import');

const ds = Datastore.open('/path/to/.kanecta');
const stats = await importTranscriptFile(ds, '/path/to/session.jsonl');
// [{ sessionId, created, updated, turns, toolCalls }]

// Or parse without importing (pure, no datastore):
const sessions = parseTranscript(fs.readFileSync(file, 'utf8'));
```
