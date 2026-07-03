# Contributing to Kanecta

## Languages — hard rules

Kanecta is a **TypeScript** project with **SCSS** styling. These are enforced by
`scripts/check-source-languages.sh` (run in CI and in the pre-commit hook), which
**fails on any new `.js`/`.cjs`/`.mjs` or `.css` file**.

- **Code: TypeScript only.** Never author `.js`, `.cjs`, or `.mjs`. New files are
  `.ts` (or `.tsx`). The Node backend runs TypeScript directly via `tsx` — there
  is no separate build step to "compile away" a `.js` file.
- **Styling: SCSS only.** Never author plain `.css`.

Existing `.js`/`.css` is **grandfathered tech debt** listed in
`scripts/allowed-js.txt` / `scripts/allowed-css.txt`. Those lists are a *migration
ratchet*: as a file is converted to `.ts`/`.scss`, delete its line. The goal is
zero. Do **not** add to the allowlists except for a config a tool genuinely cannot
load as TypeScript — and document why.

> If new TypeScript needs to import an old `.js` module, convert that dependency
> to `.ts` as part of your change rather than adding a new `.js`.

## SCSS styling architecture

- **One `.scss` per component, co-located** with it (`MyView.tsx` + `MyView.scss`),
  so a component's styles travel with it.
- **Modified BEM** — the block is the **component file name (PascalCase)**, not a
  hand-chosen name. Elements and modifiers use SCSS `&` concatenation:
  ```scss
  // KanectaToolbar.scss
  .KanectaToolbar {          // block = file name
    &__thing { }             // .KanectaToolbar__thing
    &--active { }            // .KanectaToolbar--active
  }
  ```
  `&__element` compiles to a flat class — no descendant-selector cascade. Never
  write `.Block { .child { } }` descendant nesting.
- **Global standards via `@use`, never the cascade.** Shared colours/spacing/
  typography/mixins live in a shared SCSS design-system partial that each component
  `@use`s, so token *values* compile into the component's isolated stylesheet. Do
  **not** theme via global `:root { --color-* }` custom properties, do **not**
  hardcode values, and do **not** create massive global stylesheets.

See the UI specification (`kanecta-ui/kanecta-ui-specification`) for the full rules.

## `kanecta-app-community-hub` is production — hands off

`kanecta-ui/kanecta-apps/kanecta-app-community-hub` is a **live production web
app** with its own stack and release process. **Do not modify it without explicit,
up-front authorisation**, and flag any change that touches it. It is **excluded**
from repo-wide migrations (including the TypeScript/SCSS migration) and from the
source-language gate.

## Commits & PRs

- Conventional commits (`type: subject`) with a descriptive body.
- No "Test plan" section in PR descriptions.
- Keep separate concerns on separate branches.
