---
id: 1317604f-c303-411f-b553-58a9b25ccfa6
author: richie
applies-to:
  - kanecta-mcp
  - kanecta-api
  - kanecta-filesystem
  - kanecta-app-studio
scenarios:
  - understanding Kanecta item types
  - learning MCP tool signatures and quirks
  - working with semantic relationships and symlinks
  - structuring content correctly in the hierarchy
  - backup and recovery
updated: 2026-05-28
---

# Working with Kanecta

---

## Item types and when to use them

| Type | Use for |
|---|---|
| `string` | Short single-line value — names, titles, labels |
| `number` | Numeric value |
| `text` | Multi-line prose — descriptions, notes, explanations |
| `file` | Attachment reference |
| `symlink` | Pointer to another item by UUID; renders as the target's content in its tree position |
| `heading` | Structural container, like an outline heading. Use to organise sections |
| `object` | Typed instance; requires `typeId` pointing to a type definition item |
| `decision` | Captures a decision with reasoning, alternatives, and trade-offs. Use for ADRs and design choices |
| `annotation` | A comment/note on another item without modifying it; supports threading via `parentAnnotationId` |

**In practice:** Use `heading` for structural containers (module name, section title); `text` for content (table schema items, notes); `decision` for anything where "why" matters as much as "what". A `heading` item is a container by intent; `text` items can still have children — the distinction is about intent and display, not capability.

---

## MCP tools reference

| Tool | Signature |
|---|---|
| `kanecta_add_item` | `(parentId?, type, value, tags?)` → creates an item. Omit `parentId` to create at root. |
| `kanecta_update_item` | `(id, value?, type?, tags?)` → updates value, type, or tags. Cannot change `sortOrder` via this tool. Use `parentId` to reparent. |
| `kanecta_delete_item` | `(id)` → deletes item AND all descendants. Irreversible. Always cascades. |
| `kanecta_get` | `(id)` → reads a single item with its full metadata. |
| `kanecta_get_children` | `(parentId)` → lists direct children of an item. |
| `kanecta_get_tree` | `(id, depth?)` → reads full subtree from a given root. Default depth 3. |
| `kanecta_search` | `(query)` → case-insensitive keyword search across all item values. |
| `kanecta_recent` | Lists recently modified items. Useful for orientation at session start. |
| `kanecta_capture` | `(value, tags?)` → quick-save an insight at root level without needing to navigate first. |

**Creation order matters:** Always create a parent before its children. Siblings can be created in parallel.

---

## Known limitations

- **No sort order control** — `sortOrder` is auto-assigned. Delete-and-recreate is the only way to reorder — but this destroys children too.
- **No alias setting via MCP** — Aliases are readable via `kanecta_get` but can only be set via the UI.
- **`update_item` core fields:** `value`, `type`, `tags` — cannot change `sortOrder` directly.
- **Deletion always cascades** — Deleting a parent cascades to all children. Plan accordingly before deleting.

---

## Patterns and tips

- **Create parents before children** (sequential) — a parent must exist before any of its children are created.
- **Create siblings in parallel** (independent) — independent `kanecta_add_item` calls can run in parallel.
- **To reorder:** delete and recreate items in the desired order.
- **Template copy pattern:** `kanecta_get_children` on the template, then recreate each child under the new parent.
- **Store reference IDs in skills** so they survive across sessions.
- **Use `kanecta_search` or `kanecta_recent`** to rediscover IDs if lost.
- **Move = `parentId` change.** Use `kanecta_bulk_update` with a `parentId` field to reparent items — no dedicated move tool needed. Supports bulk moves in one call.
- **Bulk create in batches of ~25 items.** Multiple `kanecta_bulk_create` calls can run in parallel for independent modules/sections.

---

## Workspace IDs

| Label | UUID |
|---|---|
| Root workspace parent | `972aac72-c025-461a-899e-ba65474bcf8a` |
| Tickets heading | `e7655c29-67e8-45fb-b5af-95d38b83520a` |
| Templates heading | `787387f3-1474-464f-8467-e95ea25a7fa6` |
| Skills heading | `0ecc3727-d3e7-4644-9690-e14aef5168c6` |
| Templates > Ticket template | `ea569cd3-ae54-47cb-b261-6e8e19268b40` |

