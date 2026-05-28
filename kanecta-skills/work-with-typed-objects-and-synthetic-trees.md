---
id: 659b5ace-083f-4676-b317-b82dc15374e3
author: claude
reviewed-by: richie
applies-to:
  - kanecta-filesystem
  - kanecta-api
  - kanecta-app-studio
  - kanecta-mcp
scenarios:
  - creating a typed object via the MCP
  - understanding how synthetic child nodes are generated at read time
  - adding a new type icon to the Studio registry
  - updating fields on an existing typed object
updated: 2026-05-27
---

# Work with typed objects and synthetic trees

---

## Overview

Kanecta supports typed objects: items that conform to a JSON schema defined by a type template. When a typed item is stored, its field values are kept in `object.json` alongside `meta.json` (which carries the type icon). At read time the API generates synthetic child nodes from those fields — no extra real items are stored.

---

## Inputs

| Input | Description |
|---|---|
| `typeId` | UUID of the type template to use |
| `parentId` | Where to place the new item in the tree |
| `objectData` | Object matching the type's JSON schema (field values) |
| `value` | Display label for the item (usually the title or name field) |

---

## Steps

**1. Find the type UUID**

Use `kanecta_list_types` or look up the type by name. Each type lives at:

```
~/.kanecta/types/{s1}/{s2}/{uuid}/
  metadata.json   ← id, value, owner, etc.
  type.json       ← { meta: { icon, description }, jsonSchema }
```

**2. Inspect the schema**

Call `kanecta_get_type_schema` with the `typeId` to see required fields and their types before constructing `objectData`.

**3. Create the item**

Call `kanecta_add_item` with:

```json
{
  "type": "object",
  "typeId": "<uuid>",
  "value": "<display label>",
  "parentId": "<location uuid>",
  "objectData": { "<field>": "<value>", ... }
}
```

**4. What the API writes on disk**

Two files alongside `metadata.json` in `~/.kanecta/data/{s1}/{s2}/{uuid}/`:

- `meta.json` — copy of the type's `metadata.json` with `type: "object"` and `icon` copied from `type.json`
- `object.json` — the raw field values from `objectData`

**5. How synthetic children appear in the Studio UI**

- The item itself shows the type icon (read from `meta.json` → `icon`, resolved via `DynamicIcon` + `TYPE_ICON_REGISTRY`)
- Its children are generated at read-time from `object.json` — not stored on disk
- Each field becomes a title-cased label node (e.g. `issueType` → "Issue Type")
- Scalar/array field values become a single child leaf beneath the label node
- Synthetic nodes render with a cyan bullet (text-type icon) to distinguish them from real nodes

**6. Synthetic ID format**

```
{realUUID}__{fieldPath}       ← field-name node
{realUUID}__{fieldPath}.__    ← terminal value leaf
```

These IDs are ephemeral — never store or reference them across sessions.

**7. Updating fields on an existing typed object**

Call `kanecta_update_item` with the item UUID and updated `objectData`. The API overwrites `object.json`; synthetic children refresh automatically on the next read.

> **Converting a freeform item to a typed object?** See the dedicated skill: `convert-freeform-item-to-typed-object.md`

---

## Gotchas

- **Stale MCP process:** The MCP server is spawned per-session. After any code change to `kanecta-filesystem` or `kanecta-api`, kill stale processes: `pkill -f 'kanecta-mcp/src/index.js'`
- **New type icon:** If a type's `type.json` uses an icon name not already in `TYPE_ICON_REGISTRY` (`kanecta-apps/kanecta-app-studio/src/lib/typeIconRegistry.ts`), add it — Vite cannot do runtime dynamic bare-specifier imports from `@mui/icons-material`
- **Missing icon on old items:** Items created before `icon` was wired into `create()` have no icon in `meta.json`. Fix manually: read `type.json` for the icon value, then add `"icon": "<value>"` to the item's `meta.json`
- **TanStack Query cache:** After API data structure changes, hard-refresh the browser (Ctrl+Shift+R) to bust the cache
- **`node --watch` and symlinks:** The API's watch mode may not detect changes through workspace symlinks. Run `touch kanecta-api/src/server.js` to trigger a restart

---

## Reference IDs

| Thing | UUID / Path |
|---|---|
| Skills section | `0ecc3727-d3e7-4644-9690-e14aef5168c6` |
| This skill | `659b5ace-083f-4676-b317-b82dc15374e3` |
| Ticket type | `0e2e5a75-de82-4538-a0db-ec9b4e807b7c` |
| Example typed item (Ticket) | `4bf485b6-44a6-48c3-8c10-a4074932601b` |
| Adapter (synthetic tree logic) | `kanecta-filesystem/src/adapter.js` |
| Type icon registry | `kanecta-apps/kanecta-app-studio/src/lib/typeIconRegistry.ts` |
| MCP server (objectData support) | `kanecta-mcp/src/index.js` |
