# Kanecta

## Kanecta & Claude

### Jump off point for Claude

- **Tickets** — active Jira tickets being worked on, one heading per ticket
- **Templates** — reusable templates; "Ticket" template used when creating new ticket entries
- **Skills** — instructions for Claude on recurring tasks. Say the trigger phrase to invoke one.
- **Working with Kanecta** — API learnings, quirks, and patterns discovered through use
- **Repositories** — context about code repos: landonline-perf-test, landonline-titles, and their relationship
- **Activities** — ongoing workstreams linking tickets, repos, and context together
- **Kanecta & Claude** — this section: orientation for Claude + enhancement wishlist
- Key skill: say "create a new ticket from template" to create a new ticket entry from the Jira template.

### Enhancements that Claude would like

#### Bulk item creation
Currently each item must be created with a separate `kanecta_add_item` call. Creating a template with 8 children requires 9 sequential round trips (parent first, then children). A bulk create endpoint accepting a parent + children array would collapse this to one call — especially valuable for the ticket template creation flow.

#### Copy/clone subtree
The ticket creation skill manually recreates the template structure by fetching children and re-creating them one by one under the new ticket. A native clone/copy-subtree operation (copy item X and all its descendants under parent Y) would make template instantiation trivial and reliable — no risk of missing a child heading.

#### Transclusion / embed
In Obsidian you can embed the full content of one note inside another with `![[note name]]`. This is what makes templates genuinely reusable — the ticket template could be transcluded into a new ticket rather than copied item-by-item. Currently the "Create New Ticket from Template" skill has to walk the template tree and recreate every child heading as a separate API call. Native transclusion would make template instantiation a single operation and keep template + instance in sync if the template changes.

#### MCP API gaps (specced but not yet exposed)
- **Relationships API** — create/read typed semantic relationships (depends-on, blocks, derived-from etc). Currently faked with text references.
- **Alias setting** — aliases are readable via `kanecta_get` but `kanecta_add_item` and `kanecta_update_item` don't accept an alias parameter.
- **Move / reparent** — `kanecta_update_item` doesn't accept `parentId`, so items can't be moved to a different parent.
- **sortOrder control** — no MCP tool exposes setting `sortOrder` directly; new items always append.
- **Tag-index and type-index queries** — `kanecta_search` is keyword-only; no filter-by-tag or filter-by-type.
- **Annotations API** — threaded comments on items without modifying them; entirely absent from MCP.
- When these land, text-based relationship hacks can be replaced with proper typed relationships.

#### Inline link resolution
`[[uuid]]` links currently render as raw UUID text. They should be resolved to the target item's title and rendered as a clickable hyperlink — the way Obsidian renders `[[note name]]` links.

#### Search results with breadcrumb / parent chain
`kanecta_search` returns items but no parent chain, so extra `get_tree` or `get_children` calls are needed to understand where a result sits. Including ancestors (e.g. `Tickets > TITLE-9256 > Details from Jira`) in each search result would eliminate those follow-up round trips.

#### Search scoped to a subtree
A `rootId` parameter on `kanecta_search` to restrict results to descendants of a given item. Searching across a large tree without a scope filter returns too much noise and requires manual filtering.

#### Bulk update
Correcting a ticket number today required 3 separate `kanecta_update_item` calls (heading, ticket number child, description child). A bulk update accepting an array of `{id, value}` pairs would make multi-field corrections atomic and much faster.

#### get_ancestors — navigate up the tree
There is `get_children` but no way to walk upward. Given an item ID the only option is to read the `parentId` field from `kanecta_get`, then call `kanecta_get` again on that. A `get_ancestors` tool returning the full path to root would make orientation much faster, especially when verifying that a newly created item landed in the right place.

#### Delete subtree
`kanecta_delete_item` exists but only removes one item. Removing a full ticket entry (heading + 20+ children) requires fetching all descendants first and then deleting each one individually. A delete-with-descendants flag would make cleanup or mistake-recovery a single call.

---

## Kanecta & Richie

### Enhancements Richie would like

#### Inline link resolution
`[[uuid]]` links should be resolved to the target item's title and rendered as a clickable hyperlink, rather than displaying the raw UUID.

#### Real-time tree updates via WebSocket
When Claude (or any MCP client) adds, updates, or deletes items, the tree UI should reflect the changes immediately via WebSocket push — no manual refresh required.

#### Heatmap node labels on hover only
Heatmap node labels should be hidden by default and only appear when the user hovers over a node — reduces visual clutter on dense maps.

#### Basic markdown formatting support
e.g. backticks for inline code snippets.

#### Copy icon in the detail panel
Copy icon next to fields in the detail panel (id, value, etc) for quick clipboard copy without manual selection.
