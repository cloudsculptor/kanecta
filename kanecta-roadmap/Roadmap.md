# Kanecta Roadmap

**Project:** Kanecta (kanecta.org)  
**License:** AGPL  
**Vision:** An open-source, self-hosted, text-based personal and organizational information repository with unlimited hierarchical structure, built for longevity, privacy, and AI interoperability.

---

## Phase 1 — Foundation (MVP)

The absolute minimum viable product. Goal: a working tree organizer usable by the developer to manage Kanecta's own development tasks by end of first sprint.

- [ ] Define and document the file store specification (`specification.md`)
- [ ] Define business rules for all CRUD operations
- [ ] Implement sharded UUID folder structure under `.kanecta/data/`
- [ ] `metadata.json` schema: `id`, `parent_id`, `value`, `type`, `type_id`, `owner`, `license`, `sort_order`, `cached_at`, `subscribed_at`, `subscription_source`
- [ ] Node.js / Express read API
  - [ ] `GET /items/:id` — fetch item metadata by UUID
  - [ ] `GET /items/:id/children` — fetch direct children of an item
  - [ ] Tree traversal from root
- [ ] React / TypeScript frontend — read-only tree view
  - [ ] Display collapsible tree of nodes
  - [ ] Each node shows its `value` and type
- [ ] Populate data store with Kanecta planning conversation as first real dataset
- [ ] Testing setup (Jest or equivalent) with passing tests for read API
- [ ] Use Kanecta to manage Kanecta's own development tasks (eat your own dog food)

---

## Phase 2 — Write Operations

Make the tree editable so humans and AI can add and modify items.

- [ ] Write API (CRUD)
  - [ ] `POST /items` — create new item
  - [ ] `PUT /items/:id` — update item
  - [ ] `DELETE /items/:id` — delete item (with backlink check)
- [ ] Index maintenance on write
  - [ ] Update `.kanecta/types/` on create/update/delete
  - [ ] Update `.kanecta/links/` backlinks on create/update/delete
  - [ ] Update search index on create/update/delete
- [ ] Editable tree UI
  - [ ] Inline editing of node value
  - [ ] Add child node
  - [ ] Delete node (with warning if backlinks exist)
  - [ ] Drag to reorder siblings (sort_order)
- [ ] OpenAPI spec documenting all endpoints and business rules

---

## Phase 3 — Aliases

Human-friendly shortcuts to items.

- [ ] `.kanecta/aliases/` sharded structure
- [ ] API: `GET /aliases/:alias` — resolve alias to UUID and return item
- [ ] API: `POST /aliases` — create new alias
- [ ] API: `DELETE /aliases/:alias` — remove alias
- [ ] UI: view and manage aliases for any item
- [ ] Alias validation (uniqueness within store)

---

## Phase 4 — Links and Backlinks

Rich linking between items, enabling a knowledge graph.

- [ ] Inline link syntax: `[[UUID]]` in value fields
- [ ] Symlink item type: item whose `value` is a UUID reference to another item
- [ ] `.kanecta/links/` backlinks index maintained on all writes
- [ ] API: `GET /items/:id/backlinks` — list all items linking to this item
- [ ] UI: display backlinks panel for any item
- [ ] UI: render `[[UUID]]` as clickable links in tree view
- [ ] UI: symlink items resolve and display target item content
- [ ] Warn user on delete if backlinks exist

---

## Phase 5 — Search

Full-text search across the store.

- [ ] Integrate AGPL-compatible search library (e.g., MeiliSearch, Fuse.js, or custom)
- [ ] `.kanecta/search/` index maintained on all writes
- [ ] API: `GET /search?q=...` — full-text search across all item values
- [ ] Search by owner, type, license
- [ ] UI: search bar with results displayed in tree context
- [ ] Consider custom lightweight search implementation for reduced dependencies

---

## Phase 6 — Types System

Structured, enforced object types layered on top of the free-form tree.

