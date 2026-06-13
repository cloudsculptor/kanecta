# Namespace

## The decision

`system_root`, `app_root`, `component_root`, and `data_root` are retired. Namespace separation is provided by a `namespace` field on every item. The only well-known item is `root` — the bootstrap anchor.

See [settled-decisions.md](settled-decisions.md) §2 for why.

---

## The field

```sql
namespace VARCHAR(20) NOT NULL DEFAULT 'user'
  CONSTRAINT chk_items_namespace CHECK (namespace IN ('system', 'app', 'user'))
```

Three values:

| Namespace | Meaning |
|---|---|
| `system` | Kanecta internals — bootstrapper components, core type definitions, system config. Protected from user queries and edits. |
| `app` | Application-level items — UI components, app logic, templates, skills. May be readable by users but not editable without elevated trust. |
| `user` | User data — notes, decisions, tasks, objects, relationships. The default for all user-created items. |

Default is `"user"`. The bootstrapper sets `"system"` and `"app"` explicitly when creating system items.

---

## Query scoping

All standard queries — search, tree traversal, `get_children`, `get_ancestors` — scope to `namespace = 'user'` by default. `system` and `app` items are invisible to normal operations unless explicitly requested.

```sql
-- Default: user namespace only
SELECT * FROM items WHERE namespace = 'user' AND valid_to IS NULL;

-- Explicit: include app namespace
SELECT * FROM items WHERE namespace IN ('user', 'app') AND valid_to IS NULL;

-- System: only accessible to privileged operations
SELECT * FROM items WHERE namespace = 'system' AND valid_to IS NULL;
```

MCP tools expose a `namespace` parameter on query tools. Default is `"user"`. Passing `"app"` or `"system"` requires elevated trust (to be defined by the access control model).

---

## Relationship to access control

Namespace is **separation**, not **security**. It prevents accidental bleed between system/app/user concerns and protects system items from untrusted queries. It is not a substitute for a proper access control model.

Full access control — tiered trust, organisation-level visibility, per-item permissions — will be designed separately. When that model lands, `namespace` will be one input into the access decision, not the sole mechanism.

The existing `visibility` field (`private | organisation | public`) and `owner` field are the current access control primitives. These remain unchanged and operate independently of namespace.

---

## Bootstrapping

On first open of an empty datastore, the bootstrapper creates:

1. The root tree item (UUID `00000000-0000-0000-0000-000000000000`, type `"tree"`, namespace `"system"`)
2. Any system items required for the application to function (namespace `"system"`)
3. Any app items required for the UI to render (namespace `"app"`)

User data items are never created by the bootstrapper — the datastore starts empty from the user's perspective.

The bootstrapper discovers system and app items by querying `namespace = 'system'` and `namespace = 'app'` — not by fixed UUIDs (except for the root tree anchor). This means system items can be updated, extended, or replaced without changing the bootstrapper itself.
