# Kanecta

This is the Kanecta source repository.

## Repository Layout

```
kanecta/
├── CLAUDE.md                  — this file; project orientation for Claude Code
├── README.md                  — project overview and sub-project docs
├── kanecta-specification/     — canonical Kanecta spec (v1.0)
├── kanecta-datastore-sample/  — sample datastore for development and testing
├── kanecta-api/               — Node.js/Express HTTP API
├── kanecta-cli/               — Node.js CLI for text export
├── kanecta-client-web/        — React/TypeScript web UI
└── kanecta-roadmap/           — feature list and phased roadmap
```

## What is Kanecta?

Kanecta is an **open-source, self-hosted personal and organizational information repository**. Data is stored as a hierarchical tree of items with globally unique UUIDs. Key characteristics:

- Items live in `.kanecta/data/` using a sharded UUID directory structure
- Each item has a `metadata.json` with fields: `id`, `parent_id`, `value`, `type`, `owner`, `sort_order`, etc.
- Types: `string`, `number`, `text`, `file`, `symlink`, `object`
- Items link to each other via `[[uuid]]` inline syntax or symlink items
- Index caches: `aliases/`, `types/`, `remotes/`, `remotes-index/`, `links/`, `search/`
- Spec lives at `kanecta-specification/specification.md`

## Key Conventions

- The Kanecta spec is the source of truth for data model decisions
- All implementation must conform to the business rules in the spec (Section 3)
- `kanecta-datastore-sample/` is the default datastore for all local dev and tests
- The API runs on port 3000; the web client proxies `/api` to it via Vite
