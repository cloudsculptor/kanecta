# TypeScript migration — execution plan

Status of the JS→TS migration and the order to finish it. The gate
(`scripts/check-source-languages.sh` + `scripts/allowed-js.txt`) fails on any
tracked `.js`/`.cjs`/`.mjs` not listed in the ratchet; the goal is zero.

## ✅ OUTCOME — cut-over complete (branch `chore/ts-migration-core-cutover`)

**Ratchet: 96 → 5.** All 91 migratable source/test/script/config files were
migrated to TypeScript (+ vitest for tested packages), across the whole runtime
graph: claude-bridge, ai, all storage adapters (sqlite-fs, s3, postgres,
database, cloud, datastore-utils), lib, api, mcp, cli, app-claude, specification
+ ui-specification, the 5 migration scripts, ensure-datastore, keycloak dev
helper, and the studio eslint config.

**Verified:** every migrated package `tsc --noEmit` clean; studio `tsc -b` +
`vite build` clean; **1150 tests pass** (sqlite-fs 327, postgres 208, lib 292,
api 113 +8 keycloak-skip, mcp 100, cli 98, s3 3 +6 minio-skip, schema-compiler
12); api + mcp servers boot under tsx. One collateral regression fixed
(`transcript-import`'s obsolete ambient stubs conflicted with the now-typed
lib/postgres). Pre-existing, out-of-scope: `kanecta-components-react/*` fail
`tsc` in isolation on `import './x.css'` (no `*.css` ambient decl) — studio's
Vite build handles CSS; unaffected by this cut-over.

**Two foundational fixes** (both surfaced by verifying deps against consumers):
1. *Cross-package vitest resolution* — vitest 4 externalises a transitive
   `require()` of a TS-source workspace package and only tries `.js/.cjs/.json`;
   fix = explicit `.ts` extensions on internal relative imports + root
   `allowImportingTsExtensions`.
2. *Vendor-type propagation* — `declare module 'pg'`/`'better-sqlite3'`/`'express'`
   shims travel to consumers via a `/// <reference>` at the package entry.

**The 5 remaining** (`scripts/allowed-js.txt`) are host-mandated entry points —
3 Electron `main.cjs`, the VS Code `extension.js`, and the studio `server.cjs`
launcher — where "run under tsx" doesn't apply (the host loads the entry and
can't type-strip `.ts`). They need a per-package esbuild bundle step + Electron/
vsce packaging changes that can't be verified on this machine. **Recommendation:
a separate supervised pass** that builds/launches each app to confirm packaging,
or a documented gate-exclusion (as with community-hub) if they're to stay CJS.

---

_Original plan below (kept for reference)._

**Remaining: 96 JS files** (was 116 at the start of the effort).
`kanecta-app-community-hub` is excluded from the gate and from migration (live
prod) and is not counted here.

## Per-package pattern (established by @kanecta/schema-compiler, @kanecta/sdk)

1. `src/*.js → *.ts`: add types, ESM `import`/`export`, keep the package
   CommonJS (no `"type":"module"`) so tsx/NodeNext emit CJS semantics.
2. `package.json`: `main → *.ts`, drop the separate `types` field, add
   `"typecheck": "tsc -p tsconfig.json --noEmit"`.
3. Per-package `tsconfig.json` extending root, `types: ["node"]`.
4. Tests `*.test.js → *.test.ts`, run under the chosen TS test runner.
5. Delete each migrated entry from `scripts/allowed-js.txt`.
6. Verify: package `typecheck` clean + gate passes (+ tests where they exist).

## The core finding: the runtime graph is interlocked under plain `node`

The servers run under **plain node**, not tsx:
`kanecta-api` = `node src/server.js`, `kanecta-mcp` = `node src/index.js`. And
they form one runtime `require` chain:

```
api / mcp  (node)
  └─ @kanecta/lib            (datastore.js, generateFunctionCode.js)
       └─ @kanecta/datastore-utils
            └─ @kanecta/{sqlite-fs, s3, cloud, database}
  └─ @kanecta/ai → @kanecta/claude-bridge
```

