# Migration to spec v1.3.0

Migrates a Kanecta **filesystem** datastore from spec v1.2.0 to v1.3.0.

## What changes between 1.2.0 and 1.3.0

See `kanecta-specification/1.3.0/` (and its diff against `1.2.0/`) for the
full picture. The parts that matter for this migration:

- `metadata.json` gains a required `specVersion`, gains `dueAt`, `visibility`
  and `aspect`, and `license` becomes a required UUID reference (was an
  optional free-text string) — defaulting to the "All Rights Reserved" licence
  (`bb3bf137-d8a9-4264-9fb7-ac373b1d4739`) when not already set.
- `type.json` becomes stricter: types must be flat (no nested objects/arrays
  of objects), every `jsonSchema` property needs an `x-id`, and `sqlSchema`
  becomes required. Several system types had nested fields and have been
  reshaped (usually flattened by dropping the nested field) in their v1.3.0
  `kanecta-system-items` definitions.
- A schema validator ships at `kanecta-specification/1.3.0/kanecta-schema-validator/`
  (`@kanecta/specification/validator`) — this migration uses it throughout.

## Running it

```sh
node migrate-1.2.0-to-1.3.0.js <datastore-path> [--dry-run]
```

- `<datastore-path>` — path to the datastore root (the directory that
  *contains* `.kanecta/`, not `.kanecta/` itself).
- `--dry-run` — report what would change without writing anything.

It's safe to re-run — every step is idempotent (already-migrated
metadata/types are detected and skipped, and `reshape-queue.json` always
reflects the *current* state regardless of how many times it's been run).

### What it does automatically

1. Bumps `.kanecta/config/config.json` → `specVersion: "1.3.0"`.
2. Updates every `metadata.json` (items and type-definition records) to the
   v1.3.0 shape — adds `specVersion`, defaults `license` / `visibility` /
   `dueAt` / `aspect`.
3. Replaces every `type.json` whose ID matches a `kanecta-system-items` type
   with that canonical v1.3.0 definition — *but only if the canonical
   definition itself passes validation* (see "Blocked types" below).
4. Validates everything against the v1.3.0 schema validator and prints a
   pass/fail report.
5. Writes `reshape-queue.json` listing every `object`-type item whose stored
   data needs human/AI judgement to bring into shape (see next section).

### What it deliberately leaves for a human + AI to do together

Some of the type-shape changes between 1.2.0 and 1.3.0 **drop fields** that
held real, structured data (e.g. a Test Case's `steps`, a Procedure's
`steps`, a Pre-flight Report's `blockers`). Deciding what should happen to
that data — turn it into child items, fold it into a text field, drop it, or
give it a new standalone type — is a judgement call that belongs to the
datastore owner, not to an automated script.

The migration script identifies every item that needs this kind of attention
and writes it to `reshape-queue.json`. **Hand that file and
[reshape-data-with-ai.md](reshape-data-with-ai.md) to an AI agent and tell it
to go** — the runbook walks the agent through working with the owner to make
and apply those calls, item by item, with re-validation at the end.

### Blocked types

If a type's canonical v1.3.0 definition in `kanecta-system-items` itself fails
validation (commonly: missing `sqlSchema`, or `jsonSchema.$schema` not
draft-07), the migration **refuses to propagate it** — better to leave a
known-good v1.2.0 type definition in place than to install a broken v1.3.0
one. These are reported as "BLOCKED" in the output and queued with reason
`system-items-type-invalid`. They need a one-time fix in
`kanecta-system-items` (not a per-datastore patch); once that lands, re-running
this script picks the fix up automatically.

## Output

- Console report — pass/fail counts for every step, plus details of every
  type whose shape changed, every blocked type, and every validation failure.
- `reshape-queue.json` — written alongside the script; consumed by
  [reshape-data-with-ai.md](reshape-data-with-ai.md). Delete it once the
  reshaping phase is complete.
