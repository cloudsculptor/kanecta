---
"@kanecta/specification": minor
"@kanecta/ui-specification": minor
---

Declare Kanecta as TypeScript-only + SCSS-only, and rewrite the UI styling rules.

Both specs state the reference implementation language is TypeScript (no
JavaScript). The UI spec's styling section is rewritten from the old "flat CSS,
no SCSS, inline literals, no shared tokens, no `&`" rules to the SCSS
architecture: one co-located `.scss` per component, modified BEM (block = the
PascalCase component file name, `&__element`/`&--modifier` concatenation), and
global standards pulled in via SCSS `@use` of a shared design-system — never via
global stylesheets or the cascade. Enforced by a repo source-language gate.
