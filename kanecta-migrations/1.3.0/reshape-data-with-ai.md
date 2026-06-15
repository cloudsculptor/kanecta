# Reshaping orphaned data after the 1.2.0 → 1.3.0 migration

This is a runbook for an AI agent (e.g. Claude Code) to follow, **together with
the datastore owner**, after `migrate-1.2.0-to-1.3.0.js` has been run.

Don't run this unattended. The whole point of this phase is that reshaping old
nested data into the new flat-type model requires judgement calls — what to
keep, how to model it, whether to convert it into child items or fold it into
text — and those are the *owner's* calls to make about *their* data. Your job
is to do the legwork (read the data, explain the options, draft the changes)
and let them decide.

## Why this phase exists

Spec v1.3.0 made Kanecta types strictly flat — no nested objects, no arrays of
objects (see `kanecta-specification/1.3.0/specification.md` and
`type.json`'s description of `jsonSchema`). Several system types that existed
in v1.2.0 had nested structure (e.g. Test Case `steps: [{action,
expectedResult}]`, Procedure `steps: [{title, instructions}]`, Pre-flight
Report `blockers: [{category, description, severity}]`) and have been
flattened in their v1.3.0 system-items definitions — usually by **dropping**
the nested field outright, since modelling it properly means introducing a new
standalone type.

`migrate-1.2.0-to-1.3.0.js` already swapped the type definitions over (where
it safely could). What it could *not* do is decide what should happen to the
data that lived in those now-gone fields — that's this phase.

## Inputs

- `reshape-queue.json` — written by the migration script next to it. Each
  entry is one `object`-type item whose stored data needs attention:
  - `reason: "orphaned-fields"` — the item's data has keys that no longer
    exist on its (now-migrated) type. `orphanedFields` shows the orphaned
    key/value pairs; `newProperties` lists any properties the new type gained.
  - `reason: "system-items-type-invalid"` — the type's *canonical* v1.3.0
    definition in `kanecta-system-items` itself fails schema validation (see
    "Blocked types" below). The migration script left the datastore's old
    type.json untouched, so nothing needs reshaping yet — but flag this to
    the owner, since the type can't be fully migrated until it's fixed
    upstream in `kanecta-system-items`.
  - `reason: "custom-type-not-in-system-items"` — a type the owner created
    themselves, with no kanecta-system-items counterpart. The migration script
    can't auto-replace it; the owner needs to decide whether/how to update its
    shape to v1.3.0 (flat, x-id'd, sqlSchema'd) themselves.

## Steps

**1. Group the queue by type, not by item**

Open `reshape-queue.json` and group entries by `typeId`/`typeName`. You'll
typically be making the *same* decision for every instance of a type (e.g.
"all Test Cases lose their `steps`") — decide once per type, then apply.

**2. For `orphaned-fields` entries: present the options to the owner**

For each affected type, show the owner:
- The orphaned field(s), what kind of data they hold (read a couple of real
  instances from `objectData` so the conversation is concrete, not abstract).
- How many items are affected.
- The realistic options, typically:
  1. **Convert to child items** — e.g. each `steps[i]` becomes a child `task`
     or `note` item under the parent, in tree order. Best when the nested
     entries are independently meaningful (a runbook step someone might want
     to link to, comment on, or complete).
  2. **Fold into a text/markdown field** — render the array as Markdown and
     append it to an existing free-text property (e.g. `description`,
     `instructions`, `purpose`) if the new type has one. Best when the data is
     read-only reference material and the structure isn't load-bearing.
  3. **Drop it** — if the data is genuinely redundant or stale. Always show
     the owner what would be lost before recommending this.
  4. **Model a new standalone type** — if the nested concept is reusable and
     important enough to deserve its own type (e.g. "Test Step" as a
     first-class type with its own items). This is the heaviest option — only
     suggest it when the data clearly warrants a long-term home, and note that
     it means proposing a new type in `kanecta-system-items` too.

**Kanecta recommended approach:** if the orphaned field is an **array of objects**
(each entry has more than one field), the answer is option 4 + option 1 — create a
new standalone type for the concept and convert each array entry to a real child item
under the parent. This is the pattern that fits the v1.3.0 flat-type model best, and
it is almost always the right call. Arrays of **primitives** (plain strings, UUIDs) can
be folded into a text field (option 2) or dropped (option 3) — they do not need their
own type.

Don't pick for them — lay out the trade-offs for *this* type's data and ask. But if the
data is a complex array, lead with the recommended approach.

**3. Apply the chosen reshape**

Once the owner decides, for each affected item:
- Read the current item, its data, and (if converting to child items) check
  existing children with `kanecta_get_children` so new items are placed
  sensibly (sortOrder, position).
- Make the change with the MCP tools (`kanecta_update_item` to rewrite
  `objectData` minus the orphaned keys — and to fold content into a kept
  field if that's the chosen approach; `kanecta_add_item` for new child
  items).
- Re-validate: `validateItem(newObjectData, typeJson)` from
  `@kanecta/specification/validator` (the same v1.3.0 validator the migration
  script used) should report `valid: true` with no leftover orphaned keys.

**4. Blocked types (`system-items-type-invalid`)**

Don't attempt to reshape these — there's nothing to reshape yet, since the
migration script left the type definition at v1.2.0. Instead:
- Collect the distinct blocked `typeId`s and the validation errors the
  migration script printed for each (typically a missing `sqlSchema` or a
  `jsonSchema.$schema` that isn't draft-07).
- Tell the owner these types can't be fully migrated until their canonical
  definitions in `kanecta-system-items/items/<shard>/<id>/type.json` are
  fixed — that's a separate, one-time fix to the monorepo (not something to
  patch per-datastore), and once it lands, re-running
  `migrate-1.2.0-to-1.3.0.js` will pick it up automatically (it's idempotent).

**5. Custom types (`custom-type-not-in-system-items`)**

These belong to the owner, not to `kanecta-system-items`. Show them the
current (v1.2.0) shape, explain what v1.3.0 requires (flat properties only,
`x-id` on every property, required `sqlSchema`, draft-07 `$schema` — see
`kanecta-specification/1.3.0/file-specs/type.json` and the validator's rules),
and help them redraft it — including reshaping any existing instance data to
match, following the same options as step 2.

**5b. Watch for stale `required` entries in system types**

After stripping an orphaned field from item data, if the migration script still reports
`[required] <field>: Required field is missing or null` for that item, the field was
removed from `properties` but left in `required` — a bug in the system-items type
definition. The JSON Schema spec allows this (it doesn't enforce that `required` entries
exist in `properties`), so the type itself passes validation while every item that
correctly dropped the field fails. The fix is in `kanecta-system-items`, not the data:
remove the stale entry from `required` and re-run the migration script (it will
propagate the corrected type to the datastore automatically).

**6. Final check**

Re-run `migrate-1.2.0-to-1.3.0.js` once more. A clean final run should report:
- `0` items needing reshape that the owner has chosen to address (blocked /
  custom-type entries may legitimately remain until their upstream fixes land
  — make sure the owner knows which ones, and why).
- `0` invalid metadata / object items (other than any pre-existing validator
  gaps you've already discussed with the owner, e.g. root item types like
  `data_root` not yet being in the validator's `ALL_ITEM_TYPES` list — that's
  a spec/validator issue, not a datastore issue, and shouldn't block the
  owner's migration).

Delete `reshape-queue.json` once everything in it has been actioned or
explicitly deferred with the owner's sign-off — it's a working artefact, not
something to keep around.
