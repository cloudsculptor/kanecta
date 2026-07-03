---
"@kanecta/studio": minor
---

Add the soft-coded component loader core + the view state contract.

`src/lib/componentLoader.ts`: `buildComponentRegistry(manifest, itemsById,
componentsById)` builds a runtime `id → { item, Component, name }` registry from
an app's `kanecta.manifest.json` — the pure, host-agnostic core of soft-coded
loading (items/modules are injected: bundled behind the loader today, device-store
loaded later). Missing items/modules degrade one view rather than break the app.
Also defines `ViewComponentProps<TState, TApi>` — the host state contract (host
owns per-view persistence; a view receives `state` + `onStateChange` + `api` via
props and never touches disk). Studio's live view rendering is unchanged; wiring
`renderView`/`viewRegistry` to the registry (behind a flag, with the current
hardcoded path as fallback) is the next step.
