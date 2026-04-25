# Roadmap

## Phase 1 — Foundation
Core data model and filesystem layout. Items can be created, read, updated, and deleted. The CLI can export a datastore as plain text.

- UUID-sharded filesystem storage
- `metadata.json` schema (id, parent_id, value, type, owner, sort_order)
- Basic item types: string, number, text, file, object, symlink
- Alias and type index caches
- CLI tree export

## Phase 2 — API
HTTP API that exposes the datastore over the network, enabling other clients to read items and trees without touching the filesystem directly.

- `GET /items/:id` — single item metadata
- `GET /items/:id?levels=N` — item with nested descendants
- UUID validation and structured error responses
- Configurable datastore path via environment variable

## Phase 3 — Web UI
Browser-based interface for navigating and browsing datastores.

- Interactive tree with configurable depth
- Item detail view
- Storybook component library

## Phase 4 — Rich item types
Extend the type system with structured and computed content.

- Code items with language tagging and syntax highlighting
- Table items with rows and columns
- Function items that derive their value from other items
- Inline `[[uuid]]` link resolution in text and code values

## Phase 5 — Views
Virtual collections that present data without changing the underlying tree structure.

- Filtered views by type, owner, or tag
- Linked views following references from a root item
- Flat (non-nested) view of a subtree

## Phase 6 — Collaboration
Multi-user and multi-datastore features for sharing and syncing items across owners.

- Remote item caching
- Subscriptions to remote owners
- Backlink index across datastores
- Per-item licensing
