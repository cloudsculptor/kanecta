---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
author: claude
reviewed-by: richie
applies-to:
  - kanecta-mcp
  - kanecta-api
  - kanecta-filesystem
scenarios:
  - converting a plain text item to a typed object in place
  - bulk-converting freeform epics, tickets, or other items to a structured type
updated: 2026-05-28
---

# Convert a freeform item to a typed object

---

## Overview

A freeform (plain `text`) item can be converted to a typed object in place using `kanecta_update_item`. This rewrites the item's `type`, `typeId`, and `objectData` without changing its position in the tree or its UUID. Old real child nodes (e.g. hand-crafted "Epic link", "Epic details", "Acceptance Criteria" nodes) must be deleted after conversion — they become redundant once the data lives in `objectData`.

---

## Inputs

| Input | Description |
|---|---|
| `itemId` | UUID of the freeform item to convert |
| `typeId` | UUID of the target type template |

---

## Steps

**1. Fetch the item, its children, and the type schema in parallel**

```
kanecta_get(itemId)
kanecta_get_children(itemId)
kanecta_get_type_schema(typeId)
```

**2. Infer field values from the freeform content**

- Strip any type-name prefix from the display value (e.g. `"Epic: View Certifications page"` → `"View Certifications page"`)
- Map the stripped value to the type's `title` field (or equivalent primary field)
- For required fields with no source data (e.g. `status`, `priority`), apply sensible defaults — confirm with the user if defaults are non-obvious

**3. Play back the proposal before executing**

Show the user:
- The `value`, `type`, `typeId`, and `objectData` you will write
- The UUIDs of all real children that will be deleted

Wait for explicit confirmation.

**4. Execute conversions and deletes in parallel**

```
kanecta_update_item({
  id: itemId,
  type: "object",
  typeId: typeId,
  value: "<stripped display label>",
  objectData: { <required and known fields> }
})

kanecta_delete_item(childId1)
kanecta_delete_item(childId2)
...
```

**5. Verify**

Check the response has `typeId` set (not `null`). If `typeId` is null, the MCP schema change may not have been picked up — restart the MCP process: `pkill -f 'kanecta-mcp/src/index.js'`

---

## Bulk conversions

When converting multiple items of the same type in one session, fetch all items and their children in a single parallel batch (step 1), then play back all proposals together before executing.

---

## Gotchas

- **Cascade deletes on child nodes:** Child nodes like "Acceptance Criteria" may themselves have descendants. The delete response lists all deleted IDs — flag to the user if the count is unexpectedly large.
- **Required fields need defaults:** The type schema lists required fields. If the source item has no data for them, default sensibly (e.g. `status: "Backlog"`, `priority: "Medium"` for an Epic) and surface the defaults in the playback so the user can override.
- **Prefix stripping:** Freeform items often prefix the type name into the value (e.g. `"Epic: ..."`, `"Ticket: ..."`). Always strip this when setting `value` and `title`.
- **typeId must be passed explicitly:** The MCP `kanecta_update_item` tool requires `typeId` as an explicit parameter alongside `type: "object"`. Omitting it leaves `typeId: null` on disk even though `object.json` is written.

---

## Reference IDs

| Thing | UUID / Path |
|---|---|
| Skills section | `0ecc3727-d3e7-4644-9690-e14aef5168c6` |
| This skill | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| Related skill | `659b5ace-083f-4676-b317-b82dc15374e3` (work-with-typed-objects-and-synthetic-trees) |
| Epic type | `fd34abea-f8c4-466f-b31d-07b7fc9ced9c` |
