# Features

| Feature | Description | Status |
|---------|-------------|--------|
| **Item types** | | |
| String | Single-line text value | 🔲 Planned |
| Number | Numeric value | 🔲 Planned |
| Text | Multi-line rich text content | 🔲 Planned |
| File | Binary file attachment | 🔲 Planned |
| Object | Typed structured item | 🔲 Planned |
| Symlink | Pointer to another item | 🔲 Planned |
| Code | Syntax-highlighted code block with language tag | 🔲 Planned |
| Table | Structured tabular data | 🔲 Planned |
| Function | Computed or dynamic value derived from other items | 🔲 Planned |
| **Linking** | | |
| Inline links | `[[uuid]]` references embedded in text values | 🔲 Planned |
| Symlink items | Dedicated item type that points to another item | 🔲 Planned |
| Backlink index | Reverse index of all items that reference a given item | 🔲 Planned |
| **Views** | | |
| Tree view | Hierarchical display of an item and its descendants | 🔲 Planned |
| Flat view | All descendants listed without nesting | 🔲 Planned |
| Filtered view | Virtual collection scoped by type, owner, or tag | 🔲 Planned |
| Linked view | All items reachable via links from a root item | 🔲 Planned |
| **Storage & indexing** | | |
| UUID sharding | 16-level directory structure for scalable item storage | 🔲 Planned |
| Aliases | Human-readable shortcuts mapped to item UUIDs | 🔲 Planned |
| Type index | Reverse index of items grouped by type | 🔲 Planned |
| Search index | Cached full-text search across item values | 🔲 Planned |
| **Clients** | | |
| HTTP API | REST API to query items and trees by UUID | 🔲 Planned |
| Web UI | React-based browser interface with interactive tree | 🔲 Planned |
| CLI | Plain-text tree export to file | 🔲 Planned |
| **Sharing & collaboration** | | |
| Multi-owner items | Per-item ownership tracked in metadata | 🔲 Planned |
| Remote items | Cached copies of items from other datastores | 🔲 Planned |
| Subscriptions | Follow and sync items from a remote owner | 🔲 Planned |
