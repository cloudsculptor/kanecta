---
"@kanecta/specification": minor
"@kanecta/ui-specification": minor
---

Document the soft-coded component model: the device component store + runtime resolution.

Core spec: adds a `componentStore` field to `config.json` (per-device npm/Gradle-style
component cache, keyed `package@version`, shared across apps, with cross-platform
default paths) and a "The device component store" section describing it. UI spec: adds
the soft-coded direction (apps are packages of `component` items resolved at runtime,
not compiled in), a Runtime Resolution section (manifest → device store → item → loader
→ render), a View Components + host-state contract (host owns per-view state; views get
`state`/`onStateChange` via props and never touch disk), and clarifies package
versioning vs the permanent `component` item UUID.
