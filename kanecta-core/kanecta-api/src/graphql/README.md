# Type-items → GraphQL engine

The generic engine that turns Kanecta `type` items into a uniform GraphQL surface
over items. It carries **no per-domain and no per-view logic** — an app's screens
are expressed as data (type items + `x-graphql` declarations + view/query/grant
items), never as code here. This directory *is* "the only code is the generic
engine" from the community-hub → kanecta-api cutover.

## The two halves

**1. Schema generation** (pure functions of the type items):
- [`vocabulary.ts`](vocabulary.ts) — the `x-graphql` extension-keyword vocabulary
  by which a type item declares its exposed fields (scalars, references,
  containment, computed). Additive; needs no spec change.
- [`model.ts`](model.ts) — `buildSchemaModel(typeItems) → SchemaModel`: the IR.
  Every field carries a `backing` (the resolver plan): `identity` / `scalarColumn`
  / `reference` / `containment` / `computed`.
- [`scalars.ts`](scalars.ts), [`naming.ts`](naming.ts),
  [`naming-strategy.ts`](naming-strategy.ts) — pure mappers. Scalar map mirrors
  `@kanecta/schema-compiler` so the graph surface stays 1:1 with `obj_<type>`
  storage. Type names → PascalCase; **fields are camelCase (canonical); DB columns
  are snake_case** (always — the spec rule, computed identically here).
- [`sdl.ts`](sdl.ts) — `emitSDL(model) → string`: reviewable GraphQL SDL with G1
  `where`/`sort`/`limit`/`offset` on every list field. No graphql-js dependency.

**2. Execution**:
- [`sql-query.ts`](sql-query.ts) — `compileSelect(type, args)`: the G1 where/sort/
  pagination compiler → parameterised SQL over `obj_<type>`. Injection-safe (bound
  params + allow-listed identifiers).
- [`execute.ts`](execute.ts) — `Executor(model, dataSource)`: the generic resolver.
  Walks each field's `backing` to project a GraphQL-shaped result. Decoupled from
  storage by the `DataSource` interface, so it is verified with an in-memory fake
  (no database, no graphql-js).

## How a request flows
```
type items ──buildSchemaModel──▶ SchemaModel ──emitSDL──▶ SDL (introspection/GraphiQL)
                                     │
request (typeName, args, selection)  │  resolverPlan: TypeName.field → Backing
        │                            ▼
        └──▶ Executor.resolveList/resolveById ──▶ DataSource
                     (walks backings)             ├─ getById / query (compileSelect → SQL)
                                                   ├─ children (containment)
                                                   ├─ related (relationship items)
                                                   └─ runComputed (function/formula/query item)
```
Output object keys are the **wire** field names (camelCase); the DataSource speaks
**snake_case** columns. That boundary lives only in `execute.ts` + `model.ts`.

## Naming (settled)
- API / JSON / GraphQL: **camelCase** (canonical, from the type item's property names).
- DB columns: **snake_case**, always, not configurable, no per-field override.
  Already in the 1.4.0 spec (§sqlSchema rules) and derived by
  `@kanecta/schema-compiler` for every adapter.
- `fieldNaming: 'snake'` exists only for a *foreign* compat surface (e.g. a
  transient legacy-REST shadow-diff projection); the canonical surface is camelCase.

## Deferred (needs a live datastore / an awake owner)
- **A Postgres `DataSource`** — backs `getById`/`query`/`children`/`related`/
  `runComputed` with SQL over `items` + `obj_<type>` and the runner. Pairs with
  per-item ReBAC (G4 authz) and DataLoader batching (N+1).
- **graphql-js wiring** — feed `emitSDL` output to `buildSchema`, map resolvers
  from `resolverPlan`, expose a `/graphql` route. Adds the `graphql` dependency.
- **The `ch-*` type manifest (G5)** — see `../../manifests/community-hub/`.
