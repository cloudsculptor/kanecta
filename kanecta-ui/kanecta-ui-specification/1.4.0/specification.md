# Kanecta UI Specification — v1.4.0

This document defines the rules for every package in `kanecta-ui/`. It is the UI-layer equivalent of `kanecta-core/kanecta-specification/`. Tooling in `kanecta-ui-validator` enforces these rules programmatically.

---

## 1. Directory Layout

```
kanecta-ui/
  kanecta-apps/
    kanecta-app-studio/
      kanecta.manifest.json       ← required
      src/
  kanecta-components/
    kanecta-component-<slug>/
      package.json                ← required
      src/
        index.ts                  ← required (named exports only)
      kanecta.item.json           ← required
  kanecta-ui-specification/
    1.4.0/
      specification.md            ← this file
      kanecta-ui-validator/
    vNext/
```

---

## 2. Component Package Naming

| Thing | Convention |
|---|---|
| Folder | `kanecta-component-<slug>` |
| npm name | `@kanecta/component-<slug>` |
| Slug | Lowercase kebab-case, alphabetic start, no trailing hyphens |

Examples: `kanecta-component-confidence-badge`, `kanecta-component-layouts-view`.

---

## 3. `package.json` Rules

Every component package `package.json` must:

- Set `"private": true` — components are workspace packages, not individually published.
- Set `"main": "src/index.ts"` (or `"src/index.tsx"`) — no build step; TypeScript sources consumed directly.
- Set `"types": "src/index.ts"` (or `"src/index.tsx"`).
- Not include a `"dependencies"` block. Runtime dependencies are peer dependencies only.
- Use `>=` version ranges for all peer dependencies — never `^`. This ensures compatibility with the versions already installed in the consuming app without forcing duplicate installs.
  - `react`: `>=19`
  - `@mui/material`, `@mui/icons-material`: `>=9`
  - `@tanstack/react-query`: `>=5`
  - `@kanecta/component-*`: `*` (any workspace version)
- Include `"devDependencies"` for `typescript` and `@types/react` only. Do not devDep MUI or react-query — TypeScript resolves types from peerDeps through the workspace.

### Minimal valid package.json

```json
{
  "name": "@kanecta/component-my-widget",
  "version": "1.4.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": ">=19"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "~6.0.2"
  }
}
```

---

## 4. TypeScript Rules

- **Named exports only.** No `export default`. Every exported symbol must be named so consumers can tree-shake and so re-exports are unambiguous.
- **No store imports.** Component packages must not import from Studio stores (`useWorkspaceStore`, `useReviewStore`, `useUiStore`, `useLocationStore`, etc.) or any `kanecta-app-*` package. All data flows in through props.
- **Props-only API.** Every stateful dependency (fetch functions, callbacks, current workspace, active item ID) must be an explicit prop. This makes components testable in isolation and usable outside Studio.
- **No `?raw` imports.** Vite-specific query suffixes (`?raw`, `?url`) only work at the consuming app's build time. Pass the result as a prop instead.
- **No hooks-in-a-loop.** If parallel queries are needed for a dynamic list, use `useQueries` from TanStack Query, not `useQuery` inside `.map()`.
- **React context within a package is allowed** — use it to avoid deep prop-drilling inside a complex component tree. The context must not escape the package boundary.

---

## 5. CSS Rules

- **Flat CSS files only.** No SCSS, no PostCSS, no CSS modules. One `.css` file per component file, imported directly: `import './MyComponent.css'`.
- **BEM class names.** Block name is derived from the component filename (PascalCase filename → matching BEM block). Example: `ConfidenceBadge.tsx` → `.ConfidenceBadge`, `.ConfidenceBadge__label`, `.ConfidenceBadge--high`.
- **Self-contained.** No `@import` from other packages or shared token files. SCSS variable values must be inlined as literal values when converting.
- **CSS custom properties allowed.** MUI and Studio CSS custom properties (`var(--mui-palette-primary-main)`, `var(--color-text-muted)`, etc.) may be referenced — they are resolved by the consuming app's theme at runtime.
- **No nested selectors.** Flatten all nesting: `.Parent .Child` is written as a separate rule at top level.

---

## 6. `kanecta.item.json` Rules

Every component package must include a `kanecta.item.json` at its root. This file is a Kanecta item conforming to the core `item.json` spec (v1.4.0) with the following constraints:

