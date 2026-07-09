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

## Built since (verified on real Postgres)
- **`pg-datasource.ts`** — `PgDataSource`: the executor's DataSource over SQL
  (`getById`/`query` via `compileSelect`/`children`/`related`). Verified end-to-end
  against a real database (`tests/graphql/pg-datasource.integration.test.ts`,
  gated on `KANECTA_TEST_PG_URL`).
- **G2 aggregations** — `compileAggregate` (count/group-by/sum/avg/min/max) in
  `sql-query.ts`, for the reactions map / counts / finance rollups.
- **G4 authz** — `../authz/`: grant/visibility/owner/ReBAC decisions; wired into
  the executor as `ctx.authorize` (read gate).
- **graphql-js wiring** — [`http.ts`](http.ts): `buildGraphqlEngine(model, ds)`
  feeds `emitSDL` → `buildSchema` and attaches a resolver to each root query field
  that converts the resolve-info selection set to the engine's `Selection` and
  calls the Executor. Nested fields resolve via graphql-js's default resolver over
  the executor's wire-shaped objects, so aliases + fragments are handled for free.
  `loadTypeItems` adapts datastore `type` items to buildSchemaModel input.
  **`POST /graphql`** is mounted in `app.ts` (Postgres-backed working sets only;
  a 501 otherwise); the engine is cached per pool. Adds the `graphql` dependency.

## runComputed (built — declarative-first)
- [`computed.ts`](computed.ts) runs a computed field's backing `query`/`formula`
  item. `query` language `sql`: the expression's `{{params.name}}` placeholders bind
  from the row + viewer (`self`/`id`→item id, `viewer`→ctx.viewer, `<name>`→column)
  as **parameterised** SQL (injection-safe); a scalar field takes the first column,
  a list field the rows. `formula` level `template`: `{name}` substitution. Other
  levels/languages (`dsl`/`function`, `kanecta`/`graph`) throw a clear "not wired
  yet". `buildComputedMap(model, loadPayload)` resolves each field's backing item to
  a spec; `PgDataSource` takes the map (`opts.computed`) and `app.ts` builds it from
  the datastore's query/formula items. A selected computed field with no wired
  backing throws the same honest error as before.

## Deferred (needs the runner / an owner decision)
- **formula `dsl` (formulajs) + `function`-item computed** — the last-resort ladder
  rungs; declarative-first covers `query` + `template` today.
- **`/graphql` per-item authz** — the route computes principals but does not yet
  set `context.authorize` (needs a Postgres AuthzSource); it is behind the same
  auth wall as the REST routes but does not enforce per-item grants yet.
- **Adapter-based seeding + backfill** — seed the `ch-*` manifest via the real
  Postgres adapter and backfill nonprod data (see `../../manifests/community-hub/`).
- **DataLoader batching** — the `PgDataSource` loads per-field; batch to kill N+1.
