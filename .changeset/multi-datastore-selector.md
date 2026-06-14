---
"@kanecta/mcp": minor
---

Add multi-datastore support. A single server instance can now serve several datastores: register them as a JSON map of name→path via the new `KANECTA_DATASTORES` environment variable, then pass an optional `datastore` argument to any tool to target one of them. Omitting `datastore` preserves the existing single-datastore behavior exactly — resolution falls through to `KANECTA_DATASTORE`/the configured workspace, and configuring the registry never affects calls that omit the argument. Unknown datastore names return an error listing the configured names; `~` in registry paths expands to the home directory.
