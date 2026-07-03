---
"@kanecta/lib": minor
---

Add the device component store — the per-device cache of soft-coded component
packages (npm/Gradle-style, keyed `package@version`, shared across Connector apps).
`resolveComponentStore()` resolves its path (env → config `componentStore` →
cross-platform default: Linux `$XDG_CACHE_HOME/kanecta/components`, Mac
`~/Library/Caches/...`, Windows `%LOCALAPPDATA%\...`). A `componentStore` module
syncs packages into the store from source (`syncFromSource` / `installFromDir`,
idempotent, node_modules excluded), lists installed packages, and reads their
`kanecta.item.json`. Ships a `kanecta-sync-components` CLI.
