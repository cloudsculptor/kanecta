# vNext

Direction of travel for future Kanecta datastore specifications.

Documents here explore where the data model and storage architecture are heading — not the current production behaviour, but the design thinking and agreed direction that will shape the next major version of the spec. They range from settled decisions to active design sessions to proposals still under consideration.

Treat this directory as the architecture's working memory: where conclusions get recorded before they become formal spec.

---

## Settled decisions

| Document | What it covers |
|---|---|
| [settled-decisions.md](settled-decisions.md) | All locked architectural decisions — start here |

## Design documents

### Core data model
| Document | Status |
|---|---|
| [everything-is-an-item.md](everything-is-an-item.md) | Settled direction |
| [data-model-redesign.md](data-model-redesign.md) | Settled direction |
| [nodes-and-trees.md](nodes-and-trees.md) | **Settled — full schema** |
| [namespace.md](namespace.md) | **Settled — replaces well-known root hierarchy** |
| [first-class-relationships-design.md](first-class-relationships-design.md) | Settled direction |
| [typed-relationships-plan.md](typed-relationships-plan.md) | Implementation plan |
| [links-and-relationships-report.md](links-and-relationships-report.md) | Design session notes |

### Storage and performance
| Document | Status |
|---|---|
| [filesystem-sqlite-memory-layered-datastore.md](filesystem-sqlite-memory-layered-datastore.md) | Settled direction |
| [embeddings.md](embeddings.md) | **Settled — content_hash + pg_vector projection** |
| [graph-projection.md](graph-projection.md) | **Settled — AGE as traversal index** |

### Provenance and external systems
| Document | Status |
|---|---|
| [provenance-and-external-systems.md](provenance-and-external-systems.md) | **Settled — source fields + AI confidence convention** |

### MCP API surface
| Document | Status |
|---|---|
| [mcp-api-surface.md](mcp-api-surface.md) | **Target surface — to be formalised into main spec** |

### Sync and collaboration
| Document | Status |
|---|---|
| [git-like-sync-model.md](git-like-sync-model.md) | Design direction — multiple remotes, local branches, Git-like UX for Kanecta datastores |

### Other
| Document | Status |
|---|---|
| [core-data-model-architecture.md](core-data-model-architecture.md) | Design session notes |
| [item-file-structure-notes.md](item-file-structure-notes.md) | Design session notes |
| [kanecta.md](kanecta.md) | Claude + Richie enhancement wishlists |
| [studio-postgres-smoke-test-checklist.md](studio-postgres-smoke-test-checklist.md) | Test checklist |
