# @kanecta/converter

Deterministic tooling to move a **standard web app** (a normalised relational
database + a per-resource REST API + a response-shaping layer + a frontend fetch
layer) onto a **Kanecta** backend.

The methodology, the reasoning, and the full toolset are specified in
[`kanecta-converter-specification/1.4.0/specification.converter.adoc`](./kanecta-converter-specification/1.4.0/specification.converter.adoc).
Read that first — this package is the code that automates it.

## The shape of a conversion (four gates)

1. **Storage** — the app's data lives in Kanecta and projects to tables of
   *identical shape* (names differ). Proven by a schema-DDL diff + a
   compatibility-VIEW acceptance test.
2. **Endpoints** — each old endpoint reproduced from Kanecta items
   (views/queries/functions), serving byte-identical JSON. Proven by a response
   shadow-diff.
3. **Unified API** — the bespoke routes replaced by the one uniform Kanecta /
   GraphQL surface.
4. **Frontend** — the data-access layer swapped to the unified API; the rest of
   the app untouched.

Discipline: **mirror exactly first, optimise later.** A faithful projection is
checkable; a "cleverly improved" one is not.

## Tools

| Tool | Input → output | Gate | Status |
|---|---|---|---|
| `introspect` | a source table's schema → a Kanecta `type` item + a seams/fidelity report | 1 | ✅ |
| `schema-diff` | source table ↔ its Kanecta projection → a fidelity report (known deltas vs real divergences) | 1 | ✅ |
| `compat-views` | source table + type → `CREATE VIEW` SQL that reassembles the old shape | 1 | ✅ |
| `backfill` | source rows → idempotent item upserts | 1 | planned |
| `endpoint-scaffold` | a route → `query`/`view`/`function` items | 2 | planned |
| `response-diff` | old endpoint ↔ Kanecta-served response → byte diff | 2/3 | planned |

## Determinism boundary

Automate the mechanical ~80%; produce a precise punch-list of the ~20% that needs
a human (writes with side-effects, integrations, bespoke logic). The punch-list is
the value — it turns a scary rewrite into a bounded checklist.