---

## Semantic relationships

Typed semantic relationships carry meaning about how items relate. Use `kanecta_relate` to create them (not yet exposed in all MCP versions — use text references in the meantime).

| Relationship | Meaning |
|---|---|
| `relates-to` | General association |
| `depends-on` | Source requires target |
| `enables` | Source makes target possible |
| `contradicts` | Source and target conflict |
| `blocks` | Source prevents target from proceeding |
| `blocked-by` | Source cannot proceed until target is resolved |
| `prerequisite-for` | Source must complete before target |
| `derived-from` | Source originated from target |
| `supersedes` | Source replaces target |

---

## Inline links and symlinks

**Inline links:** Write `[[uuid]]` anywhere in a value field to create a navigable reference. UIs render it as a clickable link and backlinks are tracked automatically. Use instead of raw UUID text snippets.

**Symlinks:** Create an item with `type: "symlink"` and the target UUID as the value. Appears in the tree at its own position but renders as the target's content in its tree position. Use when you want an item to appear in multiple places without duplicating it.

---

## Confidence levels

Set via the `confidence` field in `kanecta_update_item`.

| Level | When to use |
|---|---|
| `experimental` | Speculative, may change significantly. For early ideas being tried out. |
| `exploring` | Actively investigating, alternatives still open. Use during design/research phase. |
| `decided` | Decision made, but could be revisited. For settled but not locked choices. |
| `locked` | Not expected to change. For stable facts, architectural constraints, completed decisions. |

---

## API quirks and gotchas

- **Deletion always cascades** to all descendants — no orphaning, no confirmation prompt via MCP. Know the subtree before deleting.
- **`sortOrder` is auto-assigned** and cannot be changed via `kanecta_update_item`. Delete-and-recreate is the only way to reorder — but this destroys children too.
- **`kanecta_update_item`** cannot reparent or reorder without `parentId`/`sortOrder`.
- **Aliases** are readable via `kanecta_get` but cannot be set via MCP — UI only.
- **`ifx_describe_table`** returns near-empty column info — not reliable for schema lookup.
- **MCP does not yet expose:** relationships API, annotations API, alias setting, tag-index queries, type-index queries.
- **`kanecta_get_tree`** can return very large payloads on deep/wide subtrees — prefer `kanecta_get_children` for targeted navigation.
- **Always call `kanecta_get_children` first** to verify child count before deleting anything described as "empty". The child count returned by the delete response is the only warning you get.
- **Session summaries can be wrong.** An item described as "empty" may have many children. Always verify current state with `kanecta_get_children` rather than trusting a summary.

---

## Backup and recovery

**Backup location:** `/home/{user}/.kanecta-backups/[timestamp]/`

File format: `data/[first 2 chars of uuid]/[next 2 chars]/[full-uuid]/metadata.json`

**To restore deleted items from backup:**
1. Walk the backup `data/` tree collecting `metadata.json` files.
2. Filter by `parentId` to find the deleted children.
3. Reparent to the appropriate new parent in the live datastore.
4. Recreate via `kanecta_bulk_create` in batches of ~25. New UUIDs are assigned but content is identical.

---

## Kanecta content structure: use hierarchy, not markdown

Kanecta stores content as a parent/child hierarchy — like an outline view in Word. Each section or heading is its own child node. The node's value is just the label/title. **Never cram structure into a single node using markdown headings (`##`), bullet lists, or similar** — that flattens the hierarchy into a string.

**Example:** A "Procedure" template with sections "Purpose" and "Steps" → create a parent node with value "Procedure", then add two child nodes "Purpose" and "Steps" respectively.

**Anti-pattern:** If you find yourself writing `## headings` or `- bullet points` inside a node value, stop — use child nodes or sibling nodes instead.

**Before saving any tree structure:** Play it back to the user as an indented outline (e.g. using spaces/dashes in plain text) and wait for confirmation before calling `kanecta_add_item`.