- `item.type` must be `"component"`.
- `item.id` must be a stable UUID v4. Once written, it must never change — this UUID is the package's permanent identity in the Kanecta item graph.
- `item.parentId` must be `"00000000-0000-0000-0000-000000000000"` (the well-known root UUID).
- `item.value` must be a human-readable display name derived from the slug (e.g. `"Confidence Badge"`, `"Layouts View"`).
- `meta.specVersion` must be `"1.4.0"`.
- `meta.files.body` must be `"src/index.ts"` — the sidecar pointing to the component's source entry.
- `payload` must be present and conform to the `componentPayload` shape:
  - `payload.props` — array (may be empty; ideally populated with prop definitions).
  - `payload.dependencies` — array of npm package names this component imports beyond React.
  - `payload.description` — one-sentence summary of what the component renders.

### Example

```json
{
  "item": {
    "id": "626c2e16-1608-440a-84c5-cc0a6460ac58",
    "parentId": "00000000-0000-0000-0000-000000000000",
    "type": "component",
    "typeId": null,
    "value": "Confidence Badge",
    "sortOrder": null
  },
  "meta": {
    "specVersion": "1.4.0",
    "owner": "kanecta.org",
    "ownerDomain": "kanecta.org",
    "namespace": "kanecta.org/ui/components",
    "copyrightHolder": null,
    "license": "bb3bf137-d8a9-4264-9fb7-ac373b1d4739",
    "contentHash": null,
    "mirrors": [],
    "sameAs": [],
    "visibility": "public",
    "aspect": null,
    "confidence": "decided",
    "status": "active",
    "tags": ["ui", "component", "react"],
    "template": null,
    "createdAt": "2026-06-27T00:00:00.000Z",
    "modifiedAt": "2026-06-27T00:00:00.000Z",
    "createdBy": null,
    "modifiedBy": null,
    "completedAt": null,
    "dueAt": null,
    "cachedAt": null,
    "subscribedAt": null,
    "subscriptionSource": null,
    "files": { "body": "src/index.ts" }
  },
  "search": null,
  "payload": {
    "description": "Kanecta Confidence Badge display component.",
    "props": [],
    "dependencies": []
  }
}
```

---

## 7. App Manifest (`kanecta.manifest.json`)

Every app in `kanecta-apps/` that ships or consumes UI components must include a `kanecta.manifest.json` at its root. Its structure mirrors the core `kanecta.manifest.json` pattern.

```json
{
  "schemaVersion": "1.4.0",
  "package": "kanecta-app-studio",
  "layer": "ui",
  "items": [
    {
      "id": "626c2e16-1608-440a-84c5-cc0a6460ac58",
      "type": "component",
      "file": "../../kanecta-components/kanecta-component-confidence-badge/kanecta.item.json"
    }
  ]
}
```

Rules:

- `schemaVersion` — semver string matching the spec version in use.
- `package` — the npm package name of this app (without the `@kanecta/` scope).
- `layer` — must be `"ui"`.
- `items` — array of item references. Each entry:
  - `id` — UUID v4. Must match the `item.id` in the referenced `kanecta.item.json`. The manifest never assigns its own IDs — it mirrors the component's canonical ID.
  - `type` — Kanecta item type string (typically `"component"`).
  - `file` — path to the `kanecta.item.json`, relative to this manifest file.

---

## 8. Storybook

Every component package that exports a renderable React component must include a Storybook story file alongside the component source:

- File: `src/<ComponentName>.stories.tsx`
- Must include at least one `Default` story exercising the happy path with realistic props.
- Stories must not import from Studio or any `kanecta-app-*` package.
- Stories should use `@storybook/react` component story format (CSF3).

Shared component packages (badge, chip, indicator, bar) must additionally include a story for each meaningful visual state (e.g. each `ConfidenceLevel` value).

---

## 9. Version Compatibility

| Spec version | React | MUI | TanStack Query | Notes |
|---|---|---|---|---|
| 1.4.0 | >=19 | >=9 | >=5 | Initial UI specification |

When bumping the spec version, create a new versioned folder (e.g. `2.0.0/`) and update the `package.json` exports map. The `vNext/` folder is a scratchpad for breaking changes under consideration — nothing in `vNext/` is enforced by the validator.