Plain `node` cannot `require()` a `.ts` entry point. So **no package in this
chain can be migrated to a `.ts` main in isolation** — doing so breaks the
running server. The chain must be migrated as a **coordinated cut-over** that
also flips the server entry points to `node --import tsx`. This is why the
migration cannot proceed purely leaf-by-leaf past the isolated packages below.

## Buckets

### A. Isolated-safe — migrate now, leaf-by-leaf (no runtime consumer under node)

| Package | Files | Tests | Status |
|---|---|---|---|
| `@kanecta/schema-compiler` | — | node:test | ✅ done |
| `@kanecta/sdk` | 1 | none | ✅ done |
| `@kanecta/api-client` | 1 (+ hand `.d.ts`) | none | ✅ done — first migrated package consumed by another TS project (studio); `main: index.ts` resolves across the boundary and studio `tsc -b` stays clean. |

Bucket A is now exhausted — every remaining package is in B/C/D.

**Proven:** a migrated package with `main: *.ts` is consumable by a TS project
(studio) with no wrapper — TS resolves the `.ts` as both value and types, and
`tsc -b` does not choke on it. This de-risks the bucket-B cut-over's type side;
the remaining unknown there is purely the **runtime** entry-point flip.

### B. Core runtime graph — one coordinated cut-over (BLOCKED on 2 decisions)

`@kanecta/ai`, `@kanecta/claude-bridge`, `@kanecta/datastore-utils`,
`@kanecta/lib` (19 files), `@kanecta/sqlite-fs` (11), `@kanecta/postgres` (9),
`@kanecta/api` (9), `@kanecta/mcp` (6), `@kanecta/s3` (3), `@kanecta/cloud` (2),
`@kanecta/database` (1), and the spec validators
(`kanecta-specification`, `kanecta-ui-specification` — `index.js`+`index.mjs`
pairs consumed repo-wide).

Cut-over steps: flip `kanecta-api`/`kanecta-mcp` (and any other node entry
points) to `node --import tsx …`; migrate the graph leaf→root; migrate tests
per the chosen runner; verify **servers boot** and the jest suites pass.

### C. App / entry-point specific — decide per app

`kanecta-app-claude` (8, CLI bin), `kanecta-cli` (2, node:test bin), studio
Electron `main.cjs` ×3 (debian/mac/windows), studio VS Code `extension.js`,
studio `server.cjs` + `eslint.config.js`. Each changes a user-facing or
host-specific runtime invocation (bin shebang, Electron main, extension host) —
not a simple `main → .ts` swap.

### D. Standalone scripts — low-dependency, but change invocation

`kanecta-migrations/**` (3+2 files), `kanecta-dev/scripts/ensure-datastore.js`,
`kanecta-{postgres,keycloak}/scripts/ensure-running.js`.
⚠️ Migrating the migration scripts changes their run command
(`node migrate-….js` → `node --import tsx migrate-….ts`) and **invalidates the
1.4.0 migration runbook** just written — update `kanecta-migrations/1.4.0/
README.md` in the same change.

## Decisions needed (these unblock bucket B — the bulk)

1. **Jest test strategy.** `api`, `lib`, `mcp`, `postgres`, `sqlite-fs` use
   `jest --runInBand`. Options: (a) keep jest via a `ts-jest`/`babel-jest`
   transform; (b) migrate jest → `node:test` (matches schema-compiler/cli/s3);
   (c) migrate jest → `vitest` (studio already uses vitest). Pick one — it sets
   the test pattern for the whole core graph.
2. **Confirm tsx-everywhere runtime.** The intended end state appears to be
   every node entry point running under `node --import tsx` (no build step).
   Confirm, so the server entry points can be flipped during the cut-over.

## Recommended sequence

1. ~~`@kanecta/api-client` (bucket A)~~ ✅ done — bucket A exhausted.
2. Make decisions (1) and (2). **These now gate all remaining progress.**
3. Bucket B core cut-over — one coordinated branch: flip entry points, migrate
   graph leaf→root, migrate tests per (1), verify servers + suites.
4. Buckets C and D — per app / per script, each with its own invocation change.