- [ ] Primitive types: `string`, `number`, `text`, `file`, `symlink`
- [ ] Object type definitions stored as items in `.kanecta/data/`
- [ ] Type definition schema: fields list with names and primitive types
- [ ] `.kanecta/types/` index: maps type UUID to list of item UUIDs
- [ ] API: `GET /types` — list all available types
- [ ] API: `GET /types/:id/items` — list all items of a given type
- [ ] UI: table/grid view of all items of a given type (like a database table)
- [ ] UI: right-click to create item from type template
- [ ] UI: enforce required fields on type-constrained items
- [ ] Built-in types for common use cases:
  - [ ] Spec / requirement
  - [ ] Task / ticket
  - [ ] Agent definition
  - [ ] Skill definition
  - [ ] Person / contact
  - [ ] Code snippet
  - [ ] Note

---

## Phase 7 — Multi-User and Remotes

Connect multiple Kanecta stores and share items between users.

- [ ] `.kanecta/remotes/` — cache of items owned by other users
- [ ] `.kanecta/remotes-index/` — index of remote items by owner
- [ ] `cached_at` timestamp on remote items
- [ ] API: `GET /remotes/:owner` — list all cached items from a remote owner
- [ ] Pull remote items on demand (manual sync)
- [ ] Subscription model:
  - [ ] `subscribed_at` and `subscription_source` fields in metadata
  - [ ] API: subscribe to updates from a remote item or owner
  - [ ] Push notifications when subscribed items change
- [ ] License field respected: only share items with appropriate licenses
- [ ] UI: manage subscriptions and remote sources

---

## Phase 8 — AI Integration

First-class AI support for reading and writing to the store.

- [ ] AI can read store directly via file system (no UI required)
- [ ] AI can write to store following business rules (create, update, delete items)
- [ ] AI can use search index as a tool
- [ ] AI can resolve links and traverse tree
- [ ] AI-powered item creation: speak or type naturally, AI structures as correct type
- [ ] AI-generated type suggestions based on existing data patterns
- [ ] Local AI integration for privacy (no data leaves the machine)
- [ ] Claude Code integration for developer workflows
- [ ] Store skills and agent definitions as typed Kanecta items

---

## Phase 9 — Developer Experience and Distribution

Make it easy for others to adopt and contribute.

- [ ] Packaging for easy install (npm, Docker, binary)
- [ ] CLI tool for managing the store without UI
- [ ] Plugin/extension API for third-party UI or backend implementations
- [ ] Migration tools to import from:
  - [ ] Obsidian
  - [ ] Jira / Linear (tickets)
  - [ ] Notion
  - [ ] Plain markdown files
  - [ ] CSV / spreadsheets
- [ ] Contributor guidelines and architecture documentation
- [ ] Public GitHub repository with issues and project board
- [ ] Community governance model (consistent with AGPL values)

---

## Phase 10 — Enterprise and Organizational Features

Scale Kanecta for teams and organizations.

- [ ] Permissions model: read/write/admin per item or subtree
- [ ] Organizational stores with shared ownership
- [ ] AWS / cloud hosting option for shared team stores
- [ ] Audit log of changes
- [ ] Versioning / history of item changes (`.kanecta/history/`)
- [ ] Comments on items (`.kanecta/comments/`)
- [ ] Templates library (`.kanecta/templates/`)
- [ ] Conflict resolution for concurrent edits
- [ ] SSO / identity provider integration

---

## Ongoing / Cross-Cutting Concerns

- Maintain AGPL license compatibility for all dependencies
- All data in open, text-based formats (JSON, markdown) for maximum longevity
- Self-hostable on Linux desktop and server
- Privacy-first: no telemetry, no external dependencies required
- Specification versioning: `specification.md` kept up to date in repo root
- Eat your own dog food: manage Kanecta development inside Kanecta

---

*Last updated: April 2026*  
*This roadmap is a living document. Features are prioritized based on value, feasibility, and community input.*
