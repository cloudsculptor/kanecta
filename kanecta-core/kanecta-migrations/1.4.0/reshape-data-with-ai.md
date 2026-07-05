# Reshaping flagged data after the 1.3.0 → 1.4.0 migration

This is a runbook for an AI agent (e.g. Claude Code) to follow, **together with
the datastore owner**, after `migrate-1.3.0-to-1.4.0.js` has written a
`reshape-queue.json`.

Don't run it unattended. Everything in the queue is a judgement call about the
*owner's* data — your job is the legwork (read the entries, explain them, draft
the change), theirs is the decision.

## Scope

Unlike the 1.2.0 → 1.3.0 reshape (which handled nested-field flattening), the
1.3.0 → 1.4.0 migration is mostly mechanical: files merge into `item.json` and
relationships become items with no data loss. The script therefore queues
**one** kind of entry today:

- `reason: "custom-relationship-type"` — an outbound relationship whose `type`
  is not one of the built-in relationship types (`BUILT_IN_REL_TYPES`). Fields:
  `sourceId`, `targetId`, `relType`, `note`.

The relationship item is still migrated correctly — `relationshipType` is a
free-form string, so nothing is lost. The queue entry is a **review prompt**,
not a failure: custom types are allowed, but the owner should confirm each one
is intended (and not, say, a typo or an old name for a built-in).

If a future version of the migration script adds more `reason` codes, extend
this runbook to cover them rather than guessing.

## Steps

**1. Group by `relType`, not by entry.** You'll make the same decision for
every relationship sharing a type (e.g. "all `resolves` edges are fine"). Decide
once per type, then apply.

**2. For each distinct `relType`, present it to the owner:**
- The type slug, how many edges use it, and a couple of concrete
  `sourceId → targetId` examples so the conversation is grounded.
- The options:
  1. **Keep as-is** — it's an intentional custom relationship type. Nothing to
     do; `relationshipType` already carries it. This is the common case.
  2. **Remap** — it's a variant/typo of a built-in (or another custom type).
     Rewrite the affected relationship items' `payload.relationshipType` to the
     canonical slug.
  3. **Register** — if the owner wants it to be a first-class, validated
     relationship type, note it for addition to the type system (a separate
     change, not a per-datastore patch).

Don't pick for them — lay out the options for *this* type and ask.

**3. Apply the decision.** For "keep", nothing changes. For "remap", edit each
affected relationship item's `item.json` (or use the MCP tools once the
datastore is open) to set the corrected `payload.relationshipType`. Re-run the
migration afterwards if you changed source data — it's idempotent.

**4. Final check.** Re-run `migrate-1.3.0-to-1.4.0.js --dry-run`. The queue
should now contain only the custom types the owner has explicitly chosen to
keep. Make sure they know which ones remain and why. Delete
`reshape-queue.json` once every entry is actioned or deferred with their
sign-off.
