---
"@kanecta/transcript-import": minor
---

New package: deterministic, idempotent importer for Claude Code session
transcripts.

Reads the JSONL session transcripts under `~/.claude/projects` and maps them to
Kanecta items — `claude-session → claude-turn → claude-tool-call` — carrying real
per-turn token usage, models, and timing. Every entity has a stable external key
(`sourceSystem: 'claude-code'`, `sourceExternalId: <kind>:<id>`), so re-running
upserts rather than duplicating and a grown transcript appends only new turns. It
correctly merges the multiple JSONL lines Claude Code writes per logical turn
(shared `uuid`, repeated `usage`) so tokens and text never double-count. Ships a
`kanecta-import-transcripts` CLI (file or directory, `--dry-run`, working-set /
datastore selection, text caps) and a library API (`parseTranscript`,
`importTranscriptFile`, `importSession`).
